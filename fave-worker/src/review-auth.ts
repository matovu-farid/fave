import { passkey } from '@better-auth/passkey'
import { APIError, createAuthMiddleware, getAuthoritativeSessionFromCtx, isAPIError } from 'better-auth/api'
import { twoFactor } from 'better-auth/plugins/two-factor'
import type { AuthBindings } from './auth'
import { grantReviewProof, isReviewMember, reviewOrigin, reviewProof, REVIEW_UNLOCK_MS, type ReviewSession } from './review-access'
import { writeMarketplaceAudit } from './marketplace-auth'

const allowedPaths = new Set([
  '/passkey/generate-register-options', '/passkey/verify-registration',
  '/passkey/generate-authenticate-options', '/passkey/verify-authentication',
  '/passkey/list-user-passkeys', '/passkey/delete-passkey', '/passkey/update-passkey',
  '/two-factor/enable', '/two-factor/verify-totp', '/two-factor/disable',
])
const management = new Set([
  '/passkey/generate-register-options', '/passkey/verify-registration',
  '/passkey/delete-passkey', '/passkey/update-passkey', '/two-factor/enable', '/two-factor/disable',
])
const denied = (code: string, message: string) => new APIError('FORBIDDEN', { code, message })

// createAuth constructs this per request. Verification state must never be global.
export function createReviewAuth(env: AuthBindings, origin: string) {
  let active: { session: ReviewSession; origin: string; generation: number } | null = null
  let verifiedKey: { id: string; userId: string } | null = null

  async function factors(userId: string) {
    const keys = await env.DB.prepare('SELECT id FROM passkey WHERE userId = ?').bind(userId).all<{ id: string }>()
    const totp = await env.DB.prepare('SELECT id FROM twoFactor WHERE userId = ? AND verified = 1').bind(userId).first<{ id: string }>()
    return { keys: keys.results, totp, count: keys.results.length + (totp ? 1 : 0) }
  }

  async function takeAttempt(userId: string) {
    const now = Date.now()
    const budget = await env.DB.prepare(`INSERT INTO review_auth_attempts (user_id, window_start, attempts) VALUES (?, ?, 1)
      ON CONFLICT(user_id) DO UPDATE SET
      window_start = CASE WHEN window_start <= ? THEN excluded.window_start ELSE window_start END,
      attempts = CASE WHEN window_start <= ? THEN 1 ELSE attempts + 1 END
      WHERE window_start <= ? OR attempts < 10 RETURNING attempts`)
      .bind(userId, now, now-REVIEW_UNLOCK_MS, now-REVIEW_UNLOCK_MS, now-REVIEW_UNLOCK_MS).first()
    if (!budget) throw new APIError('TOO_MANY_REQUESTS', { code: 'REVIEW_RATE_LIMITED', message: 'Too many unlock attempts. Try again in ten minutes.' })
  }

  return {
    plugins: [
      passkey({
        rpID: new URL(origin).hostname,
        rpName: 'Fave staff',
        origin,
        authenticatorSelection: { userVerification: 'required' },
        registration: {
          afterVerification: async ({ verification, user }) => {
            if (!active || user.id !== active.session.user.id || !verification.registrationInfo?.userVerified) {
              throw denied('REVIEW_VERIFICATION_FAILED', 'Verify using your device PIN or biometric.')
            }
          },
        },
        authentication: {
          afterVerification: async ({ verification, clientData }) => {
            const key = await env.DB.prepare('SELECT id, userId FROM passkey WHERE credentialID = ?').bind(clientData.id).first<{ id: string; userId: string }>()
            if (!active || !key || key.userId !== active.session.user.id || !verification.authenticationInfo.userVerified) {
              throw denied('REVIEW_VERIFICATION_FAILED', 'This passkey cannot unlock your reviews.')
            }
            verifiedKey = key
          },
        },
      }),
      twoFactor({ issuer: 'Fave staff', allowPasswordless: true }),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (!ctx.path?.startsWith('/passkey/') && !ctx.path?.startsWith('/two-factor/')) return
        // Fail closed for every plugin endpoint, including OTP, recovery codes and URI re-export.
        if (!allowedPaths.has(ctx.path)) throw denied('REVIEW_METHOD_UNAVAILABLE', 'Use a passkey or authenticator app.')
        const session = await getAuthoritativeSessionFromCtx(ctx)
        if (!session) throw new APIError('UNAUTHORIZED', { code: 'UNAUTHORIZED', message: 'Sign in to continue.' })
        if (!await isReviewMember(env, session.user.id)) throw denied('REVIEWER_REQUIRED', 'Only an authorized application reviewer can continue.')
        const requestOrigin = ctx.headers ? reviewOrigin(env, ctx.headers) : null
        if (!requestOrigin || requestOrigin !== origin) throw denied('REVIEW_ORIGIN_INVALID', 'Open the staff console to continue.')
        const lock = await env.DB.prepare('SELECT generation FROM review_session_locks WHERE session_id=? AND user_id=?').bind(session.session.id,session.user.id).first<{generation:number}>()
        active = { session, origin: requestOrigin, generation: lock?.generation??0 }
        if (ctx.body?.trustDevice || ctx.body?.createSession) throw denied('REVIEW_OPTION_INVALID', 'Use a fresh staff verification.')
        if (management.has(ctx.path)) {
          const configured = await factors(session.user.id)
          const proof = await reviewProof(env, session, requestOrigin)
          const firstEnrollment = configured.count === 0 && ['/two-factor/enable', '/passkey/generate-register-options', '/passkey/verify-registration'].includes(ctx.path)
          const age = Date.now() - new Date(session.session.createdAt).getTime()
          if (!proof && (!firstEnrollment || age < 0 || age >= REVIEW_UNLOCK_MS)) {
            throw denied('REVIEW_UNLOCK_REQUIRED', configured.count ? 'Verify an existing method before changing security.' : 'Sign in again before setting up staff security.')
          }
          if (ctx.path === '/two-factor/enable' && ctx.body?.method && ctx.body.method !== 'totp') throw denied('REVIEW_METHOD_UNAVAILABLE', 'Use an authenticator app.')
          if (ctx.path === '/two-factor/disable' || ctx.path === '/passkey/delete-passkey') {
            const removingOwnKey = configured.keys.some(key => key.id === ctx.body?.id)
            if ((ctx.path === '/two-factor/disable' && configured.totp || removingOwnKey) && configured.count <= 1) {
              throw denied('REVIEW_LAST_METHOD', 'Set up another method before removing your last one.')
            }
          }
        }
        if (ctx.path === '/passkey/verify-authentication' || ctx.path === '/passkey/verify-registration') {
          let challenge: unknown
          try {
            const encoded = ctx.body?.response?.response?.clientDataJSON
            if (typeof encoded !== 'string' || encoded.length > 8192) throw new Error('Invalid client data')
            const decoded = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))
            challenge = JSON.parse(decoded).challenge
          } catch { throw denied('REVIEW_CHALLENGE_INVALID', 'Start a new passkey verification.') }
          if (typeof challenge !== 'string') throw denied('REVIEW_CHALLENGE_INVALID', 'Start a new passkey verification.')
          const ceremony = ctx.path === '/passkey/verify-registration' ? 'registration' : 'authentication'
          const bound = await env.DB.prepare(`DELETE FROM review_webauthn_challenges
            WHERE challenge = ? AND session_id = ? AND origin = ? AND ceremony = ? AND generation = ? AND expires_at > ? RETURNING challenge`)
            .bind(challenge, session.session.id, requestOrigin, ceremony, active.generation, Date.now()).first()
          if (!bound) throw denied('REVIEW_CHALLENGE_INVALID', 'Start a new passkey verification in this session.')
        }
        if (ctx.path === '/two-factor/verify-totp' || ctx.path === '/passkey/verify-authentication') {
          await takeAttempt(session.user.id)
        }
        if (ctx.path === '/two-factor/verify-totp') {
          if (typeof ctx.body?.code !== 'string' || !/^\d{6}$/.test(ctx.body.code)) throw new APIError('BAD_REQUEST', { code: 'INVALID_CODE', message: 'Enter the six-digit authenticator code.' })
          const factor = await env.DB.prepare('SELECT id FROM twoFactor WHERE userId = ?').bind(session.user.id).first<{ id: string }>()
          if (!factor || !env.BETTER_AUTH_SECRET) throw denied('REVIEW_METHOD_UNAVAILABLE', 'Set up an authenticator first.')
          const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.BETTER_AUTH_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
          const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${session.user.id}:${factor.id}:${ctx.body.code}`))
          const digest = Array.from(new Uint8Array(signature), n => n.toString(16).padStart(2, '0')).join('')
          await env.DB.prepare('DELETE FROM review_used_codes WHERE expires_at <= ?').bind(Date.now()).run()
          const used = await env.DB.prepare('INSERT OR IGNORE INTO review_used_codes (digest, expires_at) VALUES (?, ?)').bind(digest, Date.now()+90000).run()
          if (!used.meta.changes) throw denied('REVIEW_CODE_USED', 'Wait for a new authenticator code.')
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (!active || isAPIError(ctx.context.returned)) return
        if (ctx.path === '/passkey/generate-authenticate-options' && ctx.context.returned && typeof ctx.context.returned === 'object') {
          Object.assign(ctx.context.returned, { userVerification: 'required' })
        }
        if (['/passkey/generate-authenticate-options', '/passkey/generate-register-options'].includes(ctx.path ?? '')
          && ctx.context.returned && typeof ctx.context.returned === 'object' && 'challenge' in ctx.context.returned) {
          const challenge = ctx.context.returned.challenge
          if (typeof challenge === 'string') {
            await env.DB.prepare('DELETE FROM review_webauthn_challenges WHERE expires_at <= ?').bind(Date.now()).run()
            await env.DB.prepare(`INSERT INTO review_webauthn_challenges (challenge, session_id, generation, origin, ceremony, expires_at) VALUES (?, ?, ?, ?, ?, ?)`)
              .bind(challenge, active.session.session.id, active.generation, active.origin, ctx.path === '/passkey/generate-register-options' ? 'registration' : 'authentication', Date.now()+300000).run()
          }
        }
        const session = ctx.context.newSession ?? active.session
        if (session.user.id !== active.session.user.id) throw denied('REVIEW_VERIFICATION_FAILED', 'This verification does not match your account.')
        if (ctx.path === '/passkey/verify-authentication' && verifiedKey) {
          if(!await grantReviewProof(env, session, active.origin, 'passkey', verifiedKey.id, active.session.session.id, active.generation)) throw denied('REVIEW_LOCKED','Reviews were locked. Start a new verification.')
        }
        if (ctx.path === '/two-factor/verify-totp' && ctx.context.returned && typeof ctx.context.returned === 'object' && 'token' in ctx.context.returned) {
          const factor = await env.DB.prepare('SELECT id FROM twoFactor WHERE userId = ? AND verified = 1').bind(session.user.id).first<{ id: string }>()
          if (!factor) throw denied('REVIEW_VERIFICATION_FAILED', 'Verify your authenticator setup first.')
          if(!await grantReviewProof(env, session, active.origin, 'totp', factor.id, active.session.session.id, active.generation)) throw denied('REVIEW_LOCKED','Reviews were locked. Start a new verification.')
        }
        if (['/passkey/verify-registration', '/passkey/delete-passkey', '/two-factor/enable', '/two-factor/disable'].includes(ctx.path ?? '')) {
          await env.DB.prepare('DELETE FROM review_session_proofs WHERE user_id = ?').bind(session.user.id).run()
          await writeMarketplaceAudit(env, { actorUserId: session.user.id, action: 'review_security_changed', targetType: 'reviewer', targetId: session.user.id })
        }
      }),
    },
  }
}
