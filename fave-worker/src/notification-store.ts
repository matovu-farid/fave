import {
  getNotificationContract,
  validateNotificationEvent,
  type NotificationEventInput,
} from './notification-contracts'

type NotificationDatabase = Pick<D1Database, 'prepare' | 'batch'>

type NotificationPageItem = {
  id: string
  eventId: string
  eventType: string
  templateKey: string
  routeKey: string
  domainId: string
  priority: 'ordinary' | 'urgent' | 'time_sensitive'
  createdAt: number
  readAt: number | null
}

type NotificationCursor = { createdAt: number; id: string } | null

function changedRows(result: D1Result<unknown>): number {
  return result.meta.changes ?? 0
}

export function pushNotBefore(priority: string, now: number): number {
  if (priority !== 'ordinary') return now
  const kampala = new Date(now + 3 * 60 * 60 * 1000)
  const hour = kampala.getUTCHours()
  if (hour >= 8 && hour < 21) return now
  if (hour >= 21) kampala.setUTCDate(kampala.getUTCDate() + 1)
  kampala.setUTCHours(8, 0, 0, 0)
  return kampala.getTime() - 3 * 60 * 60 * 1000
}

function assertPageLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new RangeError('Notification page size must be between 1 and 50.')
  }
  return limit
}

async function getEventRecipients(db: NotificationDatabase, eventId: string) {
  const rows = await db.prepare(
    `SELECT notification.id, notification.recipient_user_id AS userId, outbox.delivery_id AS deliveryId
       FROM notifications AS notification
       LEFT JOIN notification_outbox AS outbox ON outbox.notification_id = notification.id
      WHERE notification.event_id = ?
      ORDER BY notification.recipient_user_id ASC`,
  ).bind(eventId).all<{ id: string; userId: string; deliveryId: string | null }>()

  return rows.results.map((row) => ({ id: row.id, userId: row.userId, deliveryId: row.deliveryId }))
}

export function buildNotificationEventStatements(
  db: NotificationDatabase,
  input: NotificationEventInput,
  now: number,
  options: { requirePriorChange?: boolean } = {},
): D1PreparedStatement[] {
  validateNotificationEvent(input)
  if (!Number.isSafeInteger(now) || now < input.occurredAt) {
    throw new TypeError('Notification persistence time must be at or after the event occurrence time.')
  }

  const contract = getNotificationContract(input.eventType)
  if (!contract) throw new TypeError('Unknown notification event.')
  const eventInsert = options.requirePriorChange
    ? `INSERT INTO notification_events
        (id, event_type, event_version, domain_type, domain_id, occurred_at, expires_at, payload_json, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, '{}', ? WHERE changes() = 1
       ON CONFLICT(id) DO NOTHING`
    : `INSERT INTO notification_events
        (id, event_type, event_version, domain_type, domain_id, occurred_at, expires_at, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?)
       ON CONFLICT(id) DO NOTHING`
  const statements: D1PreparedStatement[] = [
    db.prepare(eventInsert).bind(
      input.id,
      input.eventType,
      input.eventVersion,
      input.domainType,
      input.domainId,
      input.occurredAt,
      input.expiresAt ?? null,
      now,
    ),
  ]

  const sortedRecipients = [...input.recipients].sort((a, b) => a.userId.localeCompare(b.userId))
  for (const recipient of sortedRecipients) {
    const notificationInsert = options.requirePriorChange
      ? `INSERT INTO notifications
          (id, event_id, recipient_user_id, template_key, route_key, priority, created_at, read_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, NULL WHERE changes() = 1
         ON CONFLICT(event_id, recipient_user_id) DO NOTHING`
      : `INSERT INTO notifications
          (id, event_id, recipient_user_id, template_key, route_key, priority, created_at, read_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(event_id, recipient_user_id) DO NOTHING`
    statements.push(
      db.prepare(notificationInsert).bind(
        crypto.randomUUID(),
        input.id,
        recipient.userId,
        contract.templateKey,
        contract.routeKey,
        contract.priority,
        now,
      ),
    )
    statements.push(
      db.prepare(
        `INSERT INTO notification_outbox
          (delivery_id, notification_id, event_id, recipient_user_id, status, not_before, expires_at, attempt_count, created_at)
         SELECT ?, notification.id, ?, ?, 'pending', ?, ?, 0, ?
           FROM notifications AS notification
          WHERE notification.event_id = ? AND notification.recipient_user_id = ?
            ${options.requirePriorChange ? 'AND changes() = 1' : ''}
         ON CONFLICT(notification_id) DO NOTHING`,
      ).bind(
        crypto.randomUUID(),
        input.id,
        recipient.userId,
        pushNotBefore(contract.priority, now),
        input.expiresAt ?? null,
        now,
        input.id,
        recipient.userId,
      ),
    )
  }
  return statements
}

