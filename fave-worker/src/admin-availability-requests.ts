import { Hono, type Context } from 'hono'
import type { AuthBindings } from './auth'
import { apiError, getSignedInUser, isMarketplaceAdmin, writeMarketplaceAudit } from './marketplace-auth'
import { availabilityAuditStatement, expireAvailabilityRequests, requestNeedsReviewPredicate, requestReviewBindings } from './availability-requests'
import { approvedVehicleEvidencePredicate } from './vehicles'
import { parseTripDateRange } from './trip-dates'
import { buildNotificationEventStatements } from './notification-store'

type RequestRow = {
  id: string; estimate_id: string; status: string; created_at: number; start_date: string; end_date: string
  vehicle_id: string; make: string; model: string; model_year: number; origin_json: string; destination_json: string
  snapshot_json: string; call_count: number; quote_id: string | null; hold_expires_at: number | null
  needs_review: number; reached_count: number
}

const adminAvailabilityApp = new Hono<{ Bindings: AuthBindings }>()
const outcomes = new Set(['reached', 'no_answer', 'busy', 'voicemail', 'other'])

async function requireAdmin(c: Context<{ Bindings: AuthBindings }>) {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return { error: c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401) }
  if (!(await isMarketplaceAdmin(c.env, user.id))) {
    return { error: c.json(apiError('FORBIDDEN', 'You are not authorized to access trip operations.'), 403) }
  }
  return { user }
}

