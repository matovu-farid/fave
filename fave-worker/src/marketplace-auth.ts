import { createAuth, type AuthBindings } from './auth'

export type SignedInUser = {
  id: string
  name: string
  email: string
}

export async function getSignedInUser(
  env: AuthBindings,
  request: Request,
): Promise<SignedInUser | null> {
  const session = await createAuth(env).api.getSession({
    headers: request.headers,
  })

  return session ? session.user : null
}

export async function isMarketplaceAdmin(
  env: AuthBindings,
  userId: string,
): Promise<boolean> {
  const membership = await env.DB.prepare(
    'SELECT 1 AS allowed FROM admin_memberships WHERE user_id = ? AND active = 1 LIMIT 1',
  )
    .bind(userId)
    .first<{ allowed: number }>()

  return membership !== null
}

export async function writeMarketplaceAudit(
  env: AuthBindings,
  event: {
    actorUserId: string | null
    action: string
    targetType: string
    targetId: string
    reason?: string | null
    priorState?: string | null
    newState?: string | null
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO marketplace_audit_events
      (id, actor_user_id, actor_type, action, target_type, target_id, reason, prior_state, new_state, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      event.actorUserId,
      event.actorUserId === null ? 'system' : 'user',
      event.action,
      event.targetType,
      event.targetId,
      event.reason ?? null,
      event.priorState ?? null,
      event.newState ?? null,
      Date.now(),
    )
    .run()
}

export function apiError(
  code: string,
  message: string,
): { error: { code: string; message: string } } {
  return { error: { code, message } }
}
