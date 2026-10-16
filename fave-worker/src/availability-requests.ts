import type { AuthBindings } from './auth'
import { buildNotificationEventStatements } from './notification-store'
import { approvedVehicleEvidencePredicate } from './vehicles'
import { kampalaToday } from './trip-dates'

export function requestNeedsReviewPredicate(alias: string) {
  return `(${alias}.status IN ('requested', 'confirmed') AND (
    ${alias}.start_date < ?
    OR NOT EXISTS (
      SELECT 1 FROM vehicles AS eligible_vehicle
      JOIN trip_estimates AS saved_estimate ON saved_estimate.id = ${alias}.estimate_id
      WHERE eligible_vehicle.id = ${alias}.vehicle_id
        AND eligible_vehicle.driver_application_id = ${alias}.driver_application_id
        AND eligible_vehicle.status = 'approved'
        AND eligible_vehicle.passenger_capacity >= saved_estimate.party_size
        AND eligible_vehicle.luggage_capacity >= saved_estimate.luggage_count
        AND ${approvedVehicleEvidencePredicate('eligible_vehicle')}
    ) OR EXISTS (
      SELECT 1 FROM vehicle_unavailability AS blocked
      WHERE blocked.vehicle_id = ${alias}.vehicle_id
        AND blocked.start_date < ${alias}.end_date AND blocked.end_date > ${alias}.start_date
    )
  ))`
}

export function requestReviewBindings(now: number) {
  return [kampalaToday(new Date(now)), now, now, now, now, now, now]
}

// Keep this immediately after the conditional transition in the same batch.
// An unchanged request produces neither an audit record nor chained notices.
export function availabilityAuditStatement(env: AuthBindings, event: {
  requestId: string; actorUserId: string | null; action: string;
  priorState: string | null; newState: string | null; now: number
}) {
  return env.DB.prepare(
    `INSERT INTO marketplace_audit_events
      (id, actor_user_id, actor_type, action, target_type, target_id, prior_state, new_state, created_at)
     SELECT ?, ?, ?, ?, 'availability_request', ?, ?, ?, ? WHERE changes() = 1`,
  ).bind(crypto.randomUUID(), event.actorUserId, event.actorUserId ? 'user' : 'system',
    event.action, event.requestId, event.priorState, event.newState, event.now)
}

export async function expireAvailabilityRequests(env: AuthBindings, now: number, clientUserId?: string) {
  const expired = await env.DB.prepare(
    `SELECT id, client_user_id FROM availability_requests
      WHERE status = 'confirmed' AND hold_expires_at <= ?
        ${clientUserId ? 'AND client_user_id = ?' : ''}
      ORDER BY hold_expires_at ASC LIMIT 100`,
  ).bind(now, ...(clientUserId ? [clientUserId] : [])).all<{ id: string; client_user_id: string }>()
  for (const request of expired.results) {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE availability_requests SET status = 'expired', updated_at = ?
          WHERE id = ? AND status = 'confirmed' AND hold_expires_at <= ?`,
      ).bind(now, request.id, now),
      availabilityAuditStatement(env, {
        requestId: request.id, actorUserId: null, action: 'availability_quote_expired',
        priorState: 'confirmed', newState: 'expired', now,
      }),
      ...buildNotificationEventStatements(env.DB, {
        id: `booking.availability_expired:${request.id}`, eventType: 'booking.availability_expired', eventVersion: 1,
        domainType: 'availability_request', domainId: request.id, occurredAt: now,
        recipients: [{ userId: request.client_user_id, role: 'client' }],
      }, now, { requirePriorChange: true }),
    ])
  }
}