function area(json: string, fallback: string) {
  try {
    const value: unknown = JSON.parse(json)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fallback
    const broad = (value as Record<string, unknown>).broadArea
    return typeof broad === 'string' && broad.length <= 80 && /^[\p{L}\p{M}\s.'’()-]+$/u.test(broad) ? broad : fallback
  } catch { return fallback }
}

function present(row: RequestRow) {
  const quote = JSON.parse(row.snapshot_json) as { currency: string; totalAmount: number }
  return {
    requestId: row.id, estimateId: row.estimate_id, status: row.status, createdAt: row.created_at,
    startDate: row.start_date, endDate: row.end_date,
    vehicle: { id: row.vehicle_id, make: row.make, model: row.model, year: row.model_year },
    route: { pickupArea: area(row.origin_json, 'Service area'), destinationArea: area(row.destination_json, 'Uganda') },
    estimate: { currency: quote.currency, totalAmount: quote.totalAmount },
    callCount: row.call_count, quoteId: row.quote_id, holdExpiresAt: row.hold_expires_at,
    needsReview: Boolean(row.needs_review),
    driverReached: row.reached_count > 0,
  }
}

adminAvailabilityApp.get('/access', async (c) => {
  const access = await requireAdmin(c)
  if ('error' in access) return access.error
  return c.json({ authorized: true })
})

adminAvailabilityApp.get('/', async (c) => {
  const access = await requireAdmin(c)
  if ('error' in access) return access.error
  const now = Date.now()
  await expireAvailabilityRequests(c.env, now)
  const result = await c.env.DB.prepare(
    `SELECT request.id, request.estimate_id, request.status, request.created_at,
            request.start_date, request.end_date, request.vehicle_id, request.quote_id,
            request.hold_expires_at, estimate.origin_json, estimate.destination_json, estimate.snapshot_json,
            vehicle.make, vehicle.model, vehicle.model_year,
            COUNT(call.id) AS call_count,
            SUM(CASE WHEN call.outcome = 'reached' THEN 1 ELSE 0 END) AS reached_count,
            ${requestNeedsReviewPredicate('request')} AS needs_review
       FROM availability_requests AS request
       JOIN trip_estimates AS estimate ON estimate.id = request.estimate_id
       JOIN vehicles AS vehicle ON vehicle.id = request.vehicle_id
       LEFT JOIN availability_request_calls AS call ON call.request_id = request.id
      WHERE request.status IN ('requested', 'confirmed') OR request.updated_at >= ?
      GROUP BY request.id
      ORDER BY CASE WHEN request.status = 'requested' THEN 0 ELSE 1 END,
               CASE WHEN request.status = 'requested' THEN request.created_at END ASC,
               request.updated_at DESC LIMIT 150`,
  ).bind(...requestReviewBindings(now), now - 7 * 24 * 60 * 60 * 1000).all<RequestRow>()
  const calls = result.results.length ? await c.env.DB.prepare(
    `SELECT call.id, call.request_id, call.outcome, call.note, call.created_at, actor.name AS actor_name
       FROM availability_request_calls AS call JOIN user AS actor ON actor.id = call.actor_user_id
      WHERE call.request_id IN (${result.results.map(() => '?').join(', ')})
      ORDER BY call.created_at DESC, call.id DESC`,
  ).bind(...result.results.map((request) => request.id)).all<{
    id: string; request_id: string; outcome: string; note: string | null; created_at: number; actor_name: string
  }>() : { results: [] }
  const requests = result.results.map((row) => ({ ...present(row), calls: calls.results
    .filter((call) => call.request_id === row.id).slice(0, 10)
    .map((call) => ({ callId: call.id, outcome: call.outcome, note: call.note, createdAt: call.created_at, actorName: call.actor_name })) }))
  return c.json({
    pendingRequests: requests.filter((request) => request.status === 'requested'),
    confirmedRequests: requests.filter((request) => request.status === 'confirmed'),
    recentRequests: requests.filter((request) => !['requested', 'confirmed'].includes(request.status)), refreshedAt: now,
  })
})

adminAvailabilityApp.post('/:requestId/driver-contact', async (c) => {
  const access = await requireAdmin(c)
  if ('error' in access) return access.error
  const row = await c.env.DB.prepare(
    `SELECT request.id, driver.legal_name, driver.phone_e164
       FROM availability_requests AS request
       JOIN driver_applications AS driver ON driver.id = request.driver_application_id
      WHERE request.id = ? AND request.status IN ('requested', 'confirmed') LIMIT 1`,
  ).bind(c.req.param('requestId')).first<{ id: string; legal_name: string; phone_e164: string }>()
  if (!row) return c.json(apiError('REQUEST_NOT_PENDING', 'This availability request is no longer pending.'), 409)
  await writeMarketplaceAudit(c.env, { actorUserId: access.user.id, action: 'availability_driver_contact_accessed', targetType: 'availability_request', targetId: row.id })
  return c.json({ driver: { name: row.legal_name, phone: row.phone_e164 } })
})

adminAvailabilityApp.post('/:requestId/calls', async (c) => {
  const access = await requireAdmin(c)
  if ('error' in access) return access.error
  const body: unknown = await c.req.json().catch(() => null)
  const input = typeof body === 'object' && body !== null && !Array.isArray(body) ? body as Record<string, unknown> : {}
  const note = input.note === undefined || input.note === null ? null : input.note
  if (!outcomes.has(String(input.outcome)) || (note !== null && (typeof note !== 'string' || note.trim().length > 500))) {
    return c.json(apiError('INVALID_CALL', 'Choose a call outcome and enter an optional note of no more than 500 characters.'), 400)
  }
  const id = crypto.randomUUID(); const now = Date.now(); const requestId = c.req.param('requestId')
  const inserted = await c.env.DB.batch([c.env.DB.prepare(
    `INSERT INTO availability_request_calls (id, request_id, actor_user_id, outcome, note, created_at)
     SELECT ?, id, ?, ?, ?, ? FROM availability_requests WHERE id = ? AND status IN ('requested', 'confirmed')`,
  ).bind(id, access.user.id, input.outcome, typeof note === 'string' ? note.trim() || null : null, now, requestId),
  availabilityAuditStatement(c.env, { requestId, actorUserId: access.user.id, action: 'availability_call_recorded', priorState: null, newState: null, now }),
  ])
  if (inserted[0]?.meta.changes !== 1) return c.json(apiError('REQUEST_NOT_PENDING', 'Calls can only be recorded while the request is pending or its quote is held.'), 409)
  return c.json({ callId: id, requestId, outcome: input.outcome, createdAt: now }, 201)
})

adminAvailabilityApp.post('/:requestId/confirm', async (c) => {
  const access = await requireAdmin(c)
  if ('error' in access) return access.error
  const requestId = c.req.param('requestId'); const now = Date.now()
  const row = await c.env.DB.prepare(
    `SELECT request.id, request.estimate_id, request.client_user_id, request.vehicle_id,
            request.driver_application_id, request.start_date, request.end_date,
            estimate.policy_id, estimate.origin_json, estimate.destination_json,
            estimate.party_size, estimate.luggage_count, estimate.snapshot_json,
            (SELECT quote_ttl_seconds FROM fare_policies
              WHERE active = 1 AND approved_at IS NOT NULL AND effective_at IS NOT NULL AND effective_at <= ?
              ORDER BY effective_at DESC LIMIT 1) AS quote_ttl_seconds,
            (SELECT COUNT(*) FROM availability_request_calls WHERE request_id = request.id) AS call_count,
            (SELECT COUNT(*) FROM availability_request_calls WHERE request_id = request.id AND outcome = 'reached') AS reached_count
       FROM availability_requests AS request
       JOIN trip_estimates AS estimate ON estimate.id = request.estimate_id
      WHERE request.id = ? AND request.status = 'requested' LIMIT 1`,
  ).bind(now, requestId).first<Record<string, unknown>>()
  if (!row) return c.json(apiError('REQUEST_NOT_PENDING', 'This availability request is no longer pending.'), 409)
  if (row.quote_ttl_seconds === null) return c.json(apiError('FARE_POLICY_UNAVAILABLE', 'An approved active fare policy is required before sending the final quote.'), 409)
  if (Number(row.call_count) < 1) return c.json(apiError('CALL_REQUIRED', 'Record a call attempt after contacting the assigned driver before confirming these dates.'), 409)
  if (Number(row.reached_count) < 1) return c.json(apiError('DRIVER_NOT_REACHED', 'Reach the driver and record the call before confirming these dates. Unanswered calls stay awaiting follow-up.'), 409)
  if (!parseTripDateRange(row.start_date, row.end_date, new Date(now))) {
    return c.json(apiError('DATES_UNAVAILABLE', 'These trip dates have passed. Ask the client to choose new dates.'), 409)
  }
  const expiry = now + Number(row.quote_ttl_seconds) * 1000
  const quoteId = crypto.randomUUID()
  const insertQuote = c.env.DB.prepare(
    `INSERT INTO trip_quotes
      (id, client_user_id, vehicle_id, policy_id, origin_json, destination_json, start_date, end_date,
       party_size, luggage_count, route_distance_meters, route_duration_seconds, quote_json, expires_at, created_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM vehicles AS vehicle JOIN driver_applications AS driver
        ON driver.id = vehicle.driver_application_id WHERE vehicle.id = ? AND vehicle.driver_application_id = ?
        AND vehicle.status = 'approved' AND driver.status = 'approved'
        AND vehicle.passenger_capacity >= ? AND vehicle.luggage_capacity >= ?
        AND ${approvedVehicleEvidencePredicate('vehicle')})
        AND EXISTS (SELECT 1 FROM availability_requests
          WHERE id = ? AND status = 'requested' AND client_user_id = ?
            AND EXISTS (SELECT 1 FROM availability_request_calls
              WHERE request_id = availability_requests.id AND outcome = 'reached'))
        AND EXISTS (SELECT 1 FROM fare_policies
          WHERE active = 1 AND approved_at IS NOT NULL AND effective_at IS NOT NULL AND effective_at <= ?)
        AND NOT EXISTS (SELECT 1 FROM vehicle_unavailability WHERE vehicle_id = ? AND start_date < ? AND end_date > ?)
        AND NOT EXISTS (SELECT 1 FROM bookings
          JOIN vehicles AS booked_vehicle ON booked_vehicle.id = bookings.vehicle_id
          WHERE (bookings.vehicle_id = ? OR booked_vehicle.driver_application_id = ?)
            AND bookings.start_date < ? AND bookings.end_date > ?
            AND (bookings.status = 'confirmed' OR (bookings.status = 'deposit_pending' AND bookings.hold_expires_at > ?)))
        AND NOT EXISTS (SELECT 1 FROM availability_requests WHERE id != ?
          AND (vehicle_id = ? OR driver_application_id = ?) AND start_date < ? AND end_date > ?
          AND status = 'confirmed' AND hold_expires_at > ?)
        AND NOT EXISTS (SELECT 1 FROM driver_trip_offers WHERE (vehicle_id = ? OR driver_application_id = ?)
          AND start_date < ? AND end_date > ? AND status IN ('pending', 'quoting') AND expires_at > ?)`,
  ).bind(
    quoteId, row.client_user_id, row.vehicle_id, row.policy_id, row.origin_json, row.destination_json,
    row.start_date, row.end_date, row.party_size, row.luggage_count,
    (JSON.parse(String(row.snapshot_json)) as { outboundRoute: { distanceMeters: number } }).outboundRoute.distanceMeters,
    (JSON.parse(String(row.snapshot_json)) as { outboundRoute: { durationSeconds: number } }).outboundRoute.durationSeconds,
    row.snapshot_json, expiry, now, row.vehicle_id, row.driver_application_id,
    row.party_size, row.luggage_count, now, now, now, now, now, now,
    requestId, row.client_user_id,
    now,
    row.vehicle_id, row.end_date, row.start_date,
    row.vehicle_id, row.driver_application_id, row.end_date, row.start_date, now,
    requestId, row.vehicle_id, row.driver_application_id, row.end_date, row.start_date, now,
    row.vehicle_id, row.driver_application_id, row.end_date, row.start_date, now,
  )
  const markConfirmed = c.env.DB.prepare(
    `UPDATE availability_requests SET status = 'confirmed', decision_actor_user_id = ?, decision_at = ?,
            quote_id = ?, hold_expires_at = ?, updated_at = ?
      WHERE id = ? AND status = 'requested'
        AND EXISTS (SELECT 1 FROM trip_quotes WHERE id = ? AND client_user_id = ? AND expires_at > ?)
        AND NOT EXISTS (SELECT 1 FROM vehicle_unavailability WHERE vehicle_id = availability_requests.vehicle_id
          AND start_date < availability_requests.end_date AND end_date > availability_requests.start_date)
        AND NOT EXISTS (SELECT 1 FROM bookings
          JOIN vehicles AS booked_vehicle ON booked_vehicle.id = bookings.vehicle_id
          WHERE (bookings.vehicle_id = availability_requests.vehicle_id
            OR booked_vehicle.driver_application_id = availability_requests.driver_application_id)
            AND bookings.start_date < availability_requests.end_date AND bookings.end_date > availability_requests.start_date
            AND (bookings.status = 'confirmed' OR (bookings.status = 'deposit_pending' AND bookings.hold_expires_at > ?)))
        AND NOT EXISTS (SELECT 1 FROM availability_requests AS active WHERE active.id != availability_requests.id
          AND (active.vehicle_id = availability_requests.vehicle_id OR active.driver_application_id = availability_requests.driver_application_id)
          AND active.start_date < availability_requests.end_date AND active.end_date > availability_requests.start_date
          AND active.status = 'confirmed' AND active.hold_expires_at > ?)
        AND NOT EXISTS (SELECT 1 FROM driver_trip_offers WHERE (vehicle_id = availability_requests.vehicle_id
          OR driver_application_id = availability_requests.driver_application_id)
          AND start_date < availability_requests.end_date AND end_date > availability_requests.start_date
          AND status IN ('pending', 'quoting') AND expires_at > ?)`,
  ).bind(access.user.id, now, quoteId, expiry, now, requestId, quoteId, row.client_user_id, now, now, now, now)
  let results
  try { results = await c.env.DB.batch([
    insertQuote, markConfirmed,
    availabilityAuditStatement(c.env, { requestId, actorUserId: access.user.id, action: 'availability_confirmed', priorState: 'requested', newState: 'confirmed', now }),
    ...buildNotificationEventStatements(c.env.DB, {
      id: `booking.availability_confirmed:${requestId}`, eventType: 'booking.availability_confirmed', eventVersion: 1,
      domainType: 'availability_request', domainId: requestId, occurredAt: now, expiresAt: expiry,
      recipients: [{ userId: String(row.client_user_id), role: 'client' }],
    }, now, { requirePriorChange: true }),
  ]) }
  catch { return c.json(apiError('DATES_UNAVAILABLE', 'These dates were just booked or held. No quote was sent.'), 409) }
  if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) {
    return c.json(apiError('DATES_UNAVAILABLE', 'These dates are no longer available. No quote was sent.'), 409)
  }
  return c.json({ requestId, quoteId, status: 'confirmed', holdExpiresAt: expiry }, 200)
})

