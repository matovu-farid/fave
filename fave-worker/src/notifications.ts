import { Hono, type Context } from 'hono'
import type { AuthBindings } from './auth'
import { apiError, getSignedInUser } from './marketplace-auth'

const notificationsApp = new Hono<{ Bindings: AuthBindings }>()

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
