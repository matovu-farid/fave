import { apiBaseUrl, authenticatedFetch } from './api'

export type AccountExportReceipt = {
  id: string
  status: 'requested' | 'streaming' | 'ready' | 'failed'
  requestedAt: number
  generatedAt: number | null
  needsFollowUp: boolean
  downloadedAt: number | null
  failureCode: string | null
}
export type ExportException = { category: string; code: string; count: number }
export type ExportResponse = { id: string; message: string; createdAt: number }
export type ExportAuthorization = { canDownload: boolean; freshUntil: number | null }
export type AccountExportDetail = ExportAuthorization & { request: AccountExportReceipt; responses?: ExportResponse[]; exceptions?: ExportException[] }
export type OwnerExportDetail = AccountExportReceipt & { userId: string; name: string | null; email: string; exceptions: ExportException[]; responses: ExportResponse[] }
export type ExportQueueItem = Pick<AccountExportReceipt, 'id' | 'requestedAt' | 'status' | 'needsFollowUp'>
const base = '/api/account/exports'
const json = (body: unknown): RequestInit => ({ method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
export const getAccountExports = (after?: string) => authenticatedFetch<ExportAuthorization & { requests: AccountExportReceipt[]; nextCursor: string | null }>(`${base}${after ? `?after=${encodeURIComponent(after)}` : ''}`, { cache: 'no-store' })
export const requestAccountExport = (requestKey: string) => authenticatedFetch<AccountExportDetail>(base, json({ confirmed: true, requestKey }))
export const getAccountExport = (id: string) => authenticatedFetch<AccountExportDetail>(`${base}/${encodeURIComponent(id)}`, { cache: 'no-store' })
export const acknowledgeAccountExport = (id: string) => authenticatedFetch<AccountExportDetail>(`${base}/${encodeURIComponent(id)}/acknowledge`, json({}))
// These URLs convey no authority. The server checks the current browser session on every request.
export const getArchiveUrl = (id: string) => new URL(`${base}/${encodeURIComponent(id)}/archive`, apiBaseUrl).href
export const getExportWebUrl = () => new URL('/account/export', apiBaseUrl).href
export const getAccountExportPage = (after?: string) => authenticatedFetch<{ requests: ExportQueueItem[]; nextCursor: string | null }>(`/api/admin/account-exports/pending${after ? `?after=${encodeURIComponent(after)}` : ''}`, { cache: 'no-store' })
export const getAccountExportDetail = (id: string) => authenticatedFetch<{ request: OwnerExportDetail }>(`/api/admin/account-exports/${encodeURIComponent(id)}/detail`, json({}))
export const saveAccountExportResponse = (id: string, message: string) => authenticatedFetch<{ saved: true }>(`/api/admin/account-exports/${encodeURIComponent(id)}/decision`, json({ message }))
