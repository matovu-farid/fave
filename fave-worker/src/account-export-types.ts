export type ExportEntry = { name: string; stream: ReadableStream<Uint8Array> }
export type ExportException = { category: string; code: string; count: number }
export type ExportCoverage = { complete: boolean; exceptions: ExportException[]; counts: Record<string, number> }
export type PreparedAccountExport = { entries: AsyncIterable<ExportEntry>; coverage: ExportCoverage }
