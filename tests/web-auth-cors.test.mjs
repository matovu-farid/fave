import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const workerRequire = createRequire(new URL('../fave-worker/package.json', import.meta.url))
const { build } = workerRequire('esbuild')
const directory = mkdtempSync(join(tmpdir(), 'fave-web-auth-'))
const config = JSON.parse(readFileSync(new URL('../fave-worker/wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''))
let app

test.before(async () => {
  const outfile = join(directory, 'worker.mjs')
  await build({ entryPoints: [new URL('../fave-worker/src/index.ts', import.meta.url).pathname], outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
  app = (await import(pathToFileURL(outfile).href)).default
})
test.after(() => rmSync(directory, { recursive: true, force: true }))

for (const origin of ['http://localhost:8081', 'http://127.0.0.1:8081']) {
  test(`deployed configuration permits credentialed web auth from ${origin}`, async () => {
    const response = await app.fetch(new Request('https://api.fave.fidexa.org/api/auth/sign-in/social', {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
    }), config.vars)
    assert.equal(response.status, 204)
    assert.equal(response.headers.get('access-control-allow-origin'), origin)
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true')
    assert.match(response.headers.get('access-control-allow-methods'), /POST/)
    assert.match(response.headers.get('access-control-allow-headers'), /content-type/i)
  })
}

test('unapproved websites cannot make credentialed browser requests', async () => {
  const response = await app.fetch(new Request('https://api.fave.fidexa.org/api/auth/sign-in/social', {
    method: 'OPTIONS', headers: { Origin: 'https://unapproved.example', 'Access-Control-Request-Method': 'POST' },
  }), config.vars)
  assert.equal(response.headers.get('access-control-allow-origin'), null)
})
