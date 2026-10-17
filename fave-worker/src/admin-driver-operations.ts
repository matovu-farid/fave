import { Hono } from 'hono'
import { reviewAccess, type ReviewEnvironment } from './review-access'
import { apiError } from './marketplace-auth'
import { driverRestorable, parseDriverOperation, performDriverOperation } from './driver-operations'
import { bookedDriverPredicate } from './booking-reviews'
import { bounded, operationsCursor, readOperationsCursor } from './operations-pages'

const app = new Hono<ReviewEnvironment>()
app.use('*', reviewAccess)
app.get('/pending', async c => {
  const status = c.req.query('status') ?? 'approved'
  if (!['approved', 'suspended'].includes(status)) return c.json(apiError('INVALID_FILTER', 'Choose approved or suspended drivers.'), 400)
  const cursor = readOperationsCursor(c.req.query('cursor'), status)
  if (cursor === false) return c.json(apiError('INVALID_CURSOR', 'Refresh the driver list.'), 400)
  const rows = await c.env.DB.prepare(`SELECT id,legal_name AS label,status,reviewed_at AS decidedAt FROM driver_applications
    WHERE status=? AND id>? ORDER BY id LIMIT 26`).bind(status, cursor?.id ?? '').all<{ id: string; label: string; status: string; decidedAt: number | null }>()
  const page = bounded(rows.results), last = page.items.at(-1)
  return c.json({ items: page.items, nextCursor: page.hasMore && last ? operationsCursor(last.id, 0, status) : null })
})
app.get('/:id', async c => {
  const id = c.req.param('id'), now = Date.now()
  const driver = await c.env.DB.prepare(`SELECT id,legal_name AS label,status,operations_version AS version,applicant_message AS applicantMessage,
    reviewer_reason AS reason,reviewed_at AS decidedAt FROM driver_applications WHERE id=?`).bind(id)
    .first<{ id: string; label: string; status: string; version: number; applicantMessage: string | null; reason: string | null; decidedAt: number | null }>()
  if (!driver) return c.json(apiError('NOT_FOUND', 'Driver was not found.'), 404)
  const [canRestore, vehicles, bookings, history] = await Promise.all([
    driverRestorable(c.env, id, now),
    c.env.DB.prepare(`SELECT id,make,model,model_year AS year,status FROM vehicles WHERE driver_application_id=? ORDER BY id LIMIT 26`).bind(id).all(),
    c.env.DB.prepare(`SELECT booking.id,booking.start_date AS startDate,booking.end_date AS endDate,booking.status FROM bookings AS booking
      WHERE ${bookedDriverPredicate('?')} AND (booking.status='confirmed' OR (booking.status='deposit_pending' AND booking.hold_expires_at>?))
      ORDER BY booking.start_date,booking.id LIMIT 26`).bind(id, id, now).all(),
    c.env.DB.prepare(`SELECT id,action,actor_user_id AS actorUserId,reason,prior_state AS priorState,new_state AS newState,created_at AS createdAt
      FROM marketplace_audit_events WHERE target_type='driver_application' AND target_id=? AND action IN ('driver_operation','driver_application_decision')
      ORDER BY created_at DESC,id DESC LIMIT 26`).bind(id).all(),
  ])
  return c.json({ driver, canRestore, blockers: canRestore ? [] : ['Current identity evidence, checklist, retention, citizenship, terms/privacy acceptance or account eligibility needs attention. Open the application review to check the current requirements.'],
    vehicles: bounded(vehicles.results), bookings: bounded(bookings.results), history: bounded(history.results) })
})
app.post('/:id/decision', async c => {
  const input = parseDriverOperation(await c.req.json().catch(() => null))
  if (!input) return c.json(apiError('INVALID_DECISION', 'Confirm the driver, version, internal reason and driver-facing next step.'), 400)
  const result = await performDriverOperation(c.env, c.get('reviewAuthorization'), c.req.param('id'), input)
  return c.json(result.body, result.status)
})
export default app
