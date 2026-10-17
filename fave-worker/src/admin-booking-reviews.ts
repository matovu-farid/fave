import { Hono } from 'hono'
import { reviewAccess, reviewGuardSelect, reviewGuardBindings, reviewSnapshotValid, type ReviewEnvironment } from './review-access'
import { apiError } from './marketplace-auth'
import { bounded, operationsCursor, readOperationsCursor } from './operations-pages'

const app = new Hono<ReviewEnvironment>()
app.use('*', reviewAccess)
app.get('/pending', async c => {
  const status = c.req.query('status') ?? 'open'
  if (!['open', 'reviewed'].includes(status)) return c.json(apiError('INVALID_FILTER', 'Choose open or reviewed flags.'), 400)
  const cursor = readOperationsCursor(c.req.query('cursor'), status)
  if (cursor === false) return c.json(apiError('INVALID_CURSOR', 'Refresh the booking review list.'), 400)
  const rows = await c.env.DB.prepare(`SELECT flag.id,flag.booking_id AS bookingId,flag.status,flag.created_at AS createdAt,
    event.application_id AS driverId,booking.status AS bookingStatus,booking.start_date AS startDate,booking.end_date AS endDate,flag.association
    FROM booking_review_flags AS flag JOIN driver_operation_events AS event ON event.id=flag.event_id
    JOIN bookings AS booking ON booking.id=flag.booking_id WHERE flag.status=?
      AND (flag.created_at>? OR (flag.created_at=? AND flag.id>?)) ORDER BY flag.created_at,flag.id LIMIT 26`)
    .bind(status, cursor?.at ?? -1, cursor?.at ?? -1, cursor?.id ?? '').all<{ id: string; createdAt: number }>()
  const page = bounded(rows.results), last = page.items.at(-1)
  return c.json({ items: page.items, nextCursor: page.hasMore && last ? operationsCursor(last.id, last.createdAt, status) : null })
})
app.get('/:id', async c => {
  const flag = await c.env.DB.prepare(`SELECT flag.id,flag.booking_id AS bookingId,flag.status,flag.association,flag.created_at AS createdAt,
    flag.reviewed_at AS reviewedAt,flag.reviewed_by AS reviewedBy,flag.outcome_note AS outcomeNote,
    booking.status AS bookingStatus,booking.start_date AS startDate,booking.end_date AS endDate,
    event.application_id AS driverId,event.id AS eventId,event.reason,event.applicant_message AS applicantMessage,
    event.actor_user_id AS suspendedBy,event.created_at AS suspendedAt
    FROM booking_review_flags AS flag JOIN driver_operation_events AS event ON event.id=flag.event_id
    JOIN bookings AS booking ON booking.id=flag.booking_id WHERE flag.id=?`).bind(c.req.param('id')).first<{ driverId: string }>()
  if (!flag) return c.json(apiError('NOT_FOUND', 'Booking review was not found.'), 404)
  const history = await c.env.DB.prepare(`SELECT id,decision,reason,prior_state AS priorState,new_state AS newState,actor_user_id AS actorUserId,created_at AS createdAt
    FROM driver_operation_events WHERE application_id=? ORDER BY created_at DESC,id DESC LIMIT 26`).bind(flag.driverId).all()
  return c.json({ flag, history: bounded(history.results) })
})
app.post('/:id/reviewed', async c => {
  const body = await c.req.json().catch(() => null)
  if (!body || body.confirmed !== true || typeof body.note !== 'string' || body.note.trim().length < 4 || body.note.trim().length > 1000) {
    return c.json(apiError('INVALID_OUTCOME', 'Confirm this review and enter an internal outcome note of 4–1000 characters.'), 400)
  }
  const now = Date.now(), authorization = c.get('reviewAuthorization'), id = c.req.param('id')
  const result = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE booking_review_flags SET status='reviewed',reviewed_by=?,reviewed_at=?,outcome_note=?
      WHERE id=? AND status='open' AND EXISTS(${reviewGuardSelect})`).bind(authorization.session.user.id, now, body.note.trim(), id, ...reviewGuardBindings(authorization, now)),
    c.env.DB.prepare(`INSERT INTO marketplace_audit_events(id,actor_user_id,action,target_type,target_id,reason,prior_state,new_state,created_at)
      SELECT ?,?,'booking_flag_reviewed','booking_review_flag',?,?,'open','reviewed',? WHERE changes()=1`)
      .bind(crypto.randomUUID(), authorization.session.user.id, id, body.note.trim(), now),
  ])
  if (result[0].meta.changes !== 1) {
    if (!await reviewSnapshotValid(c.env, authorization)) return c.json(apiError('REVIEW_UNLOCK_REQUIRED', 'Reviews locked. Unlock again and refresh.'), 428)
    return c.json(apiError('BOOKING_REVIEW_CONFLICT', 'This flag changed. Refresh before reviewing again.'), 409)
  }
  return c.json({ id, status: 'reviewed', reviewedAt: now })
})
export default app