adminAvailabilityApp.post('/:requestId/unavailable', async (c) => {
  const access = await requireAdmin(c)
  if ('error' in access) return access.error
  const now = Date.now(); const requestId = c.req.param('requestId')
  const request = await c.env.DB.prepare(
    `SELECT client_user_id, status FROM availability_requests AS request WHERE id = ?
      AND (status = 'requested' OR (status = 'confirmed' AND ${requestNeedsReviewPredicate('request')})) LIMIT 1`,
  ).bind(requestId, ...requestReviewBindings(now)).first<{ client_user_id: string; status: string }>()
  if (!request) return c.json(apiError('REQUEST_NOT_PENDING', 'This availability request is no longer pending.'), 409)
  const results = await c.env.DB.batch([c.env.DB.prepare(
    `UPDATE availability_requests SET status = 'unavailable', decision_actor_user_id = ?, decision_at = ?, updated_at = ?
      WHERE id = ? AND (status = 'requested' OR (status = 'confirmed' AND ${requestNeedsReviewPredicate('availability_requests')}))
        AND EXISTS (SELECT 1 FROM availability_request_calls WHERE request_id = availability_requests.id AND outcome = 'reached')`,
  ).bind(access.user.id, now, now, requestId, ...requestReviewBindings(now)),
  availabilityAuditStatement(c.env, { requestId, actorUserId: access.user.id, action: 'availability_marked_unavailable', priorState: request.status, newState: 'unavailable', now }),
  ...buildNotificationEventStatements(c.env.DB, {
    id: `booking.availability_unavailable:${requestId}`, eventType: 'booking.availability_unavailable', eventVersion: 1,
    domainType: 'availability_request', domainId: requestId, occurredAt: now,
    recipients: [{ userId: request.client_user_id, role: 'client' }],
  }, now, { requirePriorChange: true })])
  if (results[0]?.meta.changes !== 1) return c.json(apiError('REQUEST_NOT_PENDING', 'Speak with the driver and record a reached call while this request is pending before marking it unavailable.'), 409)
  return c.json({ requestId, status: 'unavailable' })
})

export default adminAvailabilityApp
