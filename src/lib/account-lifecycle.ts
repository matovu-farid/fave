import { authenticatedFetch } from './api'

export type AccountDeletionRequest = { id: string; status: 'requested'; requestedAt: number }
export type AccountDeletionStatus = {
  request: AccountDeletionRequest | null
  canStartNewWork: boolean
  existingTripAccess: true
}
export type AccountRequestDetail = AccountDeletionRequest & { userId: string; name: string | null; email: string }

export const getAccountDeletionRequest = () => authenticatedFetch<AccountDeletionStatus>('/api/account/deletion-request', { cache: 'no-store' })
export const requestAccountDeletion = () => authenticatedFetch<AccountDeletionStatus>('/api/account/deletion-request', {
  method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }),
})
export type AccountRequestPage = { requests: AccountDeletionRequest[]; nextCursor: string | null }
export const getAccountRequestPage = (after?: string) => authenticatedFetch<AccountRequestPage>(
  `/api/admin/account-requests/pending${after ? `?after=${encodeURIComponent(after)}` : ''}`, { cache: 'no-store' },
)
export async function getAccountRequestQueue() {
  return (await getAccountRequestPage()).requests
}
export const getAccountRequestDetail = (id: string) => authenticatedFetch<{ request: AccountRequestDetail }>(`/api/admin/account-requests/${encodeURIComponent(id)}/detail`, {
  method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
})
