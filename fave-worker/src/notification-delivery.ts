import type { AuthBindings } from './auth'
import { claimDueNotificationDeliveries } from './notification-store'

type NotificationQueueMessage = { deliveryId: string }
type PushDevice = { id: string; token: string; platform: 'ios' | 'android' }
type DeliveryRecord = {
  deliveryId: string
  notificationId: string
  recipientUserId: string
  templateKey: string
  routeKey: string
  targetId: string
  priority: string
  expiresAt: number | null
}

const pushCopy: Record<string, { title: string; body: string }> = {
  availability_confirmed: { title: 'Your car is available', body: 'Fave confirmed your dates. Review your saved-price quote before the hold expires.' },
  availability_unavailable: { title: 'Please choose another car', body: 'Fave could not confirm your selected car. No deposit is due.' },
  availability_expired: { title: 'Your quote hold ended', body: 'The quote window has ended. Check current availability for a new estimate.' },
  quote_requested: { title: 'Trip request sent', body: 'Your trip request is waiting for a driver.' },
  driver_offer_received: { title: 'New trip offer', body: 'A trip offer is waiting for your response.' },
  driver_offer_accepted: { title: 'Driver accepted', body: 'Your driver accepted. Your quote is ready soon.' },
  driver_offer_declined: { title: 'Driver unavailable', body: 'The selected driver cannot take this trip. Choose another car.' },
  driver_offer_expired: { title: 'Trip request expired', body: 'The driver did not respond in time. Choose another car.' },
  booking_hold_created: { title: 'Booking hold created', body: 'Your selected car is held while you complete the deposit.' },
  booking_withdrawn: { title: 'Trip request updated', body: 'A trip request was withdrawn.' },
  quote_status_changed: { title: 'Your quote is ready', body: 'Review the trip price and booking details in Fave.' },
  deposit_status_changed: { title: 'Booking payment updated', body: 'There is an update to your booking payment.' },
  booking_cancelled: { title: 'Booking updated', body: 'There is an update to your booking.' },
  booking_expired: { title: 'Booking hold expired', body: 'The booking hold ended before the deposit was completed.' },
  driver_assignment_changed: { title: 'Driver assignment updated', body: 'There is an update to the driver for your trip.' },
  trip_progress_changed: { title: 'Trip update', body: 'There is an update to your trip.' },
  trip_check_in_required: { title: 'Trip check-in', body: 'Please open Fave for an important trip check-in.' },
  balance_due: { title: 'Trip balance due', body: 'Open Fave to review your trip balance.' },
  balance_paid: { title: 'Payment received', body: 'Your trip payment has been updated.' },
  safety_incident_updated: { title: 'Safety update', body: 'Open Fave for an important safety update.' },
  support_update: { title: 'Support update', body: 'There is an update to your Fave support request.' },
}

export function safeNotificationCopy(templateKey: string) {
  return pushCopy[templateKey] ?? { title: 'Fave update', body: 'Open Fave to review your latest update.' }
}

function safeDeliveryId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f]/u.test(value)
}

export async function dispatchDueNotificationDeliveries(env: AuthBindings, now = Date.now()): Promise<number> {
  const deliveries = await claimDueNotificationDeliveries(env.DB, now, now + 5 * 60_000, 100)
  let queued = 0
  for (const delivery of deliveries) {
    try {
      await env.NOTIFICATION_QUEUE.send({ deliveryId: delivery.deliveryId })
      await env.DB.prepare(
        `UPDATE notification_outbox SET status = 'queued', queued_at = ?, lease_until = NULL,
             last_error_category = NULL
          WHERE delivery_id = ? AND status = 'processing'`,
      ).bind(now, delivery.deliveryId).run()
      queued += 1
    } catch {
      await env.DB.prepare(
        `UPDATE notification_outbox SET status = 'pending', not_before = ?, lease_until = NULL,
             last_error_category = 'queue_enqueue_failed'
          WHERE delivery_id = ? AND status = 'processing'`,
      ).bind(now + 60_000, delivery.deliveryId).run()
    }
  }
  return queued
}

async function loadDelivery(env: AuthBindings, deliveryId: string): Promise<DeliveryRecord | null> {
  return env.DB.prepare(
    `SELECT outbox.delivery_id AS deliveryId, outbox.notification_id AS notificationId,
            outbox.recipient_user_id AS recipientUserId, notification.template_key AS templateKey,
            notification.route_key AS routeKey, event.domain_id AS targetId,
            notification.priority, outbox.expires_at AS expiresAt
       FROM notification_outbox AS outbox
       JOIN notifications AS notification ON notification.id = outbox.notification_id
       JOIN notification_events AS event ON event.id = outbox.event_id
      WHERE outbox.delivery_id = ? AND notification.recipient_user_id = outbox.recipient_user_id
      LIMIT 1`,
  ).bind(deliveryId).first<DeliveryRecord>()
}

