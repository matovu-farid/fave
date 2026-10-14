import { Hono, type Context } from 'hono'
import type { AuthBindings } from './auth'
import {
  apiError,
  getSignedInUser,
  isMarketplaceAdmin,
  writeMarketplaceAudit,
} from './marketplace-auth'

type OfferRow = {
  id: string
  status: string
  expires_at: number
  created_at: number
  responded_at: number | null
  start_date: string
  end_date: string
  make: string
  model: string
  origin_json: string
  destination_json: string
  follow_up_count: number
}

const adminTripOffersApp = new Hono<{ Bindings: AuthBindings }>()
const recentStatusList = "'quoted', 'declined', 'expired', 'withdrawn', 'quote_failed'"
const callOutcomes = new Set(['reached', 'no_answer', 'busy', 'voicemail', 'other'])

function routeArea(json: string): string {
  try {
    const value: unknown = JSON.parse(json)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'Area unavailable'
    const location = value as Record<string, unknown>
    const label = typeof location.formattedAddress === 'string'
      ? location.formattedAddress
      : typeof location.address === 'string' ? location.address : ''
    const broadArea = label.split(',').map((part) => part.trim()).filter(Boolean).slice(-2).join(', ')
    return broadArea || 'Area unavailable'
  } catch {
    return 'Area unavailable'
  }
}

function presentOffer(offer: OfferRow) {
  return {
    offerId: offer.id,
    status: offer.status,
    expiresAt: offer.expires_at,
    createdAt: offer.created_at,
    respondedAt: offer.responded_at,
    startDate: offer.start_date,
    endDate: offer.end_date,
    vehicle: { make: offer.make, model: offer.model },
    route: {
      pickupArea: routeArea(offer.origin_json),
      destinationArea: routeArea(offer.destination_json),
    },
    followUpCount: offer.follow_up_count,
  }
}

async function requireAdmin(c: Context<{ Bindings: AuthBindings }>) {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return { error: c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401) }
  if (!(await isMarketplaceAdmin(c.env, user.id))) {
    return { error: c.json(apiError('FORBIDDEN', 'You are not authorized to access trip operations.'), 403) }
  }
  return { user }
}

adminTripOffersApp.get('/access', async (c) => {
  const access = await requireAdmin(c)
  if ('error' in access) return access.error
  return c.json({ authorized: true })
})

adminTripOffersApp.get('/', async (c) => {
  const access = await requireAdmin(c)
  if ('error' in access) return access.error

  const now = Date.now()
  await c.env.DB.prepare(
    `UPDATE driver_trip_offers
        SET status = CASE WHEN status = 'quoting' THEN 'quote_failed' ELSE 'expired' END,
            responded_at = COALESCE(responded_at, ?)
      WHERE status IN ('pending', 'quoting') AND expires_at <= ?`,
  ).bind(now, now).run()

  const [pending, recent] = await Promise.all([
    c.env.DB.prepare(
      `SELECT offer.id, offer.status, offer.expires_at, offer.created_at, offer.responded_at,
              offer.start_date, offer.end_date, offer.origin_json, offer.destination_json,
              vehicle.make, vehicle.model, COUNT(follow_up.id) AS follow_up_count
         FROM driver_trip_offers AS offer
         JOIN vehicles AS vehicle ON vehicle.id = offer.vehicle_id
         LEFT JOIN driver_trip_offer_followups AS follow_up ON follow_up.offer_id = offer.id
        WHERE offer.status = 'pending' AND offer.expires_at > ?
        GROUP BY offer.id
        ORDER BY offer.expires_at ASC LIMIT 100`,
    ).bind(now).all<OfferRow>(),
    c.env.DB.prepare(
      `SELECT offer.id, offer.status, offer.expires_at, offer.created_at, offer.responded_at,
              offer.start_date, offer.end_date, offer.origin_json, offer.destination_json,
              vehicle.make, vehicle.model, COUNT(follow_up.id) AS follow_up_count
         FROM driver_trip_offers AS offer
         JOIN vehicles AS vehicle ON vehicle.id = offer.vehicle_id
         LEFT JOIN driver_trip_offer_followups AS follow_up ON follow_up.offer_id = offer.id
        WHERE offer.status IN (${recentStatusList}) AND offer.created_at >= ?
        GROUP BY offer.id
        ORDER BY offer.responded_at DESC, offer.created_at DESC LIMIT 50`,
    ).bind(now - 24 * 60 * 60 * 1000).all<OfferRow>(),
  ])

  const processing = await c.env.DB.prepare(
    `SELECT offer.id, offer.status, offer.expires_at, offer.created_at, offer.responded_at,
            offer.start_date, offer.end_date, offer.origin_json, offer.destination_json,
            vehicle.make, vehicle.model, COUNT(follow_up.id) AS follow_up_count
       FROM driver_trip_offers AS offer
       JOIN vehicles AS vehicle ON vehicle.id = offer.vehicle_id
       LEFT JOIN driver_trip_offer_followups AS follow_up ON follow_up.offer_id = offer.id
      WHERE offer.status = 'quoting'
      GROUP BY offer.id
      ORDER BY offer.responded_at ASC LIMIT 50`,
  ).all<OfferRow>()

  return c.json({
    pendingOffers: pending.results.map(presentOffer),
    processingOffers: processing.results.map(presentOffer),
    recentOffers: recent.results.map(presentOffer),
    refreshedAt: now,
  })
})

