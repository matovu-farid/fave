import { Hono, type Context } from 'hono'
import type { AuthBindings } from './auth'
import { apiError, getSignedInUser, isMarketplaceAdmin, writeMarketplaceAudit } from './marketplace-auth'
import { isNotificationRecipientEligible, loadNotificationDelivery } from './notification-audience'

const adminNotificationsApp = new Hono<{ Bindings: AuthBindings }>()

async function requireAdmin(c: Context<{ Bindings: AuthBindings }>) {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return { error: c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401) }
  if (!await isMarketplaceAdmin(c.env, user.id)) {
    return { error: c.json(apiError('FORBIDDEN', 'You do not have permission to view notification operations.'), 403) }
  }
  return { user }
}

adminNotificationsApp.get('/health', async (c) => {
  const access = await requireAdmin(c)
  if ('error' in access) return access.error

  const [statuses, oldest, failed] = await Promise.all([
    c.env.DB.prepare(
      `SELECT status, COUNT(*) AS count FROM notification_outbox GROUP BY status ORDER BY status`,
    ).all<{ status: string; count: number }>(),
    c.env.DB.prepare(
      `SELECT MIN(created_at) AS createdAt FROM notification_outbox WHERE status IN ('pending', 'processing', 'queued')`,
    ).first<{ createdAt: number | null }>(),
    c.env.DB.prepare(
      `SELECT outbox.delivery_id AS deliveryId, event.event_type AS eventType,
              delivery.status, delivery.attempt_count AS attemptCount,
              delivery.last_error_category AS errorCategory, outbox.created_at AS createdAt
         FROM notification_deliveries AS delivery
         JOIN notification_outbox AS outbox ON outbox.delivery_id = delivery.delivery_id
         JOIN notification_events AS event ON event.id = outbox.event_id
        WHERE outbox.status IN ('failed', 'dead_lettered', 'complete')
          AND delivery.status IN ('failed', 'dead_lettered')
        ORDER BY delivery.last_attempt_at DESC LIMIT 20`,
    ).all<{
      deliveryId: string; eventType: string; status: string; attemptCount: number
      errorCategory: string | null; createdAt: number
    }>(),
  ])
  const now = Date.now()
  return c.json({
    statuses: statuses.results.map((row) => ({ status: row.status, count: row.count })),
    oldestPendingAgeMs: oldest?.createdAt === null || oldest?.createdAt === undefined
      ? null
      : Math.max(0, now - oldest.createdAt),
    failures: failed.results.map((row) => ({
      deliveryId: row.deliveryId,
      deliveryRef: row.deliveryId.slice(0, 8),
      eventType: row.eventType,
      status: row.status,
      attemptCount: row.attemptCount,
      errorCategory: row.errorCategory,
      createdAt: row.createdAt,
    })),
  })
})

