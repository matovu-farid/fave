import type { AuthBindings } from './auth'
import { driverApprovalRequirementsPredicate } from './driver-eligibility'
import { suspensionBookingFlags } from './booking-reviews'
import { apiError } from './marketplace-auth'
import { reviewGuardSelect, reviewGuardBindings, reviewSnapshotValid, type ReviewAuthorization } from './review-access'

export type DriverOperation = { decision: 'suspend' | 'restore' | 'request_corrections'; reason: string; applicantMessage: string; expectedVersion: number; confirmed: true }
export function parseDriverOperation(body: unknown): DriverOperation | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const b = body as Record<string, unknown>
  if (typeof b.decision !== 'string' || !['suspend', 'restore', 'request_corrections'].includes(b.decision) || b.confirmed !== true ||
      !Number.isSafeInteger(b.expectedVersion) || Number(b.expectedVersion) < 0 ||
      typeof b.reason !== 'string' || b.reason.trim().length < 4 || b.reason.trim().length > 300 ||
      typeof b.applicantMessage !== 'string' || b.applicantMessage.trim().length < 4 || b.applicantMessage.trim().length > 300) return null
  return { ...b, reason: b.reason.trim(), applicantMessage: b.applicantMessage.trim() } as DriverOperation
}

export async function driverRestorable(env: AuthBindings, id: string, now: number) {
  return !!await env.DB.prepare(`SELECT 1 FROM driver_applications WHERE id=? AND ${driverApprovalRequirementsPredicate('driver_applications')}`)
    .bind(id, now, now, now, now, now).first()
}

export async function performDriverOperation(env: AuthBindings, authorization: ReviewAuthorization, id: string, input: DriverOperation) {
  const prior = input.decision === 'suspend' ? 'approved' : 'suspended'
  const next = input.decision === 'suspend' ? 'suspended' : input.decision === 'restore' ? 'approved' : 'needs_correction'
  const now = Date.now(), eventId = crypto.randomUUID()
  const restoreGuard = input.decision === 'restore' ? `AND ${driverApprovalRequirementsPredicate('driver_applications', "MAX(?, CAST(unixepoch('subsec')*1000 AS INTEGER))")}` : ''
  const result = await env.DB.batch([
    env.DB.prepare(`UPDATE driver_applications SET status=?,reviewer_reason=?,applicant_message=?,reviewed_by=?,reviewed_at=?,updated_at=?
      WHERE id=? AND status=? AND operations_version=? ${restoreGuard} AND EXISTS (${reviewGuardSelect})`)
      .bind(next, input.reason, input.applicantMessage, authorization.session.user.id, now, now, id, prior, input.expectedVersion,
        ...(input.decision === 'restore' ? [now, now, now, now, now] : []), ...reviewGuardBindings(authorization, now)),
    env.DB.prepare(`INSERT INTO driver_operation_events(id,application_id,version,decision,prior_state,new_state,reason,applicant_message,actor_user_id,created_at)
      SELECT ?,?,?,?,?,?,?,?,?,? WHERE changes()=1`)
      .bind(eventId, id, input.expectedVersion + 1, input.decision, prior, next, input.reason, input.applicantMessage, authorization.session.user.id, now),
    env.DB.prepare(`INSERT INTO marketplace_audit_events(id,actor_user_id,action,target_type,target_id,reason,prior_state,new_state,created_at)
      SELECT ?,?,'driver_operation','driver_application',?,?,?,?,? WHERE EXISTS(SELECT 1 FROM driver_operation_events WHERE id=?)`)
      .bind(crypto.randomUUID(), authorization.session.user.id, id, input.reason, prior, next, now, eventId),
    ...suspensionBookingFlags(env, eventId, id, now),
  ])
  if (result[0].meta.changes !== 1) {
    if (!await reviewSnapshotValid(env, authorization)) return { status: 428 as const, body: apiError('REVIEW_UNLOCK_REQUIRED', 'Reviews locked. Unlock again and refresh.') }
    return { status: 409 as const, body: apiError('DRIVER_OPERATION_CONFLICT', 'Driver status, version or approval requirements changed. Refresh before deciding again.') }
  }
  return { status: 200 as const, body: { applicationId: id, status: next, version: input.expectedVersion + 1, eventId } }
}