async function recordDeviceDelivery(
  env: AuthBindings,
  deliveryId: string,
  device: PushDevice,
  status: string,
  now: number,
  ticketId: string | null = null,
  errorCategory: string | null = null,
) {
  await env.DB.prepare(
    `INSERT INTO notification_deliveries
       (id, delivery_id, push_token_id, platform, status, expo_ticket_id, attempt_count,
        last_error_category, last_attempt_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
     ON CONFLICT(delivery_id, push_token_id) DO UPDATE SET
       status = excluded.status, expo_ticket_id = excluded.expo_ticket_id,
       attempt_count = notification_deliveries.attempt_count + 1,
       last_error_category = excluded.last_error_category,
       last_attempt_at = excluded.last_attempt_at, updated_at = excluded.updated_at`,
  ).bind(crypto.randomUUID(), deliveryId, device.id, device.platform, status, ticketId, errorCategory, now, now, now).run()
}

async function sendToExpo(
  fetcher: typeof fetch,
  token: string,
  title: string,
  body: string,
  notificationId: string,
  routeKey: string,
  targetId: string,
) {
  const response = await fetcher('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ to: token, title, body, data: { notificationId, routeKey, targetId }, sound: 'default' }),
  })
  const result = await response.json() as {
    data?: { status?: string; id?: string; details?: { error?: string } } | Array<{ status?: string; id?: string; details?: { error?: string } }>
    errors?: Array<{ code?: string }>
  }
  if (!response.ok) {
    const category = response.status === 429 || response.status >= 500 ? 'expo_temporary_failure' : 'expo_configuration_failure'
    throw Object.assign(new Error(category), { category, retryable: category === 'expo_temporary_failure' })
  }
  const ticket = Array.isArray(result.data) ? result.data[0] : result.data
  if (!ticket || ticket.status !== 'ok' || !ticket.id) {
    if (ticket?.details?.error === 'DeviceNotRegistered') return { deviceUnregistered: true as const }
    if (ticket?.details?.error === 'MessageRateExceeded') {
      throw Object.assign(new Error('expo_temporary_failure'), { category: 'expo_temporary_failure', retryable: true })
    }
    return { permanentFailure: true as const, category: 'expo_ticket_rejected' }
  }
  return { ticketId: ticket.id }
}

async function consumeDelivery(
  env: AuthBindings,
  deliveryId: string,
  fetcher: typeof fetch,
  now: number,
) {
  const delivery = await loadDelivery(env, deliveryId)
  if (!delivery) return 'ignored'
  if (delivery.expiresAt !== null && delivery.expiresAt <= now) {
    await env.DB.prepare("UPDATE notification_outbox SET status = 'expired', lease_until = NULL WHERE delivery_id = ?")
      .bind(deliveryId).run()
    return 'expired'
  }
  const copy = safeNotificationCopy(delivery.templateKey)
  const devices = await env.DB.prepare(
    `SELECT id, token, platform FROM notification_push_tokens WHERE user_id = ? ORDER BY last_registered_at DESC`,
  ).bind(delivery.recipientUserId).all<PushDevice>()
  if (devices.results.length === 0) {
    await env.DB.prepare("UPDATE notification_outbox SET status = 'suppressed', lease_until = NULL WHERE delivery_id = ?")
      .bind(deliveryId).run()
    return 'suppressed'
  }

  let retryableFailure = false
  for (const device of devices.results) {
    const previous = await env.DB.prepare(
      `SELECT status FROM notification_deliveries WHERE delivery_id = ? AND push_token_id = ? LIMIT 1`,
    ).bind(deliveryId, device.id).first<{ status: string }>()
    if (previous?.status === 'expo_accepted' || previous?.status === 'receipt_ok' || previous?.status === 'device_unregistered') continue
    try {
      const result = await sendToExpo(fetcher, device.token, copy.title, copy.body, delivery.notificationId, delivery.routeKey, delivery.targetId)
      if ('deviceUnregistered' in result) {
        await recordDeviceDelivery(env, deliveryId, device, 'device_unregistered', now, null, 'device_not_registered')
        await env.DB.prepare('DELETE FROM notification_push_tokens WHERE id = ?').bind(device.id).run()
      } else if ('permanentFailure' in result) {
        await recordDeviceDelivery(env, deliveryId, device, 'failed', now, null, result.category)
      } else {
        await recordDeviceDelivery(env, deliveryId, device, 'expo_accepted', now, result.ticketId)
      }
    } catch (error) {
      const category = typeof error === 'object' && error !== null && 'category' in error
        ? String(error.category)
        : 'expo_network_failure'
      const retryable = typeof error === 'object' && error !== null && 'retryable' in error
        ? error.retryable === true
        : true
      await recordDeviceDelivery(env, deliveryId, device, retryable ? 'retrying' : 'failed', now, null, category)
      retryableFailure ||= retryable
    }
  }
  await env.DB.prepare(
    `UPDATE notification_outbox SET status = ?, attempt_count = attempt_count + 1,
         last_attempt_at = ?, last_error_category = ?, lease_until = NULL
      WHERE delivery_id = ?`,
  ).bind(retryableFailure ? 'queued' : 'complete', now, retryableFailure ? 'expo_temporary_failure' : null, deliveryId).run()
  return retryableFailure ? 'retry' : 'complete'
}