adminNotificationsApp.post('/:deliveryId/retry', async (c) => {
  const access = await requireAdmin(c)
  if ('error' in access) return access.error

  const deliveryId = c.req.param('deliveryId')
  const current = await loadNotificationDelivery(c.env.DB, deliveryId)
  if (!current || !['failed', 'dead_lettered', 'complete'].includes(current.status)) {
    return c.json(apiError('NOTIFICATION_DELIVERY_NOT_FOUND', 'This failed notification delivery was not found.'), 404)
  }
  if (current.status === 'complete') {
    const failedDevice = await c.env.DB.prepare(
      `SELECT 1 AS failed FROM notification_deliveries WHERE delivery_id = ? AND status = 'failed' LIMIT 1`,
    ).bind(deliveryId).first<{ failed: number }>()
    if (!failedDevice) {
      return c.json(apiError('NOTIFICATION_DELIVERY_NOT_FOUND', 'This failed notification delivery was not found.'), 404)
    }
  }
  const now = Date.now()
  if (current.expiresAt !== null && current.expiresAt <= now) {
    const expired = await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE notification_outbox SET status = 'expired', lease_until = NULL
        WHERE delivery_id = ? AND queue_generation IS ? AND status IN ('failed', 'dead_lettered', 'complete')
          AND (send_lease_until IS NULL OR send_lease_until <= ?)`)
        .bind(deliveryId, current.queueGeneration, now),
      c.env.DB.prepare(
        `INSERT INTO notification_retry_audit (id, delivery_id, actor_user_id, reason, result, created_at)
         SELECT ?, ?, ?, 'operator_retry', 'expired', ? WHERE changes() = 1`,
      ).bind(crypto.randomUUID(), deliveryId, access.user.id, now),
    ])
    if (expired[0]?.meta.changes !== 1) return c.json(apiError('NOTIFICATION_DELIVERY_NOT_FOUND', 'This failed notification delivery was not found.'), 404)
    await writeMarketplaceAudit(c.env, {
      actorUserId: access.user.id, action: 'notification_retry_expired',
      targetType: 'notification_delivery', targetId: deliveryId,
    })
    return c.json({ result: 'expired' })
  }
  const eligible = await isNotificationRecipientEligible(c.env.DB, current)
  const device = eligible ? await c.env.DB.prepare(
    'SELECT 1 AS available FROM notification_push_tokens WHERE user_id = ? LIMIT 1',
  ).bind(current.recipientUserId).first<{ available: number }>() : null
  if (!device) {
    const suppressed = await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE notification_outbox SET status = 'suppressed', lease_until = NULL, last_error_category = ?
        WHERE delivery_id = ? AND queue_generation IS ? AND status IN ('failed', 'dead_lettered', 'complete')
          AND (send_lease_until IS NULL OR send_lease_until <= ?)`)
        .bind(eligible ? 'push_disabled' : 'recipient_ineligible', deliveryId, current.queueGeneration, now),
      c.env.DB.prepare(
        `INSERT INTO notification_retry_audit (id, delivery_id, actor_user_id, reason, result, created_at)
         SELECT ?, ?, ?, 'operator_retry', 'suppressed', ? WHERE changes() = 1`,
      ).bind(crypto.randomUUID(), deliveryId, access.user.id, now),
    ])
    if (suppressed[0]?.meta.changes !== 1) return c.json(apiError('NOTIFICATION_DELIVERY_NOT_FOUND', 'This failed notification delivery was not found.'), 404)
    await writeMarketplaceAudit(c.env, {
      actorUserId: access.user.id, action: 'notification_retry_suppressed',
      targetType: 'notification_delivery', targetId: deliveryId,
    })
    return c.json({ result: 'suppressed' })
  }

  const generation = crypto.randomUUID()
  const queued = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE notification_outbox SET status = 'queued', queued_at = ?, lease_until = NULL,
           last_error_category = NULL, queue_generation = ?, send_lease_token = NULL, send_lease_until = NULL
        WHERE delivery_id = ? AND queue_generation IS ? AND status IN ('failed', 'dead_lettered', 'complete')
          AND (send_lease_until IS NULL OR send_lease_until <= ?)`,
    ).bind(now, generation, deliveryId, current.queueGeneration, now),
    c.env.DB.prepare(
      `UPDATE notification_deliveries SET status = 'queued', last_error_category = NULL, updated_at = ?
        WHERE delivery_id = ? AND status IN ('failed', 'dead_lettered', 'retrying') AND changes() = 1`,
    ).bind(now, deliveryId),
    c.env.DB.prepare(
      `INSERT INTO notification_retry_audit (id, delivery_id, actor_user_id, reason, result, created_at)
       SELECT ?, ?, ?, 'operator_retry', 'queued', ? WHERE EXISTS (
         SELECT 1 FROM notification_outbox WHERE delivery_id = ? AND queue_generation = ? AND status = 'queued')`,
    ).bind(crypto.randomUUID(), deliveryId, access.user.id, now, deliveryId, generation),
  ])
  if (queued[0]?.meta.changes !== 1) {
    return c.json(apiError('NOTIFICATION_DELIVERY_NOT_FOUND', 'This failed notification delivery was not found.'), 404)
  }
  try {
    await c.env.NOTIFICATION_QUEUE.send({ deliveryId, generation })
  } catch {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE notification_outbox SET status = 'failed', last_error_category = 'queue_enqueue_failed'
          WHERE delivery_id = ? AND queue_generation = ? AND status = 'queued'
            AND (send_lease_until IS NULL OR send_lease_until <= ?)`,
      ).bind(deliveryId, generation, now),
      c.env.DB.prepare(
        `INSERT INTO notification_retry_audit (id, delivery_id, actor_user_id, reason, result, created_at)
         VALUES (?, ?, ?, 'operator_retry', 'failed', ?)`,
      ).bind(crypto.randomUUID(), deliveryId, access.user.id, now),
    ])
    await writeMarketplaceAudit(c.env, {
      actorUserId: access.user.id, action: 'notification_retry_failed',
      targetType: 'notification_delivery', targetId: deliveryId,
    })
    return c.json(apiError('NOTIFICATION_RETRY_FAILED', 'The delivery could not be re-queued. Try again later.'), 503)
  }
  await writeMarketplaceAudit(c.env, {
    actorUserId: access.user.id, action: 'notification_retry_queued',
    targetType: 'notification_delivery', targetId: deliveryId,
  })
  return c.json({ result: 'queued' }, 202)
})

export default adminNotificationsApp
