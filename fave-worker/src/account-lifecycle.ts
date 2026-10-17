import type { ErrorHandler } from 'hono'
import type { AuthBindings } from './auth'
import { apiError } from './marketplace-auth'

export type DeletionReceipt = { id: string; status: 'requested'; requestedAt: number }

export function deletionReceiptQuery(env: AuthBindings, userId: string) {
  return env.DB.prepare(`SELECT id, status, requested_at AS requestedAt
    FROM account_deletion_requests WHERE user_id = ?`).bind(userId)
}

export function deletionStatus(request: DeletionReceipt | null) {
  return { request, canStartNewWork: request === null, existingTripAccess: true as const }
}

export async function receiveDeletionRequest(env: AuthBindings, userId: string) {
  const id = crypto.randomUUID()
  const result = await env.DB.batch([
    env.DB.prepare(`INSERT INTO account_deletion_requests (id, user_id, status, requested_at)
      VALUES (?, ?, 'requested', ?) ON CONFLICT(user_id) DO NOTHING`).bind(id, userId, Date.now()),
    env.DB.prepare(`INSERT INTO marketplace_audit_events
      (id, actor_user_id, actor_type, action, target_type, target_id, new_state, created_at)
      SELECT ?, ?, 'user', 'account_deletion_requested', 'account_deletion_request', id, status, requested_at
        FROM account_deletion_requests WHERE id = ? AND user_id = ? AND changes() = 1`)
      .bind(crypto.randomUUID(), userId, id, userId),
    deletionReceiptQuery(env, userId),
  ])
  const receipt = result[2].results[0] as DeletionReceipt | undefined
  if (!receipt) throw new Error('Account request receipt was not saved')
  return receipt
}

// D1 wraps SQLite trigger errors. Inspect a bounded cause chain without sending
// SQL, object keys, or the other participant's account status to the caller.
export function isAccountWorkBlocked(error: unknown): boolean {
  let current: unknown = error
  for (let i = 0; i < 5 && typeof current === 'object' && current !== null; i++) {
    const value = current as { message?: unknown; cause?: unknown }
    if (typeof value.message === 'string' && value.message.includes('account deletion blocks new work')) return true
    current = value.cause
  }
  return false
}

export const accountLifecycleErrorHandler: ErrorHandler<{ Bindings: AuthBindings }> = (error, c) => {
  if (isAccountWorkBlocked(error)) {
    c.header('Cache-Control', 'private, no-store')
    return c.json(apiError('NEW_BOOKING_UNAVAILABLE', 'This new booking is no longer available. Existing trips and payments are unaffected.'), 409)
  }
  // Preserve Hono's default behavior for HTTP exceptions and unrelated failures.
  if ('getResponse' in error && typeof error.getResponse === 'function') {
    const response: Response = error.getResponse()
    return c.newResponse(response.body, response)
  }
  console.error(error)
  return c.text('Internal Server Error', 500)
}
