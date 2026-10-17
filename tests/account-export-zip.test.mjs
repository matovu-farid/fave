import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const requireWorker = createRequire(new URL('../fave-worker/package.json', import.meta.url))
const { build } = requireWorker('esbuild')
const source = fileURLToPath(new URL('../fave-worker/src/account-export-zip.ts', import.meta.url))
const bundle = await build({ entryPoints: [source], bundle: true, format: 'esm', platform: 'browser', write: false })
const { createExportZip } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
const encoder = new TextEncoder()
const tick = () => new Promise((resolve) => setTimeout(resolve, 10))
const body = (value) => new ReadableStream({ start(controller) { controller.enqueue(typeof value === 'string' ? encoder.encode(value) : value); controller.close() } })
async function* entries(values) { for (const [name, value] of values) yield { name, stream: body(value) } }
async function collect(stream) { return Buffer.from(await new Response(stream).arrayBuffer()) }
function readZip(bytes) {
  const result = spawnSync('python3', ['-c', 'import sys,io,zipfile,json,base64; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; print(json.dumps({i.filename:base64.b64encode(z.read(i)).decode() for i in z.infolist()}))'], { input: bytes, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return Object.fromEntries(Object.entries(JSON.parse(result.stdout)).map(([name, value]) => [name, Buffer.from(value, 'base64')]))
}

test('streams serial unknown-size ZIP64 entries readable by Python with original bytes', async () => {
  const binary = Uint8Array.from({ length: 262157 }, (_, index) => index % 256)
  const seen = []; let completed = 0; let failures = 0
  const bytes = await collect(createExportZip(entries([['account.json', '{"id":"self"}'], ['uploads/id.png', binary], ['empty.json', '']]), {
    beforeEntry: async (entry) => { seen.push(entry.name) }, onComplete: async () => { completed++ }, onFailure: async () => { failures++ },
  }))
  const extracted = readZip(bytes)
  assert.deepEqual(Object.keys(extracted), ['account.json', 'uploads/id.png', 'empty.json'])
  assert.equal(extracted['account.json'].toString(), '{"id":"self"}')
  assert.deepEqual(extracted['uploads/id.png'], Buffer.from(binary))
  assert.equal(extracted['empty.json'].length, 0)
  assert.ok(bytes.includes(Buffer.from([0x50, 0x4b, 0x06, 0x06])), 'ZIP64 end record')
  assert.equal(bytes.readUInt16LE(4), 45, 'ZIP64 local header version')
  assert.deepEqual(seen, Object.keys(extracted)); assert.equal(completed, 1); assert.equal(failures, 0)
})

test('slow consumers bound source reads and cancellation closes source and iterator once', async () => {
  let pulls = 0; let cancelled = 0; let returned = 0; let failures = 0; let completed = 0
  const stream = new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(65536)) }, cancel() { cancelled++ } }, { highWaterMark: 0 })
  async function* producer() { try { yield { name: 'large.bin', stream }; assert.fail('must not advance after cancel') } finally { returned++ } }
  const reader = createExportZip(producer(), { onComplete: async () => { completed++ }, onFailure: async () => { failures++ } }).getReader()
  await reader.read(); await tick(); const paused = pulls
  // zip.js uses a bounded pipeline of 256 KiB transforms; it must stall well
  // before 4 MiB even though the source is endless.
  await tick(); assert.equal(pulls, paused); assert.ok(pulls < 64, `read ${pulls} chunks without demand`)
  await reader.cancel('download disconnected')
  assert.equal(cancelled, 1); assert.equal(returned, 1); assert.equal(failures, 1); assert.equal(completed, 0)
})

test('source failures close the iterator and fail once without successful completion', async () => {
  let returned = 0; let failures = 0; let completed = 0
  async function* producer() { try { yield { name: 'broken.json', stream: new ReadableStream({ pull(controller) { controller.error(new Error('source missing')) } }) } } finally { returned++ } }
  await assert.rejects(collect(createExportZip(producer(), { onFailure: async () => { failures++ }, onComplete: async () => { completed++ } })), /source missing/)
  assert.equal(returned, 1); assert.equal(failures, 1); assert.equal(completed, 0)
})