export async function createNotificationEvent(
  db: NotificationDatabase,
  input: NotificationEventInput,
  now: number,
) {
  validateNotificationEvent(input)
  const statements = buildNotificationEventStatements(db, input, now)

  const existing = await db.prepare(
    `SELECT event_type AS eventType, event_version AS eventVersion, domain_type AS domainType,
            domain_id AS domainId, occurred_at AS occurredAt, expires_at AS expiresAt
       FROM notification_events WHERE id = ? LIMIT 1`,
  ).bind(input.id).first<{
    eventType: string
    eventVersion: number
    domainType: string
    domainId: string
    occurredAt: number
    expiresAt: number | null
  }>()

  if (existing) {
    const matches = existing.eventType === input.eventType
      && existing.eventVersion === input.eventVersion
      && existing.domainType === input.domainType
      && existing.domainId === input.domainId
      && existing.occurredAt === input.occurredAt
      && existing.expiresAt === (input.expiresAt ?? null)
    if (!matches) throw new Error('Notification event ID was reused with different event data.')

    const recipients = await getEventRecipients(db, input.id)
    const expected = input.recipients.map((recipient) => recipient.userId).sort()
    if (JSON.stringify(recipients.map((recipient) => recipient.userId)) !== JSON.stringify(expected)) {
      throw new Error('Notification event ID was reused with different recipients.')
    }
    return {
      eventId: input.id,
      notifications: recipients,
    }
  }

  await db.batch(statements)
  return {
    eventId: input.id,
    notifications: await getEventRecipients(db, input.id),
  }
}

export async function listNotifications(
  db: NotificationDatabase,
  userId: string,
  cursor: NotificationCursor,
  limit: number,
) {
  const safeLimit = assertPageLimit(limit)
  const [page, unread] = await Promise.all([
    cursor
      ? db.prepare(
        `SELECT notification.id, notification.event_id AS eventId, event.event_type AS eventType,
                notification.template_key AS templateKey, notification.route_key AS routeKey,
                event.domain_id AS domainId, notification.priority, notification.created_at AS createdAt,
                notification.read_at AS readAt
           FROM notifications AS notification
           JOIN notification_events AS event ON event.id = notification.event_id
          WHERE notification.recipient_user_id = ?
            AND (notification.created_at < ? OR (notification.created_at = ? AND notification.id < ?))
          ORDER BY notification.created_at DESC, notification.id DESC
          LIMIT ?`,
      ).bind(userId, cursor.createdAt, cursor.createdAt, cursor.id, safeLimit)
        .all<NotificationPageItem>()
      : db.prepare(
        `SELECT notification.id, notification.event_id AS eventId, event.event_type AS eventType,
                notification.template_key AS templateKey, notification.route_key AS routeKey,
                event.domain_id AS domainId, notification.priority, notification.created_at AS createdAt,
                notification.read_at AS readAt
           FROM notifications AS notification
           JOIN notification_events AS event ON event.id = notification.event_id
          WHERE notification.recipient_user_id = ?
          ORDER BY notification.created_at DESC, notification.id DESC
          LIMIT ?`,
      ).bind(userId, safeLimit).all<NotificationPageItem>(),
    db.prepare(
      'SELECT COUNT(*) AS count FROM notifications WHERE recipient_user_id = ? AND read_at IS NULL',
    ).bind(userId).first<{ count: number }>(),
  ])

  return {
    items: page.results,
    unreadCount: unread?.count ?? 0,
    nextCursor: page.results.length === safeLimit
      ? { createdAt: page.results[page.results.length - 1].createdAt, id: page.results[page.results.length - 1].id }
      : null,
  }
}

export async function markNotificationRead(
  db: NotificationDatabase,
  userId: string,
  notificationId: string,
  now: number,
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE notifications SET read_at = COALESCE(read_at, ?)
      WHERE id = ? AND recipient_user_id = ?`,
  ).bind(now, notificationId, userId).run()
  return changedRows(result) === 1
}

export async function markAllNotificationsRead(
  db: NotificationDatabase,
  userId: string,
  now: number,
): Promise<number> {
  const result = await db.prepare(
    `UPDATE notifications SET read_at = ?
      WHERE recipient_user_id = ? AND read_at IS NULL`,
  ).bind(now, userId).run()
  return changedRows(result)
}

export async function claimDueNotificationDeliveries(
  db: NotificationDatabase,
  now: number,
  leaseUntil: number,
  limit: number,
) {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)))
  await db.batch([
    db.prepare(
      `UPDATE notification_outbox SET status = 'expired', lease_until = NULL
        WHERE status IN ('pending', 'processing') AND expires_at IS NOT NULL AND expires_at <= ?`,
    ).bind(now),
  ])
  const rows = await db.prepare(
    `UPDATE notification_outbox
        SET status = 'processing', attempt_count = attempt_count + 1,
            lease_until = ?, last_attempt_at = ?
      WHERE delivery_id IN (
        SELECT delivery_id FROM notification_outbox
         WHERE status IN ('pending', 'processing') AND not_before <= ?
           AND (expires_at IS NULL OR expires_at > ?)
           AND (lease_until IS NULL OR lease_until <= ?)
           AND (send_lease_until IS NULL OR send_lease_until <= ?)
         ORDER BY not_before ASC, created_at ASC
         LIMIT ?
      )
      RETURNING delivery_id AS deliveryId, notification_id AS notificationId,
                event_id AS eventId, recipient_user_id AS recipientUserId,
                expires_at AS expiresAt, attempt_count AS attemptCount`,
  ).bind(leaseUntil, now, now, now, now, now, safeLimit).all<{
    deliveryId: string
    notificationId: string
    eventId: string
    recipientUserId: string
    expiresAt: number | null
    attemptCount: number
  }>()
  return rows.results
}
