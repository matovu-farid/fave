import { Hono } from 'hono'
import { createAuth, getWebAppOrigins, type AuthBindings } from './auth'
import { deletionReceiptQuery, deletionStatus, receiveDeletionRequest, type DeletionReceipt } from './account-lifecycle'
import { apiError, getSignedInUser } from './marketplace-auth'
import { reviewAccess, reviewOrigin, reviewProofSelect } from './review-access'

const accountRequests = new Hono<{ Bindings: AuthBindings }>()
accountRequests.use('*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store')
  c.header('Pragma', 'no-cache')
  return next()
})
accountRequests.get('/deletion-request', async c => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)
  const request = await deletionReceiptQuery(c.env, user.id).first<DeletionReceipt>()
  return c.json(deletionStatus(request))
})
accountRequests.post('/deletion-request', async c => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)
  if (c.req.header('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return c.json(apiError('JSON_REQUIRED', 'Send this request as JSON.'), 415)
  }
  const origin = c.req.header('origin')
  const allowed = [...getWebAppOrigins(c.env), ...(c.env.BETTER_AUTH_URL ? [new URL(c.env.BETTER_AUTH_URL).origin] : [])]
  if (origin && !allowed.includes(origin)) return c.json(apiError('FORBIDDEN', 'Use Fave to submit this request.'), 403)
  const body: unknown = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body) || (body as { confirmed?: unknown }).confirmed !== true) {
    return c.json(apiError('CONFIRMATION_REQUIRED', 'Confirm that you want to request account deletion.'), 400)
  }
  try {
    return c.json(deletionStatus(await receiveDeletionRequest(c.env, user.id)))
  } catch {
    return c.json(apiError('ACCOUNT_REQUEST_UNAVAILABLE', 'Your request could not be confirmed. Please try again.'), 503)
  }
})

export const adminAccountRequests = new Hono<{ Bindings: AuthBindings }>()
adminAccountRequests.use('*', reviewAccess)
adminAccountRequests.get('/pending', async c => {
  const after = c.req.query('after')
  const cursor = after ? await c.env.DB.prepare('SELECT id, requested_at FROM account_deletion_requests WHERE id = ?')
    .bind(after).first<{id:string; requested_at:number}>() : null
  if (after && !cursor) return c.json(apiError('INVALID_CURSOR', 'Refresh the account request queue.'), 400)
  const result = await c.env.DB.prepare(`SELECT id, status, requested_at AS requestedAt
    FROM account_deletion_requests
    ${cursor ? 'WHERE (requested_at, id) > (?, ?)' : ''}
    ORDER BY requested_at, id LIMIT 151`)
    .bind(...(cursor ? [cursor.requested_at, cursor.id] : [])).all<DeletionReceipt>()
  const requests = result.results.slice(0, 150)
  return c.json({ requests, nextCursor: result.results.length > 150 ? requests[149].id : null })
})
adminAccountRequests.post('/:id/detail', async c => {
  const session = await createAuth(c.env, c.req.raw.headers).api.getSession({headers:c.req.raw.headers, query:{disableCookieCache:true}})
  if (!session) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)
  const origin = reviewOrigin(c.env, c.req.raw.headers)
  if (!origin) return c.json(apiError('REVIEW_UNLOCK_REQUIRED', 'Unlock reviews to open this request.'), 428)
  const now = Date.now()
  const auditId = crypto.randomUUID()
  const result = await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO marketplace_audit_events
      (id, actor_user_id, actor_type, action, target_type, target_id, created_at)
      SELECT ?, ?, 'user', 'account_deletion_request_viewed', 'account_deletion_request', id, ?
      FROM account_deletion_requests WHERE id = ?
        AND EXISTS (${reviewProofSelect})`)
      .bind(auditId, session.user.id, now, c.req.param('id'), session.session.id, session.user.id, origin, now, now),
    c.env.DB.prepare(`SELECT request.id, request.status, request.requested_at AS requestedAt,
      request.user_id AS userId, user.name, user.email
      FROM account_deletion_requests AS request JOIN user ON user.id = request.user_id
      WHERE request.id = ? AND EXISTS (SELECT 1 FROM marketplace_audit_events WHERE id = ?)`)
      .bind(c.req.param('id'), auditId),
  ])
  const request = result[1].results[0]
  if (!request) return c.json(apiError('REVIEW_UNLOCK_REQUIRED', 'Unlock reviews again to open this request, or refresh the queue.'), 428)
  return c.json({ request })
})
export default accountRequests
