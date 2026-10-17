import { createAuth, getWebAppOrigins, type AuthBindings } from './auth'

export const EXPORT_FRESH_MS = 600000
export type ExportIdentity = { userId: string; sessionId: string; createdAt: number }
export const liveSessionSql = 'SELECT 1 FROM session WHERE id=? AND userId=? AND expiresAt>?'
export const freshSessionSql = `${liveSessionSql} AND createdAt>=? AND createdAt<=?`
export function sessionArgs(identity: ExportIdentity, fresh = false, now = Date.now()): (string | number)[] {
  return [identity.sessionId, identity.userId, now, ...(fresh ? [now - EXPORT_FRESH_MS, now] : [])]
}
export async function exportIdentity(env: AuthBindings, request: Request): Promise<ExportIdentity | null> {
  const result = await createAuth(env, request.headers).api.getSession({ headers: request.headers, query: { disableCookieCache: true } })
  if (!result) return null
  const row = await env.DB.prepare(`SELECT createdAt FROM session WHERE id=? AND userId=? AND expiresAt>?`)
    .bind(result.session.id, result.user.id, Date.now()).first<{createdAt:number}>()
  return row ? { userId: result.user.id, sessionId: result.session.id, createdAt: row.createdAt } : null
}
export function isFresh(identity: ExportIdentity) {
  const age = Date.now() - identity.createdAt
  return age >= 0 && age <= EXPORT_FRESH_MS
}
export function exportOriginAllowed(env: AuthBindings, request: Request) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false
  const source = request.headers.get('origin')
  if (!source) return true // Native authenticated clients do not send Origin.
  const allowed = getWebAppOrigins(env).map(value => new URL(value).origin)
  if (env.BETTER_AUTH_URL) allowed.push(new URL(env.BETTER_AUTH_URL).origin)
  return allowed.includes(source)
}
export async function requireLiveExportSession(env: AuthBindings, identity: ExportIdentity) {
  if (!await env.DB.prepare(liveSessionSql).bind(...sessionArgs(identity)).first()) throw new Error('Export session ended')
}
