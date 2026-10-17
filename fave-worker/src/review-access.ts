import type { MiddlewareHandler } from 'hono'
import { createAuth, type AuthBindings } from './auth'
import { apiError } from './marketplace-auth'

export const REVIEW_UNLOCK_MS = 10 * 60 * 1000
export type ReviewSession = { user: { id: string }; session: { id: string; createdAt: Date | number; expiresAt: Date | number } }
export type ReviewMethod = 'passkey' | 'totp'

// This must match the auth cookie origin, including its explicit loopback allowlist.
export function reviewOrigin(env: AuthBindings, headers: Headers): string | null {
  const canonical = env.BETTER_AUTH_URL ? new URL(env.BETTER_AUTH_URL).origin : null
  const forwarded = headers.get('x-fave-web-origin')
  const local = forwarded && ['http://localhost:8081', 'http://127.0.0.1:8081'].includes(forwarded)
    && (env.WEB_APP_ORIGINS ?? '').split(',').map(s => s.trim()).includes(forwarded) ? forwarded : null
  const expected = local ?? canonical
  let source = headers.get('origin')
  if (!source && headers.get('referer')) {
    try { source = new URL(headers.get('referer')!).origin } catch { return null }
  }
  return expected && source === expected ? expected : null
}

export async function isReviewMember(env: AuthBindings, userId: string): Promise<boolean> {
  return !!await env.DB.prepare('SELECT 1 FROM review_memberships WHERE user_id = ? AND active = 1').bind(userId).first()
}

// Shared by ordinary review checks and transactional private-detail disclosure.
export const reviewProofSelect = `SELECT proof.expires_at, proof.method FROM review_session_proofs AS proof
    JOIN session ON session.id = proof.session_id AND session.userId = proof.user_id
    JOIN review_memberships AS member ON member.user_id = proof.user_id AND member.active = 1
    WHERE proof.session_id = ? AND proof.user_id = ? AND proof.origin = ?
      AND proof.expires_at > ? AND session.expiresAt > ? AND proof.verified_at >= member.granted_at
      AND ((proof.method = 'passkey' AND EXISTS (SELECT 1 FROM passkey
        WHERE passkey.id = proof.credential_id AND passkey.userId = proof.user_id))
        OR (proof.method = 'totp' AND EXISTS (SELECT 1 FROM twoFactor
        JOIN user ON user.id = twoFactor.userId WHERE twoFactor.id = proof.credential_id
        AND twoFactor.userId = proof.user_id AND twoFactor.verified = 1 AND user.twoFactorEnabled = 1)))`

export async function reviewProof(env: AuthBindings, session: ReviewSession, origin: string) {
  const now = Date.now()
  return env.DB.prepare(reviewProofSelect)
    .bind(session.session.id, session.user.id, origin, now, now)
    .first<{ expires_at: number; method: ReviewMethod }>()
}

export async function grantReviewProof(env: AuthBindings, session: ReviewSession, origin: string, method: ReviewMethod, credentialId: string, sourceSessionId: string, generation: number) {
  const now = Date.now()
  // A lock wins over verification already in flight, including session rotation.
  const result = await env.DB.batch([
    env.DB.prepare(`INSERT INTO review_session_proofs
      (session_id, user_id, source_session_id, origin, method, credential_id, verified_at, expires_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE COALESCE((SELECT generation FROM review_session_locks WHERE session_id=? AND user_id=?),0)=?
      ON CONFLICT(session_id) DO UPDATE SET
      source_session_id=excluded.source_session_id, origin=excluded.origin, method=excluded.method, credential_id=excluded.credential_id,
      verified_at=excluded.verified_at, expires_at=excluded.expires_at`)
      .bind(session.session.id, session.user.id, sourceSessionId, origin, method, credentialId, now, now + REVIEW_UNLOCK_MS, sourceSessionId, session.user.id, generation),
    env.DB.prepare(`INSERT INTO marketplace_audit_events
      (id,actor_user_id,actor_type,action,target_type,target_id,created_at)
      SELECT ?,?,'user',?,'review_session',?,? WHERE changes()=1`)
      .bind(crypto.randomUUID(),session.user.id,`review_unlocked_${method}`,session.session.id,now),
  ])
  return result[0].meta.changes===1
}

export const reviewAccess: MiddlewareHandler<{ Bindings: AuthBindings }> = async (c, next) => {
  c.header('Cache-Control', 'private, no-store')
  c.header('Pragma', 'no-cache')
  const session = await createAuth(c.env, c.req.raw.headers).api.getSession({ headers: c.req.raw.headers, query: { disableCookieCache: true } })
  if (!session) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)
  if (!await isReviewMember(c.env, session.user.id)) return c.json(apiError('FORBIDDEN', 'Only an authorized application reviewer can continue.'), 403)
  // Safe queues are the only review response allowed before strong verification.
  if (c.req.method === 'GET' && c.req.path.endsWith('/pending')) return next()
  const origin = reviewOrigin(c.env, c.req.raw.headers)
  if (!origin || !await reviewProof(c.env, session, origin)) {
    return c.json(apiError('REVIEW_UNLOCK_REQUIRED', 'Unlock reviews with your passkey or authenticator code.'), 428)
  }
  return next()
}
