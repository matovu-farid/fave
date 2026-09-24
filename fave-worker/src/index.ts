import { Hono } from 'hono'
import { createAuth, type AuthBindings } from './auth'

const app = new Hono<{ Bindings: AuthBindings }>()

app.all('/api/auth/*', (c) => createAuth(c.env).handler(c.req.raw))

app.get('/', (c) => {
  return c.text('Hello Hono!')
})

app.get('/health', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1').first()
    return c.json({ status: 'ok', database: 'ok' })
  } catch {
    return c.json({ status: 'error', database: 'unavailable' }, 503)
  }
})

app.get('/api/me', async (c) => {
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  })

  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  return c.json({ user: session.user })
})

export default app