adminTripOffersApp.post('/:offerId/driver-contact', async (c) => {
  const access = await requireAdmin(c)
  if ('error' in access) return access.error

  const now = Date.now()
  const driver = await c.env.DB.prepare(
    `SELECT offer.id AS offer_id, driver.legal_name AS driver_name, driver.phone_e164 AS driver_phone
       FROM driver_trip_offers AS offer
       JOIN driver_applications AS driver ON driver.id = offer.driver_application_id
      WHERE offer.id = ? AND offer.status = 'pending' AND offer.expires_at > ?
      LIMIT 1`,
  ).bind(c.req.param('offerId'), now).first<{
    offer_id: string
    driver_name: string
    driver_phone: string
  }>()
  if (!driver) return c.json(apiError('TRIP_OFFER_NOT_PENDING', 'This offer is no longer waiting for a driver.'), 409)

  await writeMarketplaceAudit(c.env, {
    actorUserId: access.user.id,
    action: 'driver_trip_offer_contact_accessed',
    targetType: 'driver_trip_offer',
    targetId: driver.offer_id,
  })
  return c.json({ driver: { name: driver.driver_name, phone: driver.driver_phone } })
})

adminTripOffersApp.post('/:offerId/follow-ups', async (c) => {
  const access = await requireAdmin(c)
  if ('error' in access) return access.error

  const body: unknown = await c.req.json().catch(() => null)
  const input = typeof body === 'object' && body !== null && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {}
  const outcome = input.outcome
  const note = input.note === undefined || input.note === null ? null : input.note
  if (!callOutcomes.has(String(outcome)) ||
      (note !== null && (typeof note !== 'string' || note.trim().length > 500))) {
    return c.json(apiError('INVALID_FOLLOW_UP', 'Choose a call outcome and enter an optional note of no more than 500 characters.'), 400)
  }

  const now = Date.now()
  const offer = await c.env.DB.prepare(
    `SELECT id, status, expires_at FROM driver_trip_offers
      WHERE id = ? LIMIT 1`,
  ).bind(c.req.param('offerId')).first<{ id: string; status: string; expires_at: number }>()
  if (!offer || offer.status !== 'pending' || offer.expires_at <= now) {
    return c.json(apiError('TRIP_OFFER_NOT_PENDING', 'Call attempts can only be recorded for an offer still awaiting a driver.'), 409)
  }

  const followUpId = crypto.randomUUID()
  await c.env.DB.prepare(
    `INSERT INTO driver_trip_offer_followups
      (id, offer_id, actor_user_id, outcome, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(followUpId, offer.id, access.user.id, outcome, typeof note === 'string' ? note.trim() || null : null, now).run()
  await writeMarketplaceAudit(c.env, {
    actorUserId: access.user.id,
    action: 'driver_trip_offer_followup_recorded',
    targetType: 'driver_trip_offer',
    targetId: offer.id,
    reason: `Manual driver call outcome: ${String(outcome)}`,
  })

  return c.json({ followUpId, offerId: offer.id, outcome, createdAt: now }, 201)
})

export default adminTripOffersApp
