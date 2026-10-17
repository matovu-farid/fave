// The writer-only entry point does not register embedded WASM codecs. STORE
// keeps originals byte-for-byte and avoids codec/Worker runtime dependencies.
import { ZipWriter } from '@zip.js/zip.js/lib/zip-core-writer.js'
import type { ExportEntry } from './account-export-types'

type ExportZipOptions = {
  beforeEntry?: (entry: ExportEntry) => Promise<void>
  onComplete?: () => Promise<void>
  onFailure?: (error: unknown) => Promise<void>
}

function validateEntryName(name: string, names: Set<string>): void {
  // Projectors supply fixed ASCII paths. Do not normalize an unsafe path into a
  // safe-looking one: extraction tools disagree about separators and aliases.
  if (name.length > 1024 || !name.split('/').every((part) =>
    part.length > 0 && part.length <= 255 && /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(part) && !part.endsWith('.'),
  )) throw new Error('Unsafe export entry name')
  const canonical = name.toLowerCase()
  if (names.has(canonical)) throw new Error('Duplicate export entry name')
  names.add(canonical)
}

/**
 * Serial, backpressured ZIP64 output. Only ZIP metadata is retained per entry;
 * source and archive bytes are streamed. Completion means generation finished,
 * never that a browser received or saved the archive.
 */
export function createExportZip(entries: AsyncIterable<ExportEntry>, options: ExportZipOptions = {}): ReadableStream<Uint8Array> {
  const abort = new AbortController()
  const names = new Set<string>()
  let iterator: AsyncIterator<ExportEntry> | undefined
  let active: ExportEntry | undefined
  let sourceReader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let controller: ReadableStreamDefaultController<Uint8Array>
  let demand = false
  let wake: (() => void) | undefined
  let started = false
  let cancelled = false
  let finished = false
  let failure: Promise<void> | undefined

  function checkAbort() {
    if (abort.signal.aborted) throw abort.signal.reason
  }

  function fail(reason: unknown): Promise<void> {
    if (failure) return failure
    abort.abort(reason)
    wake?.()
    failure = (async () => {
      // Invoke each cleanup even if another one fails, preserving the original
      // failure for the response. iterator.return runs producer finally blocks.
      const cleanup = [
        Promise.resolve().then(() => sourceReader ? sourceReader.cancel(reason) : active?.stream.cancel(reason)),
        Promise.resolve().then(() => iterator?.return?.()),
        Promise.resolve().then(() => options.onFailure?.(reason)),
      ]
      await Promise.allSettled(cleanup)
    })()
    return failure
  }

  async function produce() {
    try {
      checkAbort()
      iterator = entries[Symbol.asyncIterator]()
      const sink = new WritableStream<Uint8Array>({
        async write(chunk) {
          while (!demand) {
            checkAbort()
            await new Promise<void>((resolve) => { wake = resolve })
          }
          checkAbort()
          demand = false
          controller.enqueue(chunk)
        },
      })
      const zip = new ZipWriter(sink, {
        level: 0, compressionMethod: 0, useWebWorkers: false,
        useCompressionStream: false, bufferedWrite: false,
        dataDescriptor: true, zip64: true, preventClose: true,
        signal: abort.signal,
      })
      while (true) {
        checkAbort()
        const next = await iterator.next()
        if (next.done) break
        active = next.value
        // A query already awaiting inside iterator.next cannot be interrupted
        // through AsyncIterable. If it yields after cancellation, release that
        // newly opened source too; the initial failure cleanup could not see it.
        if (abort.signal.aborted) await active.stream.cancel(abort.signal.reason).catch(() => {})
        checkAbort()
        validateEntryName(active.name, names)
        await options.beforeEntry?.(active)
        checkAbort()
        sourceReader = active.stream.getReader()
        const reader = sourceReader
        const input = new ReadableStream<Uint8Array>({
          async pull(source) {
            checkAbort()
            const chunk = await reader.read()
            if (chunk.done) source.close()
            else source.enqueue(chunk.value)
          },
          cancel: (reason) => reader.cancel(reason),
        }, { highWaterMark: 0 })
        await zip.add(active.name, input, { signal: abort.signal })
        reader.releaseLock()
        sourceReader = undefined
        active = undefined
      }
      checkAbort()
      await zip.close()
      checkAbort()
      await options.onComplete?.()
      checkAbort()
      finished = true
      controller.close()
    } catch (error) {
      await fail(error)
      if (!cancelled) controller.error(error)
    } finally {
      sourceReader?.releaseLock()
    }
  }

  return new ReadableStream<Uint8Array>({
    start(output) { controller = output },
    pull() {
      demand = true
      wake?.()
      if (!started) {
        started = true
        // The stream owns this task; produce handles every failure and the
        // cancel hook awaits cleanup. Network consumption drives its lifetime.
        void produce()
      }
    },
    async cancel(reason) {
      cancelled = true
      if (!finished) await fail(reason ?? new Error('Export download cancelled'))
    },
  }, { highWaterMark: 0 })
}
