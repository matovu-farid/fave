import type { MiddlewareHandler } from 'hono'
import { createAuth, type AuthBindings } from './auth'
import { apiError } from './marketplace-auth'
import { guardedReviewBody } from './review-response'

export const REVIEW_UNLOCK_MS = 10 * 60 * 1000
export type ReviewSession = { user: { id: string }; session: { id: string; createdAt: Date | number; expiresAt: Date | number } }
export type ReviewMethod = 'passkey' | 'totp'
export type ReviewProof = {expires_at:number;method:ReviewMethod;verified_at:number;credential_id:string;source_session_id:string;lock_generation:number;source_lock_generation:number}
export type ReviewAuthorization = {session:ReviewSession;origin:string;proof:ReviewProof}
export type ReviewEnvironment = {Bindings:AuthBindings;Variables:{reviewAuthorization:ReviewAuthorization}}

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
export const reviewProofSelect = `SELECT proof.expires_at, proof.method, proof.verified_at, proof.credential_id, proof.source_session_id,
    COALESCE((SELECT generation FROM review_session_locks WHERE session_id=proof.session_id AND user_id=proof.user_id),0) AS lock_generation,
    COALESCE((SELECT generation FROM review_session_locks WHERE session_id=proof.source_session_id AND user_id=proof.user_id),0) AS source_lock_generation
    FROM review_session_proofs AS proof
    JOIN session ON session.id = proof.session_id AND session.userId = proof.user_id
    JOIN review_memberships AS member ON member.user_id = proof.user_id AND member.active = 1
    WHERE proof.session_id = ? AND proof.user_id = ? AND proof.origin = ?
      AND proof.expires_at > MAX(?, CAST(unixepoch('subsec')*1000 AS INTEGER))
      AND session.expiresAt > MAX(?, CAST(unixepoch('subsec')*1000 AS INTEGER)) AND proof.verified_at >= member.granted_at
      AND ((proof.method = 'passkey' AND EXISTS (SELECT 1 FROM passkey
        WHERE passkey.id = proof.credential_id AND passkey.userId = proof.user_id))
        OR (proof.method = 'totp' AND EXISTS (SELECT 1 FROM twoFactor
        JOIN user ON user.id = twoFactor.userId WHERE twoFactor.id = proof.credential_id
        AND twoFactor.userId = proof.user_id AND twoFactor.verified = 1 AND user.twoFactorEnabled = 1)))`

export async function reviewProof(env: AuthBindings, session: ReviewSession, origin: string) {
  const now = Date.now()
  return env.DB.prepare(reviewProofSelect)
    .bind(session.session.id, session.user.id, origin, now, now)
    .first<ReviewProof>()
}

// Match the proof used at request entry, rather than borrowing a later unlock.
// The lock generation distinguishes otherwise identical same-millisecond proofs.
export const reviewGuardSelect = `${reviewProofSelect}
  AND proof.verified_at=? AND proof.expires_at=? AND proof.method=? AND proof.credential_id=? AND proof.source_session_id=?
  AND COALESCE((SELECT generation FROM review_session_locks WHERE session_id=proof.session_id AND user_id=proof.user_id),0)=?
  AND COALESCE((SELECT generation FROM review_session_locks WHERE session_id=proof.source_session_id AND user_id=proof.user_id),0)=?`
export function reviewGuardBindings(authorization:ReviewAuthorization,now=Date.now()):(string|number)[] {
  const {session,origin,proof}=authorization
  return [session.session.id,session.user.id,origin,now,now,proof.verified_at,proof.expires_at,proof.method,proof.credential_id,proof.source_session_id,proof.lock_generation,proof.source_lock_generation]
}
export async function reviewSnapshotValid(env:AuthBindings,authorization:ReviewAuthorization):Promise<boolean> {
  return !!await env.DB.prepare(reviewGuardSelect).bind(...reviewGuardBindings(authorization)).first()
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

export const reviewAccess: MiddlewareHandler<ReviewEnvironment> = async (c, next) => {
  c.header('Cache-Control', 'private, no-store')
  c.header('Pragma', 'no-cache')
  const session = await createAuth(c.env, c.req.raw.headers).api.getSession({ headers: c.req.raw.headers, query: { disableCookieCache: true } })
  if (!session) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)
  if (!await isReviewMember(c.env, session.user.id)) return c.json(apiError('FORBIDDEN', 'Only an authorized application reviewer can continue.'), 403)
  // Safe queues are the only review response allowed before strong verification.
  if (c.req.method === 'GET' && c.req.path.endsWith('/pending') && c.req.query('status') !== 'reviewed') return next()
  const origin = reviewOrigin(c.env, c.req.raw.headers)
  const proof=origin?await reviewProof(c.env,session,origin):null
  if (!origin || !proof) {
    return c.json(apiError('REVIEW_UNLOCK_REQUIRED', 'Unlock reviews with your passkey or authenticator code.'), 428)
  }
  const authorization:ReviewAuthorization={session,origin,proof}
  c.set('reviewAuthorization',authorization)
  await next()
  if(c.res.status>=400)return
  const authorized=()=>reviewSnapshotValid(c.env,authorization)
  let allowed:boolean
  try {allowed=await authorized()}
  catch {
    await c.res.body?.cancel().catch(()=>{})
    c.res=c.json(apiError('REVIEW_CHECK_UNAVAILABLE','Review access could not be checked. Refresh and try again.'),503)
    return
  }
  if(!allowed) {
    await c.res.body?.cancel().catch(()=>{})
    c.res=c.json(apiError('REVIEW_UNLOCK_REQUIRED','Reviews locked. Unlock again and refresh to check current status.'),428)
    return
  }
  if(c.res.body)c.res=new Response(guardedReviewBody(c.res.body,authorized),c.res)
}