test('cancellation while the producer awaits an entry cancels that late source', async () => {
  let release; let cancelled = 0; let returned = 0; let failures = 0
  const pending = new Promise((resolve) => { release = resolve })
  async function* producer() {
    try { await pending; yield { name: 'late.json', stream: new ReadableStream({ cancel() { cancelled++ } }) } }
    finally { returned++ }
  }
  const reader = createExportZip(producer(), { onFailure: async () => { failures++ } }).getReader()
  const read = reader.read()
  await tick()
  const cancellation = reader.cancel('gone')
  release()
  await cancellation; await read
  assert.equal(cancelled, 1); assert.equal(returned, 1); assert.equal(failures, 1)
})

test('iterator failure is reported once and closes the iterator', async () => {
  let returned = 0; let failures = 0
  const iterable = { [Symbol.asyncIterator]() { return { next: async () => { throw new Error('query failed') }, return: async () => { returned++; return { done: true } } } } }
  await assert.rejects(collect(createExportZip(iterable, { onFailure: async () => { failures++ } })), /query failed/)
  assert.equal(returned, 1); assert.equal(failures, 1)
})

test('rejects unsafe, ambiguous and duplicate names and cancels rejected sources', async () => {
  for (const name of ['../secret', '/root', 'a/../b', 'a/./b', 'a//b', 'a\\b', 'C:/id', 'a\u0000b', 'a\nb', 'a\u007fb', 'trailing./id', 'folder/', ' leading', 'a/b ', '', 'a'.repeat(256)]) {
    let cancelled = 0; let failures = 0
    async function* producer() { yield { name, stream: new ReadableStream({ cancel() { cancelled++ } }) } }
    await assert.rejects(collect(createExportZip(producer(), { onFailure: async () => { failures++ } })), /entry name/i, name)
    assert.equal(cancelled, 1, name); assert.equal(failures, 1, name)
  }
  await assert.rejects(collect(createExportZip(entries([['same.json', '1'], ['same.json', '2']]))), /duplicate/i)
})

test('authorization callback failures cancel unopened entry and preserve failure reason', async () => {
  let cancelled = 0; let returned = 0; let failures = 0
  async function* producer() { try { yield { name: 'private.json', stream: new ReadableStream({ cancel() { cancelled++ } }) } } finally { returned++ } }
  await assert.rejects(collect(createExportZip(producer(), { beforeEntry: async () => { throw new Error('session revoked') }, onFailure: async () => { failures++; throw new Error('audit unavailable') } })), /session revoked/)
  assert.equal(cancelled, 1); assert.equal(returned, 1); assert.equal(failures, 1)
})

test('completion callback failures error the output and call failure once', async () => {
  let failures = 0
  await assert.rejects(collect(createExportZip(entries([['account.json', '{}']]), { onComplete: async () => { throw new Error('status failed') }, onFailure: async () => { failures++ } })), /status failed/)
  assert.equal(failures, 1)
})

test('the ZIP implementation runs in workerd without browser workers or WASM', async () => {
  const { Miniflare, convertV4MiniflareOptions } = requireWorker('miniflare')
  const built = await build({ stdin: { contents: `import {createExportZip} from ${JSON.stringify(source)}; export default {fetch(){ async function* entries(){yield {name:'account.json',stream:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('workerd'));c.close()}})}} return new Response(createExportZip(entries()))}}`, resolveDir: fileURLToPath(new URL('..', import.meta.url)), sourcefile: 'export-runtime.ts' }, bundle: true, format: 'esm', platform: 'browser', write: false })
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: built.outputFiles[0].text, compatibilityDate: '2026-09-24' }))
  try {
    const response = await mf.dispatchFetch('https://export.test/')
    assert.equal(response.status, 200)
    assert.equal(readZip(Buffer.from(await response.arrayBuffer()))['account.json'].toString(), 'workerd')
  } finally { await mf.dispose() }
})