export async function handleNotificationQueue(
  batch: MessageBatch<NotificationQueueMessage>,
  env: AuthBindings,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
) {
  for (const message of batch.messages) {
    const deliveryId = message.body && typeof message.body === 'object'
      ? (message.body as Record<string, unknown>).deliveryId
      : null
    const bodyKeys = message.body && typeof message.body === 'object' ? Object.keys(message.body) : []
    if (!safeDeliveryId(deliveryId) || bodyKeys.length !== 1 || bodyKeys[0] !== 'deliveryId') {
      message.ack()
      continue
    }
    if (batch.queue === 'fave-notification-dlq') {
      await env.DB.batch([
        env.DB.prepare("UPDATE notification_outbox SET status = 'dead_lettered', last_error_category = 'queue_retry_limit', lease_until = NULL WHERE delivery_id = ?")
          .bind(deliveryId),
        env.DB.prepare("UPDATE notification_deliveries SET status = 'dead_lettered', last_error_category = 'queue_retry_limit', updated_at = ? WHERE delivery_id = ? AND status IN ('retrying', 'queued')")
          .bind(now, deliveryId),
      ])
      message.ack()
      continue
    }
    try {
      const result = await consumeDelivery(env, deliveryId, fetcher, now)
      if (result === 'retry') message.retry({ delaySeconds: 60 })
      else message.ack()
    } catch {
      await env.DB.prepare(
        `UPDATE notification_outbox SET status = 'queued', attempt_count = attempt_count + 1,
             last_attempt_at = ?, last_error_category = 'delivery_processing_failure', lease_until = NULL
          WHERE delivery_id = ?`,
      ).bind(now, deliveryId).run()
      message.retry({ delaySeconds: 60 })
    }
  }
}

export async function sweepExpoReceipts(env: AuthBindings, fetcher: typeof fetch = fetch, now = Date.now()): Promise<number> {
  const due = await env.DB.prepare(
    `SELECT delivery.id, delivery.delivery_id AS deliveryId, delivery.push_token_id AS tokenId,
            delivery.expo_ticket_id AS ticketId, delivery.platform,
            delivery.last_attempt_at AS lastAttemptAt
       FROM notification_deliveries AS delivery
      WHERE delivery.status = 'expo_accepted' AND delivery.expo_ticket_id IS NOT NULL
        AND delivery.last_attempt_at <= ?
        AND (delivery.receipt_checked_at IS NULL OR delivery.receipt_checked_at <= ?)
      ORDER BY delivery.last_attempt_at ASC LIMIT 1000`,
  ).bind(now - 15 * 60_000, now - 15 * 60_000).all<{
    id: string; deliveryId: string; tokenId: string | null; ticketId: string; platform: string; lastAttemptAt: number
  }>()
  let checked = 0
  for (let offset = 0; offset < due.results.length; offset += 1000) {
    const items = due.results.slice(offset, offset + 1000)
    if (items.length === 0) continue
    const response = await fetcher('https://exp.host/--/api/v2/push/getReceipts', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ids: items.map(item => item.ticketId) }),
    })
    if (!response.ok) throw new Error('expo_receipt_service_unavailable')
    const payload = await response.json() as { data?: Record<string, { status?: string; details?: { error?: string } }> }
    for (const item of items) {
      const receipt = payload.data?.[item.ticketId]
      if (!receipt) {
        const missingExpired = now - item.lastAttemptAt >= 24 * 60 * 60_000
        await env.DB.prepare(
          `UPDATE notification_deliveries SET receipt_checked_at = ?, updated_at = ?,
               status = CASE WHEN ? = 1 THEN 'failed' ELSE status END,
               last_error_category = CASE WHEN ? = 1 THEN 'expo_receipt_missing' ELSE last_error_category END
            WHERE id = ?`,
        ).bind(now, now, missingExpired ? 1 : 0, missingExpired ? 1 : 0, item.id).run()
        continue
      }
      if (receipt.details?.error === 'DeviceNotRegistered' && item.tokenId) {
        await env.DB.batch([
          env.DB.prepare('DELETE FROM notification_push_tokens WHERE id = ?').bind(item.tokenId),
          env.DB.prepare(
            `UPDATE notification_deliveries SET status = 'device_unregistered', receipt_status = 'error',
                 last_error_category = 'device_not_registered', receipt_checked_at = ?, updated_at = ? WHERE id = ?`,
          ).bind(now, now, item.id),
        ])
      } else {
        await env.DB.prepare(
          `UPDATE notification_deliveries SET status = ?, receipt_status = ?, receipt_checked_at = ?, updated_at = ?,
               last_error_category = ? WHERE id = ?`,
        ).bind(receipt.status === 'ok' ? 'receipt_ok' : 'failed', receipt.status ?? 'unknown', now, now,
          receipt.status === 'ok' ? null : 'expo_receipt_error', item.id).run()
      }
      checked += 1
    }
  }
  return checked
}
