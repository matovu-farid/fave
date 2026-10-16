export const SEND_LEASE_MS = 120_000
type Database = Pick<D1Database, 'prepare'>
export type SendLease = { deliveryId: string; generation: string | null; token: string }

export async function acquireNotificationSend(db: Database, deliveryId: string, generation: string | null, now: number): Promise<SendLease | null> {
  const token = crypto.randomUUID()
  const result = await db.prepare(
    `UPDATE notification_outbox SET send_lease_token = ?, send_lease_until = ?
      WHERE delivery_id = ? AND queue_generation IS ? AND status IN ('pending', 'processing', 'queued')
        AND (send_lease_until IS NULL OR send_lease_until <= ?)`,
  ).bind(token, now + SEND_LEASE_MS, deliveryId, generation, now).run()
  return result.meta.changes === 1 ? { deliveryId, generation, token } : null
}

export async function renewNotificationSend(db: Database, lease: SendLease, now: number): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE notification_outbox SET send_lease_until = ?
      WHERE delivery_id = ? AND queue_generation IS ? AND send_lease_token = ? AND send_lease_until > ?
        AND status IN ('pending', 'processing', 'queued')`,
  ).bind(now + SEND_LEASE_MS, lease.deliveryId, lease.generation, lease.token, now).run()
  return result.meta.changes === 1
}

export async function finishNotificationSend(db: Database, lease: SendLease, status: 'pending' | 'queued' | 'complete' | 'expired' | 'suppressed', now: number, options: { notBefore?: number; category?: string } = {}): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE notification_outbox SET status = ?, not_before = COALESCE(?, not_before),
         last_error_category = ?, attempt_count = attempt_count + 1, last_attempt_at = ?,
         send_lease_token = NULL, send_lease_until = NULL, lease_until = NULL
      WHERE delivery_id = ? AND queue_generation IS ? AND send_lease_token = ? AND send_lease_until > ?
        AND status IN ('pending', 'processing', 'queued')`,
  ).bind(status, options.notBefore ?? null, options.category ?? null, now,
    lease.deliveryId, lease.generation, lease.token, now).run()
  return result.meta.changes === 1
}

export async function releaseNotificationSend(db: Database, lease: SendLease) {
  await db.prepare(
    `UPDATE notification_outbox SET send_lease_token = NULL, send_lease_until = NULL
      WHERE delivery_id = ? AND queue_generation IS ? AND send_lease_token = ?`,
  ).bind(lease.deliveryId, lease.generation, lease.token).run()
}
