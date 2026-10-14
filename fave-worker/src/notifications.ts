import { Hono, type Context } from 'hono'
import type { AuthBindings } from './auth'
import { apiError, getSignedInUser } from './marketplace-auth'
import { listNotifications, markAllNotificationsRead, markNotificationRead } from './notification-store'
import { safeNotificationCopy } from './notification-delivery'

const notificationsApp = new Hono<{ Bindings: AuthBindings }>()

notificationsApp.get('/inbox', async (c) => {
  const access = await requireUser(c)
  if ('error' in access) return access.error

  const rawLimit = Number(c.req.query('limit') ?? 20)
  const limit = Number.isSafeInteger(rawLimit) ? Math.max(1, Math.min(50, rawLimit)) : 20
  const rawCreatedAt = c.req.query('createdAt')
  const rawId = c.req.query('id')
  const createdAt = rawCreatedAt && /^\d{1,16}$/u.test(rawCreatedAt) ? Number(rawCreatedAt) : null
  const cursor = createdAt !== null && rawId && rawId.length <= 128
    ? { createdAt, id: rawId }
    : null

  const page = await listNotifications(c.env.DB, access.user.id, cursor, limit)
  return c.json({
    notifications: page.items.map((item) => ({
      id: item.id,
      ...safeNotificationCopy(item.templateKey),
      routeKey: item.routeKey,
      targetId: item.domainId,
      priority: item.priority,
      createdAt: item.createdAt,
      readAt: item.readAt,
      isRead: item.readAt !== null,
    })),
    unreadCount: page.unreadCount,
    nextCursor: page.nextCursor,
  })
})

notificationsApp.post('/inbox/read-all', async (c) => {
  const access = await requireUser(c)
  if ('error' in access) return access.error
  const readAt = Date.now()
  const updated = await markAllNotificationsRead(c.env.DB, access.user.id, readAt)
  return c.json({ updated, readAt })
})

notificationsApp.post('/inbox/:notificationId/read', async (c) => {
  const access = await requireUser(c)
  if ('error' in access) return access.error
  const readAt = Date.now()
  const updated = await markNotificationRead(c.env.DB, access.user.id, c.req.param('notificationId'), readAt)
  return updated
    ? c.json({ read: true, readAt })
    : c.json(apiError('NOTIFICATION_NOT_FOUND', 'This notification was not found.'), 404)
})

function parsePushToken(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 512) return null
  return /^(?:Expo|Exponent)PushToken\[[^\]\s]{1,256}\]$/u.test(value) ? value : null
}

function parsePlatform(value: unknown): 'ios' | 'android' | null {
  return value === 'ios' || value === 'android' ? value : null
}

async function requireUser(c: Context<{ Bindings: AuthBindings }>) {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return { error: c.json(apiError('UNAUTHORIZED', 'Sign in to manage notifications.'), 401) }
  return { user }
}

notificationsApp.post('/push-tokens', async (c) => {
  const access = await requireUser(c)
  if ('error' in access) return access.error

  const body: unknown = await c.req.json().catch(() => null)
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return c.json(apiError('INVALID_PUSH_TOKEN', 'Provide a valid device push token.'), 400)
  }

  const input = body as Record<string, unknown>
  const token = parsePushToken(input.token)
  const platform = parsePlatform(input.platform)
  if (!token || !platform) {
    return c.json(apiError('INVALID_PUSH_TOKEN', 'Provide a valid device push token and platform.'), 400)
  }

  const now = Date.now()
  await c.env.DB.prepare(
    `INSERT INTO notification_push_tokens
       (id, user_id, token, platform, created_at, last_registered_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(token) DO UPDATE SET
       user_id = excluded.user_id,
       platform = excluded.platform,
       last_registered_at = excluded.last_registered_at`,
  ).bind(crypto.randomUUID(), access.user.id, token, platform, now, now).run()

  return c.json({ registered: true })
})

notificationsApp.delete('/push-tokens', async (c) => {
  const access = await requireUser(c)
  if ('error' in access) return access.error

  const body: unknown = await c.req.json().catch(() => null)
  const token = typeof body === 'object' && body !== null && !Array.isArray(body)
    ? parsePushToken((body as Record<string, unknown>).token)
    : null
  if (!token) return c.json(apiError('INVALID_PUSH_TOKEN', 'Provide a valid device push token.'), 400)

  await c.env.DB.prepare(
    'DELETE FROM notification_push_tokens WHERE token = ? AND user_id = ?',
  ).bind(token, access.user.id).run()

  return c.body(null, 204)
})

export default notificationsApp
