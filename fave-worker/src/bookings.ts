import { Hono, type Context } from 'hono'
import type { AuthBindings } from './auth'
import {
  apiError,
  getSignedInUser,
  writeMarketplaceAudit,
} from './marketplace-auth'
import { computeDrivingRoute, classifyLocation, parseLocationInput } from './google-maps'
import { getCurrentPolicies } from './marketplace-policies'
import { daysBetween, parseTripDateRange } from './trip-dates'
import { approvedVehicleEvidencePredicate } from './vehicles'
import { availabilityAuditStatement, expireAvailabilityRequests, requestNeedsReviewPredicate, requestReviewBindings } from './availability-requests'
import { buildNotificationEventStatements } from './notification-store'
import type { NotificationEventInput } from './notification-contracts'
import { calculateVehicleFareLeg, validateVehicleFareBenchmark } from './vehicle-fares'
import type { VehicleFareBenchmark } from './vehicle-fares'

type FareComponent = {
  key: string
  label: string
  amount: number
  unit: 'fixed' | 'per_kilometer' | 'per_night' | 'per_passenger'
}

type FarePolicy = {
  id: string
  version: string
  currency: string
  rules_json: string
  quote_ttl_seconds: number
  hold_ttl_seconds: number
}

type QuoteSnapshot = {
  currency: string
  components: Array<{
    key: string
    label: string
    unit: FareComponent['unit']
    unitRate: number
    quantity: number
    amount: number
  }>
  totalAmount: number
  depositAmount: number
  depositBasisPoints: number
  farePolicyVersion: string
  distanceMeters: number
  durationSeconds: number
  nights: number
  driverLodgingRate?: number
  outboundRoute?: { distanceMeters: number; durationSeconds: number }
  returnRoute?: { distanceMeters: number; durationSeconds: number }
  vehicleFareBenchmark?: VehicleFareBenchmark
  vehicleId?: string
  driverApplicationId?: string
}

type TripLocationSnapshot = {
  input: { address: string } | { latitude: number; longitude: number }
  address: string
  formattedAddress: string | null
  broadArea?: string | null
  latitude: number
  longitude: number
}

type ClientTripOfferRow = {
  id: string
  vehicle_id: string
  status: string
  quote_id: string | null
  expires_at: number
  origin_json: string
  destination_json: string
  start_date: string
  end_date: string
  party_size: number
  luggage_count: number
  vehicle_make: string | null
  vehicle_model: string | null
  vehicle_year: number | null
  passenger_capacity: number | null
  luggage_capacity: number | null
}

function clientTripRequestSnapshot(offer: ClientTripOfferRow) {
  try {
    return {
      pickup: JSON.parse(offer.origin_json) as TripLocationSnapshot,
      destination: JSON.parse(offer.destination_json) as TripLocationSnapshot,
      startDate: offer.start_date,
      endDate: offer.end_date,
      partySize: offer.party_size,
      luggageCount: offer.luggage_count,
      vehicle: offer.vehicle_make && offer.vehicle_model && offer.vehicle_year !== null &&
          offer.passenger_capacity !== null && offer.luggage_capacity !== null
        ? {
            id: offer.vehicle_id,
            make: offer.vehicle_make,
            model: offer.vehicle_model,
            year: offer.vehicle_year,
            passengerCapacity: offer.passenger_capacity,
            luggageCapacity: offer.luggage_capacity,
          }
        : null,
    }
  } catch {
    return null
  }
}

const tripsApp = new Hono<{ Bindings: AuthBindings }>()
const DRIVER_TRIP_OFFER_TTL_MS = 15 * 60 * 1000

// Estimates are immutable and do not hold a vehicle. Availability is checked
// again atomically when staff confirms the dates.
tripsApp.post('/estimates', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)

  const body: unknown = await c.req.json().catch(() => null)
  const validation = await validateTripRequest(c.env, body)
  if (validation.kind !== 'valid') {
    const status = validation.kind === 'invalid' ? 400 : validation.kind === 'provider' ? 503 : 422
    return c.json(apiError(validation.kind.toUpperCase(), validation.message), status)
  }
  const vehicleId = typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>).vehicleId
    : null
  if (typeof vehicleId !== 'string' || vehicleId.length > 80) {
    return c.json(apiError('VEHICLE_REQUIRED', 'Choose an approved vehicle to estimate this trip.'), 400)
  }

  const [vehicle, farePolicy] = await Promise.all([
    c.env.DB.prepare(
      `SELECT vehicle.id, vehicle.driver_application_id, vehicle.passenger_capacity, vehicle.luggage_capacity,
              driver.lodging_rate_ugx AS driver_lodging_rate_ugx,
              vehicle.benchmark_amount_ugx, vehicle.benchmark_basis_json,
              vehicle.benchmark_derivation_version
         FROM vehicles AS vehicle
         JOIN driver_applications AS driver ON driver.id = vehicle.driver_application_id
        WHERE vehicle.id = ? AND vehicle.status = 'approved' AND driver.status = 'approved'
          AND ${approvedVehicleEvidencePredicate('vehicle')}
        LIMIT 1`,
    ).bind(vehicleId, Date.now(), Date.now(), Date.now(), Date.now(), Date.now(), Date.now())
      .first<{
        id: string; driver_application_id: string; passenger_capacity: number; luggage_capacity: number;
        driver_lodging_rate_ugx: number | null; benchmark_amount_ugx: number | null;
        benchmark_basis_json: string | null; benchmark_derivation_version: number | null
      }>(),
    getActiveFarePolicy(c.env),
  ])
  if (!vehicle) return c.json(apiError('VEHICLE_UNAVAILABLE', 'This vehicle is not available for selection.'), 409)
  if (vehicle.passenger_capacity < validation.partySize || vehicle.luggage_capacity < validation.luggageCount) {
    return c.json(apiError('VEHICLE_CAPACITY', 'This vehicle does not have enough passenger or luggage capacity.'), 422)
  }
  if (!Number.isSafeInteger(vehicle.driver_lodging_rate_ugx) || vehicle.driver_lodging_rate_ugx === null || vehicle.driver_lodging_rate_ugx < 1) {
    return c.json(apiError('DRIVER_LODGING_RATE_REQUIRED', 'This driver’s overnight accommodation rate is not available yet. Choose another vehicle or try again later.'), 409)
  }
  if (!farePolicy) return c.json(apiError('FARE_POLICY_UNAVAILABLE', 'Trip estimates are unavailable until the approved fare policy is configured.'), 409)

  let benchmark: VehicleFareBenchmark | null = null
  try {
    if (vehicle.benchmark_amount_ugx !== null && vehicle.benchmark_basis_json && vehicle.benchmark_derivation_version === 1) {
      benchmark = {
        amountUgx: vehicle.benchmark_amount_ugx,
        currency: 'UGX',
        basis: JSON.parse(vehicle.benchmark_basis_json) as VehicleFareBenchmark['basis'],
        derivationVersion: 1,
      }
    }
  } catch { benchmark = null }
  if (!benchmark || !validateVehicleFareBenchmark(benchmark)) {
    return c.json(apiError('VEHICLE_FARE_UNAVAILABLE', 'This vehicle does not have an approved fare benchmark yet. Choose another car or try again later.'), 409)
  }

  const now = Date.now()
  const unavailable = await c.env.DB.prepare(
    `SELECT 1 AS unavailable FROM vehicle_unavailability
      WHERE vehicle_id = ? AND start_date < ? AND end_date > ?
     UNION ALL
     SELECT 1 AS unavailable FROM bookings
      JOIN vehicles AS booked_vehicle ON booked_vehicle.id = bookings.vehicle_id
      WHERE (bookings.vehicle_id = ? OR booked_vehicle.driver_application_id = ?)
        AND bookings.start_date < ? AND bookings.end_date > ?
        AND (bookings.status = 'confirmed' OR (bookings.status = 'deposit_pending' AND bookings.hold_expires_at > ?))
     UNION ALL
     SELECT 1 AS unavailable FROM availability_requests
      WHERE (vehicle_id = ? OR driver_application_id = ?) AND start_date < ? AND end_date > ?
        AND status = 'confirmed' AND hold_expires_at > ?
     UNION ALL
     SELECT 1 AS unavailable FROM driver_trip_offers
      WHERE (vehicle_id = ? OR driver_application_id = ?) AND start_date < ? AND end_date > ?
        AND status IN ('pending', 'quoting') AND expires_at > ?
     LIMIT 1`,
  ).bind(
    vehicleId, validation.endDate, validation.startDate,
    vehicleId, vehicle.driver_application_id, validation.endDate, validation.startDate, now,
    vehicleId, vehicle.driver_application_id, validation.endDate, validation.startDate, now,
    vehicleId, vehicle.driver_application_id, validation.endDate, validation.startDate, now,
  ).first<{ unavailable: number }>()
  if (unavailable) return c.json(apiError('VEHICLE_DATES_UNAVAILABLE', 'This vehicle is already booked or held for those dates.'), 409)

  const [outboundRoute, returnRoute] = await Promise.all([
    computeDrivingRoute(c.env, validation.origin, validation.destination),
    computeDrivingRoute(c.env, validation.destination, validation.origin),
  ])
  if (outboundRoute.kind === 'provider_error' || returnRoute.kind === 'provider_error') {
    return c.json(apiError('GOOGLE_MAPS_UNAVAILABLE', 'We could not calculate this trip estimate right now.'), 503)
  }
  if (outboundRoute.kind === 'no_route' || returnRoute.kind === 'no_route') {
    return c.json(apiError('ROUTE_UNAVAILABLE', 'A drivable outbound and return route could not be found.'), 422)
  }

  const snapshot = buildVehicleQuoteSnapshot(
    farePolicy, outboundRoute, returnRoute, daysBetween(validation.startDate, validation.endDate),
    validation.partySize, vehicle.driver_lodging_rate_ugx, benchmark,
    { vehicleId: vehicle.id, driverApplicationId: vehicle.driver_application_id },
  )
  if (!snapshot) return c.json(apiError('FARE_POLICY_INVALID', 'The configured fare policy could not calculate this estimate.'), 409)

  const estimateId = crypto.randomUUID()
  const saved = await c.env.DB.prepare(
    `INSERT INTO trip_estimates
      (id, client_user_id, vehicle_id, driver_application_id, policy_id, origin_json, destination_json,
       start_date, end_date, party_size, luggage_count, snapshot_json, created_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM vehicle_unavailability
         WHERE vehicle_id = ? AND start_date < ? AND end_date > ?
      ) AND NOT EXISTS (
        SELECT 1 FROM bookings
          JOIN vehicles AS booked_vehicle ON booked_vehicle.id = bookings.vehicle_id
         WHERE (bookings.vehicle_id = ? OR booked_vehicle.driver_application_id = ?)
           AND bookings.start_date < ? AND bookings.end_date > ?
           AND (bookings.status = 'confirmed' OR (bookings.status = 'deposit_pending' AND bookings.hold_expires_at > ?))
      ) AND NOT EXISTS (
        SELECT 1 FROM availability_requests WHERE (vehicle_id = ? OR driver_application_id = ?)
          AND start_date < ? AND end_date > ? AND status = 'confirmed' AND hold_expires_at > ?
      )`,
  ).bind(
    estimateId, user.id, vehicle.id, vehicle.driver_application_id, farePolicy.id,
    JSON.stringify(validation.originSnapshot), JSON.stringify(validation.destinationSnapshot),
    validation.startDate, validation.endDate, validation.partySize, validation.luggageCount,
    JSON.stringify(snapshot), now,
    vehicleId, validation.endDate, validation.startDate,
    vehicleId, vehicle.driver_application_id, validation.endDate, validation.startDate, now,
    vehicleId, vehicle.driver_application_id, validation.endDate, validation.startDate, now,
  ).run()
  if (saved.meta.changes !== 1) return c.json(apiError('VEHICLE_DATES_UNAVAILABLE', 'This vehicle is no longer available for those dates.'), 409)

  return c.json({
    estimateId, vehicleId: vehicle.id, pickup: validation.originSnapshot, destination: validation.destinationSnapshot,
    startDate: validation.startDate, endDate: validation.endDate, partySize: validation.partySize,
    luggageCount: validation.luggageCount,
    route: { distanceMeters: outboundRoute.distanceMeters, durationSeconds: outboundRoute.durationSeconds },
    quote: snapshot, createdAt: now,
  }, 201)
})

tripsApp.get('/estimates/:estimateId', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)
  const estimate = await c.env.DB.prepare(
    `SELECT estimate.id, estimate.vehicle_id, estimate.origin_json, estimate.destination_json,
            estimate.start_date, estimate.end_date, estimate.party_size, estimate.luggage_count,
            estimate.snapshot_json, estimate.created_at, vehicle.make, vehicle.model, vehicle.model_year,
            vehicle.passenger_capacity, vehicle.luggage_capacity
       FROM trip_estimates AS estimate JOIN vehicles AS vehicle ON vehicle.id = estimate.vehicle_id
      WHERE estimate.id = ? AND estimate.client_user_id = ? LIMIT 1`,
  ).bind(c.req.param('estimateId'), user.id).first<Record<string, unknown>>()
  if (!estimate) return c.json(apiError('ESTIMATE_NOT_FOUND', 'This trip estimate was not found.'), 404)
  const snapshot = JSON.parse(String(estimate.snapshot_json)) as QuoteSnapshot
  return c.json({
    estimateId: estimate.id, vehicleId: estimate.vehicle_id,
    pickup: JSON.parse(String(estimate.origin_json)) as TripLocationSnapshot,
    destination: JSON.parse(String(estimate.destination_json)) as TripLocationSnapshot,
    startDate: estimate.start_date, endDate: estimate.end_date, partySize: estimate.party_size,
    luggageCount: estimate.luggage_count,
    vehicle: { make: estimate.make, model: estimate.model, year: estimate.model_year },
    quote: snapshot, route: { distanceMeters: snapshot.distanceMeters, durationSeconds: snapshot.durationSeconds },
    createdAt: estimate.created_at,
  })
})

tripsApp.post('/estimates/:estimateId/availability-request', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)
  const now = Date.now()
  const requestId = crypto.randomUUID()
  const inserted = await c.env.DB.batch([c.env.DB.prepare(
    `INSERT INTO availability_requests
      (id, estimate_id, client_user_id, vehicle_id, driver_application_id, start_date, end_date,
       status, created_at, updated_at)
     SELECT ?, estimate.id, estimate.client_user_id, estimate.vehicle_id, estimate.driver_application_id,
            estimate.start_date, estimate.end_date, 'requested', ?, ?
       FROM trip_estimates AS estimate
      WHERE estimate.id = ? AND estimate.client_user_id = ?
        AND NOT EXISTS (SELECT 1 FROM availability_requests WHERE estimate_id = estimate.id)`,
  ).bind(requestId, now, now, c.req.param('estimateId'), user.id),
  availabilityAuditStatement(c.env, { requestId, actorUserId: user.id, action: 'availability_requested', priorState: null, newState: 'requested', now }),
  ])
  if (inserted[0]?.meta.changes !== 1) return c.json(apiError('ESTIMATE_UNAVAILABLE', 'This estimate cannot be submitted for an availability check.'), 409)
  return c.json({ requestId, estimateId: c.req.param('estimateId'), status: 'requested', createdAt: now }, 201)
})

async function clientAvailabilityResponse(c: Context<{ Bindings: AuthBindings }>, requestId?: string) {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)
  const now = Date.now()
  await expireAvailabilityRequests(c.env, now, user.id)
  const request = await c.env.DB.prepare(
    `SELECT request.id, request.estimate_id, request.status, request.created_at, request.quote_id,
            request.hold_expires_at, quote.quote_json, quote.expires_at,
            estimate.vehicle_id, estimate.origin_json, estimate.destination_json, estimate.start_date,
            estimate.end_date, estimate.party_size, estimate.luggage_count, estimate.snapshot_json,
            estimate.created_at AS estimate_created_at, vehicle.make, vehicle.model, vehicle.model_year,
            ${requestNeedsReviewPredicate('request')} AS needs_review
       FROM availability_requests AS request
       JOIN trip_estimates AS estimate ON estimate.id = request.estimate_id
       JOIN vehicles AS vehicle ON vehicle.id = estimate.vehicle_id
       LEFT JOIN trip_quotes AS quote ON quote.id = request.quote_id
      WHERE request.client_user_id = ? ${requestId ? 'AND request.id = ?' : ''}
      ORDER BY request.created_at DESC, request.id DESC LIMIT 1`,
  ).bind(...requestReviewBindings(now), user.id, ...(requestId ? [requestId] : [])).first<Record<string, unknown>>()
  if (!request) return requestId
    ? c.json(apiError('REQUEST_NOT_FOUND', 'This availability request was not found.'), 404)
    : c.json({ request: null })
  const estimateSnapshot = JSON.parse(String(request.snapshot_json)) as QuoteSnapshot
  return c.json({ request: {
    requestId: request.id, estimateId: request.estimate_id, status: request.status,
    needsReview: Boolean(request.needs_review),
    createdAt: request.created_at, expiresAt: request.expires_at ?? null,
    holdExpiresAt: request.hold_expires_at ?? null,
    estimate: {
      estimateId: request.estimate_id, vehicleId: request.vehicle_id,
      pickup: JSON.parse(String(request.origin_json)) as TripLocationSnapshot,
      destination: JSON.parse(String(request.destination_json)) as TripLocationSnapshot,
      startDate: request.start_date, endDate: request.end_date,
      partySize: request.party_size, luggageCount: request.luggage_count,
      quote: estimateSnapshot,
      route: { distanceMeters: estimateSnapshot.distanceMeters, durationSeconds: estimateSnapshot.durationSeconds },
      vehicle: { make: request.make, model: request.model, year: request.model_year },
      createdAt: request.estimate_created_at,
    },
    ...(request.status === 'confirmed' && !request.needs_review && request.quote_json
      ? { quote: JSON.parse(String(request.quote_json)) as QuoteSnapshot, quoteId: request.quote_id } : {}),
  } })
}
tripsApp.get('/availability-requests/current', (c) => clientAvailabilityResponse(c))
tripsApp.get('/availability-requests/:requestId', (c) => clientAvailabilityResponse(c, c.req.param('requestId')))

tripsApp.post('/availability-requests/:requestId/withdraw', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)
  const now = Date.now()
  const result = await c.env.DB.batch([c.env.DB.prepare(
    `UPDATE availability_requests SET status = 'withdrawn', updated_at = ?
      WHERE id = ? AND client_user_id = ? AND status = 'requested'`,
  ).bind(now, c.req.param('requestId'), user.id),
  availabilityAuditStatement(c.env, { requestId: c.req.param('requestId'), actorUserId: user.id, action: 'availability_withdrawn', priorState: 'requested', newState: 'withdrawn', now }),
  ])
  if (result[0]?.meta.changes !== 1) return c.json(apiError('REQUEST_NOT_PENDING', 'Only a pending availability request can be withdrawn.'), 409)
  return c.json({ requestId: c.req.param('requestId'), status: 'withdrawn' })
})

function notificationStatements(db: AuthBindings['DB'], event: NotificationEventInput, now: number) {
  return buildNotificationEventStatements(db, event, now, { requirePriorChange: true })
}

function toTripLocationSnapshot(
  input: TripLocationSnapshot['input'],
  resolved: Extract<Awaited<ReturnType<typeof classifyLocation>>, { kind: 'resolved' }>,
): TripLocationSnapshot {
  return {
    input,
    address: 'address' in input
      ? input.address
      : resolved.formattedAddress ?? `${input.latitude}, ${input.longitude}`,
    formattedAddress: resolved.formattedAddress,
    broadArea: resolved.pickupArea ?? resolved.broadArea,
    latitude: resolved.latitude,
    longitude: resolved.longitude,
  }
}

function parseStoredLocationInput(value: unknown): TripLocationSnapshot['input'] | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const input = (value as Record<string, unknown>).input
    if (input !== undefined) return parseLocationInput(input)
  }
  return parseLocationInput(value)
}

function matchesStoredLocation(value: unknown, current: TripLocationSnapshot): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    const input = parseLocationInput(value)
    return !input || !('latitude' in input) ||
      (input.latitude === current.latitude && input.longitude === current.longitude)
  }

  const stored = value as Record<string, unknown>
  if (typeof stored.latitude === 'number' && typeof stored.longitude === 'number' &&
      (stored.latitude !== current.latitude || stored.longitude !== current.longitude)) {
    return false
  }
  if (typeof stored.formattedAddress === 'string' &&
      stored.formattedAddress !== current.formattedAddress) {
    return false
  }
  const input = parseLocationInput(stored.input)
  return !input || !('latitude' in input) ||
    (input.latitude === current.latitude && input.longitude === current.longitude)
}

function parseFareRules(
  policy: FarePolicy,
): { components: FareComponent[]; depositBasisPoints: number } | null {
  let value: unknown
  try {
    value = JSON.parse(policy.rules_json)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const rules = value as Record<string, unknown>
  const components = rules.components
  const depositBasisPoints = rules.depositBasisPoints
  if (
    !Array.isArray(components) || components.length === 0 || components.length > 12 ||
    !Number.isInteger(depositBasisPoints) || Number(depositBasisPoints) < 100 || Number(depositBasisPoints) > 9900
  ) {
    return null
  }
  const parsedComponents: FareComponent[] = []
  for (const component of components) {
    if (typeof component !== 'object' || component === null || Array.isArray(component)) return null
    const entry = component as Record<string, unknown>
    if (
      typeof entry.key !== 'string' || !/^[a-z0-9_-]{1,40}$/u.test(entry.key) ||
      typeof entry.label !== 'string' || entry.label.trim().length < 2 || entry.label.trim().length > 80 ||
      !Number.isSafeInteger(entry.amount) || Number(entry.amount) < 0 || Number(entry.amount) > 1_000_000_000 ||
      !['fixed', 'per_kilometer', 'per_night', 'per_passenger'].includes(String(entry.unit))
    ) {
      return null
    }
    parsedComponents.push({
      key: entry.key,
      label: entry.label.trim(),
      amount: Number(entry.amount),
      unit: entry.unit as FareComponent['unit'],
    })
  }
  return { components: parsedComponents, depositBasisPoints: Number(depositBasisPoints) }
}

export function buildQuoteSnapshot(
  policy: FarePolicy,
  route: { distanceMeters: number; durationSeconds: number },
  nights: number,
  partySize: number,
  driverLodgingRate?: number,
): QuoteSnapshot | null {
  const rules = parseFareRules(policy)
  if (!rules || !/^[A-Z]{3}$/u.test(policy.currency)) return null
  if (driverLodgingRate !== undefined &&
      (!Number.isSafeInteger(driverLodgingRate) || driverLodgingRate < 1 || driverLodgingRate > 1_000_000_000)) {
    return null
  }
  if (driverLodgingRate !== undefined && !rules.components.some((component) => component.key === 'driver_lodging' && component.unit === 'per_night')) {
    return null
  }

  const distanceKilometers = Math.ceil(route.distanceMeters / 1000)
  const components = rules.components.map((component) => {
    const quantity = component.unit === 'fixed' ? 1 :
      component.unit === 'per_kilometer' ? distanceKilometers :
        component.unit === 'per_night' ? nights : partySize
    const unitRate = component.key === 'driver_lodging' && driverLodgingRate !== undefined
      ? driverLodgingRate
      : component.amount
    return {
      key: component.key,
      label: component.label,
      unit: component.unit,
      unitRate,
      quantity,
      amount: unitRate * quantity,
    }
  })
  const totalAmount = components.reduce((sum, component) => sum + component.amount, 0)
  if (!Number.isSafeInteger(totalAmount) || totalAmount > 10_000_000_000) return null

  return {
    currency: policy.currency,
    components,
    totalAmount,
    depositAmount: Math.ceil(totalAmount * rules.depositBasisPoints / 10_000),
    depositBasisPoints: rules.depositBasisPoints,
    farePolicyVersion: policy.version,
    distanceMeters: route.distanceMeters,
    durationSeconds: route.durationSeconds,
    nights,
    ...(driverLodgingRate === undefined ? {} : { driverLodgingRate }),
  }
}

export function buildVehicleQuoteSnapshot(
  policy: FarePolicy,
  outboundRoute: { distanceMeters: number; durationSeconds: number },
  returnRoute: { distanceMeters: number; durationSeconds: number },
  nights: number,
  partySize: number,
  driverLodgingRate: number,
  vehicleFareBenchmark: VehicleFareBenchmark,
  selectedVehicle?: { vehicleId: string; driverApplicationId: string },
): QuoteSnapshot | null {
  if (!validateVehicleFareBenchmark(vehicleFareBenchmark)) return null
  const parsedRules = parseFareRules(policy)
  if (!parsedRules) return null
  const nonDistancePolicy = {
    ...policy,
    rules_json: JSON.stringify({
      components: parsedRules.components.filter((component) => component.unit !== 'per_kilometer'),
      depositBasisPoints: parsedRules.depositBasisPoints,
    }),
  }
  const base = buildQuoteSnapshot(nonDistancePolicy, outboundRoute, nights, partySize, driverLodgingRate)
  const outbound = calculateVehicleFareLeg(vehicleFareBenchmark, outboundRoute.distanceMeters)
  const returning = calculateVehicleFareLeg(vehicleFareBenchmark, returnRoute.distanceMeters)
  if (!base || !outbound || !returning ||
      !Number.isSafeInteger(outboundRoute.durationSeconds) || outboundRoute.durationSeconds < 0 ||
      !Number.isSafeInteger(returnRoute.distanceMeters) || returnRoute.distanceMeters < 1 ||
      !Number.isSafeInteger(returnRoute.durationSeconds) || returnRoute.durationSeconds < 0) return null

  const components = [
    ...base.components,
    {
      key: 'outbound_transport', label: 'Outbound transport', unit: 'per_kilometer' as const,
      unitRate: outbound.rateUgxPerKm, quantity: outboundRoute.distanceMeters / 1000, amount: outbound.amountUgx,
    },
    {
      key: 'return_transport', label: 'Return transport', unit: 'per_kilometer' as const,
      unitRate: returning.rateUgxPerKm, quantity: returnRoute.distanceMeters / 1000, amount: returning.amountUgx,
    },
  ]
  const totalAmount = components.reduce((sum, component) => sum + component.amount, 0)
  if (!Number.isSafeInteger(totalAmount) || totalAmount > 10_000_000_000) return null
  return {
    ...base,
    components,
    totalAmount,
    depositAmount: Math.ceil(totalAmount * base.depositBasisPoints / 10_000),
    outboundRoute,
    returnRoute,
    vehicleFareBenchmark,
    ...(selectedVehicle ? selectedVehicle : {}),
  }
}

async function getActiveFarePolicy(env: AuthBindings): Promise<FarePolicy | null> {
  return env.DB.prepare(
    `SELECT id, version, currency, rules_json, quote_ttl_seconds, hold_ttl_seconds
       FROM fare_policies
      WHERE active = 1 AND approved_at IS NOT NULL AND effective_at IS NOT NULL AND effective_at <= ?
      ORDER BY effective_at DESC LIMIT 1`,
  )
    .bind(Date.now())
    .first<FarePolicy>()
}

async function validateTripRequest(
  env: AuthBindings,
  body: unknown,
): Promise<
  | { kind: 'invalid'; message: string }
  | { kind: 'pickup'; message: string }
  | { kind: 'destination'; message: string }
  | { kind: 'provider'; message: string }
  | {
      kind: 'valid'
      origin: { address: string } | { latitude: number; longitude: number }
      destination: { address: string } | { latitude: number; longitude: number }
      originSnapshot: TripLocationSnapshot
      destinationSnapshot: TripLocationSnapshot
      startDate: string
      endDate: string
      partySize: number
      luggageCount: number
    }
> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { kind: 'invalid', message: 'Enter trip locations, dates, and passenger details.' }
  }
  const input = body as Record<string, unknown>
  const origin = parseLocationInput(input.origin)
  const destination = parseLocationInput(input.destination)
  const dateRange = parseTripDateRange(input.startDate, input.endDate)
  const partySize = input.partySize
  const luggageCount = input.luggageCount
  if (
    !origin || !destination || !dateRange ||
    !Number.isInteger(partySize) || Number(partySize) < 1 || Number(partySize) > 20 ||
    !Number.isInteger(luggageCount) || Number(luggageCount) < 0 || Number(luggageCount) > 20
  ) {
    return { kind: 'invalid', message: 'Enter valid Uganda locations, trip dates up to seven days, passenger count, and luggage count.' }
  }

  const [pickup, destinationResult] = await Promise.all([
    classifyLocation(env, origin),
    classifyLocation(env, destination),
  ])
  if (pickup.kind === 'provider_error' || destinationResult.kind === 'provider_error') {
    return { kind: 'provider', message: 'Location checks are temporarily unavailable.' }
  }
  if (pickup.kind !== 'resolved' || pickup.countryCode !== 'UG' || !pickup.pickupArea) {
    return { kind: 'pickup', message: 'Pickups must be in Kampala, Mukono, or Wakiso. Adjust the address or map pin.' }
  }
  if (destinationResult.kind !== 'resolved' || destinationResult.countryCode !== 'UG') {
    return { kind: 'destination', message: 'Destinations must be in Uganda. Adjust the address or map pin.' }
  }

  const originSnapshot = toTripLocationSnapshot(origin, pickup)
  const destinationSnapshot = toTripLocationSnapshot(destination, destinationResult)

  return {
    kind: 'valid',
    origin,
    destination,
    originSnapshot,
    destinationSnapshot,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    partySize: Number(partySize),
    luggageCount: Number(luggageCount),
  }
}

// Existing offers remain readable/respondable during the transition. New
// booking intent must use the saved estimate and staff availability flow.
tripsApp.post('/quote', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)
  return c.json(apiError('BOOKING_FLOW_UPDATED', 'Update Fave to see a price estimate and ask staff to confirm your dates.'), 410)
})

tripsApp.get('/quote-requests/current', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)

  const now = Date.now()
  await expirePendingDriverTripOffers(c.env, now, user.id)
  await c.env.DB.prepare(
    `UPDATE driver_trip_offers SET status = 'quote_failed'
      WHERE client_user_id = ? AND status = 'quoting' AND quote_id IS NULL AND expires_at <= ?`,
  ).bind(user.id, now).run()
  const offer = await c.env.DB.prepare(
    `SELECT offer.id, offer.vehicle_id, offer.status, offer.quote_id, offer.expires_at,
            offer.origin_json, offer.destination_json, offer.start_date, offer.end_date,
            offer.party_size, offer.luggage_count, vehicle.make AS vehicle_make,
            vehicle.model AS vehicle_model, vehicle.model_year AS vehicle_year,
            vehicle.passenger_capacity, vehicle.luggage_capacity
       FROM driver_trip_offers AS offer
       LEFT JOIN vehicles AS vehicle ON vehicle.id = offer.vehicle_id
      WHERE offer.client_user_id = ? ORDER BY offer.created_at DESC LIMIT 1`,
  ).bind(user.id).first<ClientTripOfferRow>()
  if (!offer) return c.json({ offer: null })
  const tripRequest = clientTripRequestSnapshot(offer)
  if (offer.status === 'quoted' && offer.quote_id) {
    const existingBooking = await c.env.DB.prepare(
      `SELECT id FROM bookings WHERE quote_id = ? AND client_user_id = ? LIMIT 1`,
    ).bind(offer.quote_id, user.id).first<{ id: string }>()
    if (existingBooking) {
      return c.json({ offer: {
        offerId: offer.id, vehicleId: offer.vehicle_id, status: 'booked', expiresAt: offer.expires_at,
        ...(tripRequest ? { tripRequest } : {}),
      } })
    }
  }
  if (offer.status !== 'quoted' || !offer.quote_id) {
    return c.json({ offer: {
      offerId: offer.id, vehicleId: offer.vehicle_id, status: offer.status, expiresAt: offer.expires_at,
      ...(tripRequest ? { tripRequest } : {}),
    } })
  }

  const quote = await c.env.DB.prepare(
    `SELECT id, origin_json, destination_json, route_distance_meters,
            route_duration_seconds, quote_json, expires_at
       FROM trip_quotes WHERE id = ? AND client_user_id = ? LIMIT 1`,
  ).bind(offer.quote_id, user.id).first<{
    id: string; origin_json: string; destination_json: string; route_distance_meters: number
    route_duration_seconds: number; quote_json: string; expires_at: number
  }>()
  if (!quote) return c.json(apiError('TRIP_QUOTE_NOT_FOUND', 'The accepted trip offer could not produce a quote. Choose another vehicle.'), 409)
  try {
    return c.json({ offer: {
      offerId: offer.id, vehicleId: offer.vehicle_id, status: 'quoted', expiresAt: quote.expires_at,
      ...(tripRequest ? { tripRequest } : {}),
      quote: {
        quoteId: quote.id, vehicleId: offer.vehicle_id,
        pickup: JSON.parse(quote.origin_json) as TripLocationSnapshot,
        destination: JSON.parse(quote.destination_json) as TripLocationSnapshot,
        route: { distanceMeters: quote.route_distance_meters, durationSeconds: quote.route_duration_seconds },
        quote: JSON.parse(quote.quote_json) as QuoteSnapshot, expiresAt: quote.expires_at,
      },
    } })
  } catch {
    return c.json(apiError('TRIP_QUOTE_INVALID', 'The trip quote could not be loaded. Choose another vehicle.'), 409)
  }
})

tripsApp.post('/quote-requests/:offerId/withdraw', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)
  const now = Date.now()
  const offer = await c.env.DB.prepare(
    `SELECT driver.user_id AS driverUserId FROM driver_trip_offers AS offer
       JOIN driver_applications AS driver ON driver.id = offer.driver_application_id
      WHERE offer.id = ? AND offer.client_user_id = ? LIMIT 1`,
  ).bind(c.req.param('offerId'), user.id).first<{ driverUserId: string }>()
  if (!offer) return c.json(apiError('TRIP_OFFER_NOT_PENDING', 'This trip request can no longer be withdrawn.'), 409)
  const result = await c.env.DB.batch([
    c.env.DB.prepare(
    `UPDATE driver_trip_offers SET status = 'withdrawn', responded_at = ?
      WHERE id = ? AND client_user_id = ? AND status = 'pending' AND expires_at > ?`,
    ).bind(now, c.req.param('offerId'), user.id, now),
    ...notificationStatements(c.env.DB, {
      id: `booking.withdrawn:${c.req.param('offerId')}`,
      eventType: 'booking.withdrawn',
      eventVersion: 1,
      domainType: 'trip_offer',
      domainId: c.req.param('offerId'),
      occurredAt: now,
      recipients: [{ userId: offer.driverUserId, role: 'driver' }],
    }, now),
  ])
  if (result[0]?.meta?.changes !== 1) {
    return c.json(apiError('TRIP_OFFER_NOT_PENDING', 'This trip request can no longer be withdrawn.'), 409)
  }
  return c.json({ offerId: c.req.param('offerId'), status: 'withdrawn' })
})

tripsApp.get('/quote-requests/:offerId', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)

  const offerId = c.req.param('offerId')
  const now = Date.now()
  await expirePendingDriverTripOffers(c.env, now, user.id, offerId)
  await c.env.DB.prepare(
    `UPDATE driver_trip_offers SET status = 'quote_failed'
      WHERE id = ? AND client_user_id = ? AND status = 'quoting' AND quote_id IS NULL AND expires_at <= ?`,
  ).bind(offerId, user.id, now).run()

  const offer = await c.env.DB.prepare(
    `SELECT offer.id, offer.vehicle_id, offer.status, offer.quote_id, offer.expires_at,
            offer.origin_json, offer.destination_json, offer.start_date, offer.end_date,
            offer.party_size, offer.luggage_count, vehicle.make AS vehicle_make,
            vehicle.model AS vehicle_model, vehicle.model_year AS vehicle_year,
            vehicle.passenger_capacity, vehicle.luggage_capacity
       FROM driver_trip_offers AS offer
       LEFT JOIN vehicles AS vehicle ON vehicle.id = offer.vehicle_id
      WHERE offer.id = ? AND offer.client_user_id = ? LIMIT 1`,
  ).bind(offerId, user.id).first<ClientTripOfferRow>()
  if (!offer) return c.json(apiError('TRIP_OFFER_NOT_FOUND', 'This trip request was not found.'), 404)
  const tripRequest = clientTripRequestSnapshot(offer)
  if (offer.status === 'quoted' && offer.quote_id) {
    const existingBooking = await c.env.DB.prepare(
      `SELECT id FROM bookings WHERE quote_id = ? AND client_user_id = ? LIMIT 1`,
    ).bind(offer.quote_id, user.id).first<{ id: string }>()
    if (existingBooking) {
      return c.json({ offerId: offer.id, vehicleId: offer.vehicle_id, status: 'booked', expiresAt: offer.expires_at, ...(tripRequest ? { tripRequest } : {}) })
    }
  }
  if (offer.status !== 'quoted' || !offer.quote_id) {
    return c.json({ offerId: offer.id, vehicleId: offer.vehicle_id, status: offer.status, expiresAt: offer.expires_at, ...(tripRequest ? { tripRequest } : {}) })
  }

  const quote = await c.env.DB.prepare(
    `SELECT id, origin_json, destination_json, route_distance_meters,
            route_duration_seconds, quote_json, expires_at
       FROM trip_quotes WHERE id = ? AND client_user_id = ? LIMIT 1`,
  ).bind(offer.quote_id, user.id).first<{
    id: string; origin_json: string; destination_json: string; route_distance_meters: number
    route_duration_seconds: number; quote_json: string; expires_at: number
  }>()
  if (!quote) return c.json(apiError('TRIP_QUOTE_NOT_FOUND', 'The accepted trip offer could not produce a quote. Choose another vehicle.'), 409)

  try {
    return c.json({
      offerId: offer.id,
      vehicleId: offer.vehicle_id,
      status: 'quoted',
      quoteId: quote.id,
      ...(tripRequest ? { tripRequest } : {}),
      pickup: JSON.parse(quote.origin_json) as TripLocationSnapshot,
      destination: JSON.parse(quote.destination_json) as TripLocationSnapshot,
      route: { distanceMeters: quote.route_distance_meters, durationSeconds: quote.route_duration_seconds, provider: 'google_maps' },
      quote: JSON.parse(quote.quote_json) as QuoteSnapshot,
      expiresAt: quote.expires_at,
    })
  } catch {
    return c.json(apiError('TRIP_QUOTE_INVALID', 'The trip quote could not be loaded. Choose another vehicle.'), 409)
  }
})

tripsApp.get('/driver-offers', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)

  const now = Date.now()
  const application = await c.env.DB.prepare(
    `SELECT id FROM driver_applications WHERE user_id = ? AND status = 'approved' LIMIT 1`,
  ).bind(user.id).first<{ id: string }>()
  if (!application) return c.json({ offers: [] })

  await expirePendingDriverTripOffers(c.env, now, undefined, undefined, application.id)

  const offers = await c.env.DB.prepare(
    `SELECT offer.id, offer.vehicle_id, offer.origin_json, offer.destination_json,
            offer.start_date, offer.end_date, offer.party_size, offer.luggage_count,
            offer.expires_at, vehicle.make, vehicle.model, vehicle.model_year
       FROM driver_trip_offers AS offer
       JOIN vehicles AS vehicle ON vehicle.id = offer.vehicle_id
      WHERE offer.driver_application_id = ? AND offer.status = 'pending' AND offer.expires_at > ?
        AND vehicle.status = 'approved' AND ${approvedVehicleEvidencePredicate('vehicle')}
      ORDER BY offer.created_at ASC LIMIT 50`,
  ).bind(application.id, now, now, now, now, now, now, now).all<{
    id: string; vehicle_id: string; origin_json: string; destination_json: string
    start_date: string; end_date: string; party_size: number; luggage_count: number
    expires_at: number; make: string; model: string; model_year: number
  }>()

  return c.json({ offers: offers.results.map((offer) => {
    try {
      return {
        offerId: offer.id, vehicleId: offer.vehicle_id,
        pickup: JSON.parse(offer.origin_json) as TripLocationSnapshot,
        destination: JSON.parse(offer.destination_json) as TripLocationSnapshot,
        startDate: offer.start_date, endDate: offer.end_date,
        passengerCount: offer.party_size, luggageCount: offer.luggage_count,
        expiresAt: offer.expires_at,
        vehicle: { make: offer.make, model: offer.model, year: offer.model_year },
      }
    } catch {
      return null
    }
  }).filter((offer) => offer !== null) })
})

tripsApp.post('/driver-offers/:offerId/respond', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)

  const body: unknown = await c.req.json().catch(() => null)
  if (typeof body !== 'object' || body === null || Array.isArray(body) ||
      !['accept', 'decline'].includes(String((body as Record<string, unknown>).decision))) {
    return c.json(apiError('INVALID_DRIVER_RESPONSE', 'Choose accept or decline for this trip offer.'), 400)
  }
  const decision = (body as Record<string, unknown>).decision as 'accept' | 'decline'
  const now = Date.now()
  const offer = await c.env.DB.prepare(
    `SELECT offer.id, offer.client_user_id, offer.vehicle_id, offer.origin_json, offer.destination_json,
            offer.start_date, offer.end_date, offer.party_size, offer.luggage_count,
            offer.status, offer.expires_at, driver.id AS driver_application_id,
            driver.lodging_rate_ugx AS driver_lodging_rate_ugx,
            vehicle.passenger_capacity, vehicle.luggage_capacity,
            vehicle.benchmark_amount_ugx, vehicle.benchmark_basis_json,
            vehicle.benchmark_derivation_version
       FROM driver_trip_offers AS offer
       JOIN driver_applications AS driver ON driver.id = offer.driver_application_id
       JOIN vehicles AS vehicle ON vehicle.id = offer.vehicle_id
      WHERE offer.id = ? AND driver.user_id = ? AND driver.status = 'approved'
        AND vehicle.status = 'approved' AND ${approvedVehicleEvidencePredicate('vehicle')} LIMIT 1`,
  ).bind(c.req.param('offerId'), user.id, now, now, now, now, now, now).first<{
    id: string; client_user_id: string; vehicle_id: string; origin_json: string; destination_json: string
    start_date: string; end_date: string; party_size: number; luggage_count: number
    status: string; expires_at: number; driver_application_id: string; driver_lodging_rate_ugx: number | null
    passenger_capacity: number; luggage_capacity: number
    benchmark_amount_ugx: number | null; benchmark_basis_json: string | null
    benchmark_derivation_version: number | null
  }>()
  if (!offer) return c.json(apiError('TRIP_OFFER_NOT_FOUND', 'This trip offer was not found.'), 404)
  if (offer.status !== 'pending') return c.json({ offerId: offer.id, status: offer.status }, 409)
  if (offer.expires_at <= now) {
    await expirePendingDriverTripOffers(c.env, now, undefined, offer.id, offer.driver_application_id)
    return c.json({ offerId: offer.id, status: 'expired' }, 409)
  }
  if (decision === 'decline') {
    const declined = await c.env.DB.batch([
      c.env.DB.prepare(
      `UPDATE driver_trip_offers SET status = 'declined', responded_at = ?
        WHERE id = ? AND driver_application_id = ? AND status = 'pending' AND expires_at > ?`,
      ).bind(now, offer.id, offer.driver_application_id, now),
      ...notificationStatements(c.env.DB, {
        id: `booking.driver_offer_declined:${offer.id}`,
        eventType: 'booking.driver_offer_declined',
        eventVersion: 1,
        domainType: 'trip_offer',
        domainId: offer.id,
        occurredAt: now,
        recipients: [{ userId: offer.client_user_id, role: 'client' }],
      }, now),
    ])
    if (declined[0]?.meta?.changes !== 1) return c.json(apiError('TRIP_OFFER_ALREADY_HANDLED', 'This trip offer has already been handled.'), 409)
    return c.json({ offerId: offer.id, status: 'declined' })
  }
  if (!Number.isSafeInteger(offer.driver_lodging_rate_ugx) || offer.driver_lodging_rate_ugx === null ||
      offer.driver_lodging_rate_ugx < 1 || offer.passenger_capacity < offer.party_size ||
      offer.luggage_capacity < offer.luggage_count ||
      !Number.isSafeInteger(offer.benchmark_amount_ugx) || offer.benchmark_amount_ugx === null ||
      !offer.benchmark_basis_json || offer.benchmark_derivation_version !== 1) {
    await c.env.DB.prepare(
      `UPDATE driver_trip_offers SET status = 'quote_failed', responded_at = ?
        WHERE id = ? AND driver_application_id = ? AND status = 'pending' AND expires_at > ?`,
    ).bind(now, offer.id, offer.driver_application_id, now).run()
    return c.json({ offerId: offer.id, status: 'quote_failed' }, 409)
  }

  const claimed = await c.env.DB.batch([
    c.env.DB.prepare(
    `UPDATE driver_trip_offers SET status = 'quoting', responded_at = ?, expires_at = ?
      WHERE id = ? AND driver_application_id = ? AND status = 'pending' AND expires_at > ?
        AND NOT EXISTS (
          SELECT 1 FROM driver_trip_offers AS other
           WHERE other.driver_application_id = driver_trip_offers.driver_application_id
             AND other.id != driver_trip_offers.id
             AND other.start_date < driver_trip_offers.end_date
             AND other.end_date > driver_trip_offers.start_date
             AND other.status IN ('pending', 'quoting') AND other.expires_at > ?
        )`,
    ).bind(now, now + DRIVER_TRIP_OFFER_TTL_MS, offer.id, offer.driver_application_id, now, now),
    ...notificationStatements(c.env.DB, {
      id: `booking.driver_offer_accepted:${offer.id}`,
      eventType: 'booking.driver_offer_accepted',
      eventVersion: 1,
      domainType: 'trip_offer',
      domainId: offer.id,
      occurredAt: now,
      recipients: [{ userId: offer.client_user_id, role: 'client' }],
    }, now),
  ])
  if (claimed[0]?.meta?.changes !== 1) {
    return c.json(apiError('TRIP_OFFER_ALREADY_HANDLED', 'This trip offer has already been handled.'), 409)
  }

  const overlap = await c.env.DB.prepare(
    `SELECT 1 AS unavailable FROM vehicle_unavailability
      WHERE vehicle_id = ? AND start_date < ? AND end_date > ?
     UNION ALL
     SELECT 1 AS unavailable FROM bookings
      WHERE vehicle_id = ? AND start_date < ? AND end_date > ?
        AND (status = 'confirmed' OR (status = 'deposit_pending' AND hold_expires_at > ?))
     LIMIT 1`,
  ).bind(offer.vehicle_id, offer.end_date, offer.start_date,
    offer.vehicle_id, offer.end_date, offer.start_date, now).first<{ unavailable: number }>()
  if (overlap) {
    await c.env.DB.prepare(`UPDATE driver_trip_offers SET status = 'quote_failed' WHERE id = ? AND status = 'quoting'`).bind(offer.id).run()
    return c.json({ offerId: offer.id, status: 'quote_failed' }, 409)
  }

  const farePolicy = await getActiveFarePolicy(c.env)
  if (!farePolicy) {
    await c.env.DB.prepare(`UPDATE driver_trip_offers SET status = 'quote_failed' WHERE id = ? AND status = 'quoting'`).bind(offer.id).run()
    return c.json({ offerId: offer.id, status: 'quote_failed' }, 409)
  }
  let originSnapshot: TripLocationSnapshot
  let destinationSnapshot: TripLocationSnapshot
  let originInput: TripLocationSnapshot['input']
  let destinationInput: TripLocationSnapshot['input']
  try {
    originSnapshot = JSON.parse(offer.origin_json) as TripLocationSnapshot
    destinationSnapshot = JSON.parse(offer.destination_json) as TripLocationSnapshot
    const parsedOrigin = parseStoredLocationInput(originSnapshot)
    const parsedDestination = parseStoredLocationInput(destinationSnapshot)
    if (!parsedOrigin || !parsedDestination) throw new Error('invalid stored locations')
    originInput = parsedOrigin
    destinationInput = parsedDestination
  } catch {
    await c.env.DB.prepare(`UPDATE driver_trip_offers SET status = 'quote_failed' WHERE id = ? AND status = 'quoting'`).bind(offer.id).run()
    return c.json({ offerId: offer.id, status: 'quote_failed' }, 409)
  }
  let vehicleBenchmark: VehicleFareBenchmark
  try {
    vehicleBenchmark = {
      amountUgx: offer.benchmark_amount_ugx,
      currency: 'UGX',
      basis: JSON.parse(offer.benchmark_basis_json) as VehicleFareBenchmark['basis'],
      derivationVersion: offer.benchmark_derivation_version,
    }
  } catch {
    vehicleBenchmark = null as unknown as VehicleFareBenchmark
  }
  if (!validateVehicleFareBenchmark(vehicleBenchmark)) {
    await c.env.DB.prepare(`UPDATE driver_trip_offers SET status = 'quote_failed' WHERE id = ? AND status = 'quoting'`).bind(offer.id).run()
    return c.json({ offerId: offer.id, status: 'quote_failed' }, 409)
  }
  const [outboundRoute, returnRoute] = await Promise.all([
    computeDrivingRoute(c.env, originInput, destinationInput),
    computeDrivingRoute(c.env, destinationInput, originInput),
  ])
  if (outboundRoute.kind !== 'ok' || returnRoute.kind !== 'ok') {
    await c.env.DB.prepare(`UPDATE driver_trip_offers SET status = 'quote_failed' WHERE id = ? AND status = 'quoting'`).bind(offer.id).run()
    const routeFailure = outboundRoute.kind !== 'ok' ? outboundRoute : returnRoute
    return c.json({ offerId: offer.id, status: 'quote_failed' }, routeFailure.kind === 'provider_error' ? 503 : 422)
  }
  const vehicleQuoteSnapshot = buildVehicleQuoteSnapshot(
    farePolicy, outboundRoute, returnRoute, daysBetween(offer.start_date, offer.end_date),
    offer.party_size, offer.driver_lodging_rate_ugx, vehicleBenchmark,
    { vehicleId: offer.vehicle_id, driverApplicationId: offer.driver_application_id },
  )
  if (!vehicleQuoteSnapshot) {
    await c.env.DB.prepare(`UPDATE driver_trip_offers SET status = 'quote_failed' WHERE id = ? AND status = 'quoting'`).bind(offer.id).run()
    return c.json({ offerId: offer.id, status: 'quote_failed' }, 409)
  }

  const quoteId = crypto.randomUUID()
  const createdAt = Date.now()
  const expiresAt = createdAt + farePolicy.quote_ttl_seconds * 1000
  const committedAt = Date.now()
  const commit = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO trip_quotes
      (id, client_user_id, vehicle_id, policy_id, origin_json, destination_json,
       start_date, end_date, party_size, luggage_count, route_distance_meters,
       route_duration_seconds, quote_json, expires_at, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM driver_trip_offers
          WHERE id = ? AND status = 'quoting' AND expires_at > ?
       )`,
    ).bind(
      quoteId, offer.client_user_id, offer.vehicle_id, farePolicy.id, offer.origin_json, offer.destination_json,
      offer.start_date, offer.end_date, offer.party_size, offer.luggage_count, outboundRoute.distanceMeters,
      outboundRoute.durationSeconds, JSON.stringify(vehicleQuoteSnapshot), expiresAt, createdAt, offer.id, committedAt,
    ),
    c.env.DB.prepare(
      `UPDATE driver_trip_offers SET status = 'quoted', quote_id = ?
        WHERE id = ? AND status = 'quoting' AND expires_at > ?`,
    ).bind(quoteId, offer.id, committedAt),
    ...notificationStatements(c.env.DB, {
      id: `booking.quote_status_changed:${offer.id}:${quoteId}`,
      eventType: 'booking.quote_status_changed',
      eventVersion: 1,
      domainType: 'trip_offer',
      domainId: offer.id,
      occurredAt: committedAt,
      expiresAt,
      recipients: [{ userId: offer.client_user_id, role: 'client' }],
    }, committedAt),
  ])
  if (commit[0]?.meta.changes !== 1 || commit[1]?.meta.changes !== 1) {
    await c.env.DB.prepare(
      `UPDATE driver_trip_offers SET status = 'quote_failed'
        WHERE id = ? AND status = 'quoting' AND expires_at <= ?`,
    ).bind(offer.id, committedAt).run()
    return c.json({ offerId: offer.id, status: 'quote_failed' }, 409)
  }

  return c.json({
    offerId: offer.id, status: 'quoted', quoteId, vehicleId: offer.vehicle_id,
    pickup: originSnapshot, destination: destinationSnapshot,
    route: { distanceMeters: outboundRoute.distanceMeters, durationSeconds: outboundRoute.durationSeconds, provider: 'google_maps' },
    returnRoute: { distanceMeters: returnRoute.distanceMeters, durationSeconds: returnRoute.durationSeconds, provider: 'google_maps' },
    quote: vehicleQuoteSnapshot, expiresAt,
  })
})

tripsApp.post('/confirm', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)

  const body: unknown = await c.req.json().catch(() => null)
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return c.json(apiError('INVALID_CONFIRMATION', 'Review the quote and required disclosures before confirming.'), 400)
  }
  const input = body as Record<string, unknown>
  if (
    typeof input.quoteId !== 'string' || input.quoteId.length > 80 ||
    input.accepted !== true || input.contactSharingConsent !== true ||
    !Array.isArray(input.acceptedDisclosureIds) || input.acceptedDisclosureIds.length !== 6 ||
    input.acceptedDisclosureIds.some((id) => typeof id !== 'string' || id.length > 80)
  ) {
    return c.json(apiError('CONFIRMATION_REQUIRED', 'Accept each current booking disclosure and separately allow your phone number to be shared with the assigned driver.'), 400)
  }

  const quote = await c.env.DB.prepare(
    `SELECT quote.id, quote.vehicle_id, quote.policy_id, quote.origin_json, quote.destination_json, quote.start_date, quote.end_date,
            quote.party_size, quote.luggage_count, quote.route_distance_meters, quote.route_duration_seconds,
            quote.quote_json, quote.expires_at, availability.id AS availability_request_id,
            availability.status AS availability_status, availability.hold_expires_at AS availability_hold_expires_at
       FROM trip_quotes AS quote
       LEFT JOIN availability_requests AS availability ON availability.quote_id = quote.id
      WHERE quote.id = ? AND quote.client_user_id = ? LIMIT 1`,
  )
    .bind(input.quoteId, user.id)
    .first<{
      id: string
      vehicle_id: string
      policy_id: string
      origin_json: string
      destination_json: string
      start_date: string
      end_date: string
      party_size: number
      luggage_count: number
      route_distance_meters: number
      route_duration_seconds: number
      quote_json: string
      expires_at: number
      availability_request_id: string | null
      availability_status: string | null
      availability_hold_expires_at: number | null
    }>()
  if (!quote) return c.json(apiError('QUOTE_NOT_FOUND', 'This trip quote was not found.'), 404)

  const now = Date.now()
  if (quote.expires_at <= now) {
    return c.json(apiError('QUOTE_EXPIRED', 'This quote expired. Request a fresh quote before confirming.'), 409)
  }

  const staffAvailabilityConfirmed = quote.availability_request_id !== null && quote.availability_status === 'confirmed' &&
    quote.availability_hold_expires_at !== null && quote.availability_hold_expires_at > now
  if (quote.availability_request_id && !staffAvailabilityConfirmed) {
    return c.json(apiError('QUOTE_EXPIRED', 'The staff-confirmed availability hold expired. Ask Fave to check availability again.'), 409)
  }
  const currentPolicy = await getActiveFarePolicy(c.env)
  if (!currentPolicy || (!staffAvailabilityConfirmed && currentPolicy.id !== quote.policy_id)) {
    return c.json(apiError('QUOTE_CHANGED', 'The fare policy changed. Review a new quote before confirming.'), 409)
  }

  let origin: ReturnType<typeof parseLocationInput>
  let destination: ReturnType<typeof parseLocationInput>
  let storedOrigin: unknown
  let storedDestination: unknown
  let previousQuote: QuoteSnapshot
  try {
    storedOrigin = JSON.parse(quote.origin_json)
    storedDestination = JSON.parse(quote.destination_json)
    origin = parseStoredLocationInput(storedOrigin)
    destination = parseStoredLocationInput(storedDestination)
    previousQuote = JSON.parse(quote.quote_json) as QuoteSnapshot
  } catch {
    return c.json(apiError('QUOTE_INVALID', 'This quote could not be verified. Request a new one.'), 409)
  }
  if (!origin || !destination) {
    return c.json(apiError('QUOTE_INVALID', 'This quote could not be verified. Request a new one.'), 409)
  }

  let originSnapshot: TripLocationSnapshot
  let destinationSnapshot: TripLocationSnapshot
  if (staffAvailabilityConfirmed) {
    if (typeof storedOrigin !== 'object' || storedOrigin === null || typeof storedDestination !== 'object' || storedDestination === null) {
      return c.json(apiError('QUOTE_INVALID', 'This saved estimate could not be verified.'), 409)
    }
    originSnapshot = storedOrigin as TripLocationSnapshot
    destinationSnapshot = storedDestination as TripLocationSnapshot
  } else {
    const [pickup, destinationResult] = await Promise.all([
      classifyLocation(c.env, origin), classifyLocation(c.env, destination),
    ])
    if (pickup.kind === 'provider_error' || destinationResult.kind === 'provider_error') {
      return c.json(apiError('GOOGLE_MAPS_UNAVAILABLE', 'We could not recheck these trip locations right now.'), 503)
    }
    if (pickup.kind !== 'resolved' || pickup.countryCode !== 'UG' || !pickup.pickupArea) {
      return c.json(apiError('QUOTE_CHANGED', 'The pickup no longer meets the service area rules. Choose another address or map pin and request a fresh quote.'), 409)
    }
    if (destinationResult.kind !== 'resolved' || destinationResult.countryCode !== 'UG') {
      return c.json(apiError('QUOTE_CHANGED', 'The destination could not be verified in Uganda. Choose another address and request a fresh quote.'), 409)
    }
    originSnapshot = toTripLocationSnapshot(origin, pickup)
    destinationSnapshot = toTripLocationSnapshot(destination, destinationResult)
    if (!matchesStoredLocation(storedOrigin, originSnapshot) || !matchesStoredLocation(storedDestination, destinationSnapshot)) {
      return c.json(apiError('QUOTE_CHANGED', 'A trip location resolved differently. Request and review a fresh quote before confirming.'), 409)
    }
  }

  if (!previousQuote.vehicleFareBenchmark || !validateVehicleFareBenchmark(previousQuote.vehicleFareBenchmark)) {
    return c.json(apiError('QUOTE_INVALID', 'This quote is missing its vehicle fare calculation. Request a new one.'), 409)
  }
  if (previousQuote.vehicleId !== quote.vehicle_id || typeof previousQuote.driverApplicationId !== 'string' ||
      previousQuote.driverApplicationId.trim().length === 0) {
    return c.json(apiError('QUOTE_INVALID', 'This quote is missing its accepted driver or vehicle. Request a new one.'), 409)
  }
  if (typeof previousQuote.driverLodgingRate !== 'number' || !Number.isSafeInteger(previousQuote.driverLodgingRate)) {
    return c.json(apiError('QUOTE_INVALID', 'This quote is missing its driver lodging rate. Request a new one.'), 409)
  }
  if (!staffAvailabilityConfirmed) {
    const [currentRoute, currentReturnRoute] = await Promise.all([
      computeDrivingRoute(c.env, origin, destination), computeDrivingRoute(c.env, destination, origin),
    ])
    if (currentRoute.kind === 'provider_error' || currentReturnRoute.kind === 'provider_error') {
      return c.json(apiError('GOOGLE_MAPS_UNAVAILABLE', 'We could not recheck this trip route right now.'), 503)
    }
    if (currentRoute.kind === 'no_route' || currentReturnRoute.kind === 'no_route') {
      return c.json(apiError('QUOTE_CHANGED', 'The route is no longer available. Request a new quote.'), 409)
    }
    if (currentRoute.distanceMeters !== quote.route_distance_meters || currentRoute.durationSeconds !== quote.route_duration_seconds ||
        !previousQuote.returnRoute || currentReturnRoute.distanceMeters !== previousQuote.returnRoute.distanceMeters ||
        currentReturnRoute.durationSeconds !== previousQuote.returnRoute.durationSeconds) {
      return c.json(apiError('QUOTE_CHANGED', 'One of the route estimates changed. Request and review a new quote before confirming.'), 409)
    }
    const currentSnapshot = buildVehicleQuoteSnapshot(
      currentPolicy, currentRoute, currentReturnRoute, daysBetween(quote.start_date, quote.end_date),
      quote.party_size, previousQuote.driverLodgingRate, previousQuote.vehicleFareBenchmark,
      { vehicleId: previousQuote.vehicleId, driverApplicationId: previousQuote.driverApplicationId },
    )
    if (!currentSnapshot || JSON.stringify(currentSnapshot) !== JSON.stringify(previousQuote)) {
      return c.json(apiError('QUOTE_CHANGED', 'The fare changed. Review a new quote before confirming.'), 409)
    }
  }

  const [profile, currentDocuments] = await Promise.all([
    c.env.DB.prepare(
      `SELECT legal_name, phone_e164 FROM client_profiles WHERE user_id = ? LIMIT 1`,
    )
      .bind(user.id)
      .first<{ legal_name: string; phone_e164: string }>(),
    getCurrentPolicies(
      c.env,
      ['client_terms', 'client_privacy', 'booking_policy', 'payment_policy', 'cancellation_policy', 'safety_policy'],
      'en',
    ),
  ])
  if (!profile) {
    return c.json(apiError('CLIENT_PROFILE_REQUIRED', 'Complete your client details before booking.'), 409)
  }
  if (currentDocuments.length !== 6) {
    return c.json(apiError('BOOKING_TERMS_UNAVAILABLE', 'Current approved booking disclosures are not available.'), 409)
  }

  const suppliedIds = new Set(input.acceptedDisclosureIds as string[])
  const requiredIds = new Set(currentDocuments.map((document) => document.id))
  if (suppliedIds.size !== 6 || [...requiredIds].some((id) => !suppliedIds.has(id))) {
    return c.json(apiError('BOOKING_TERMS_CHANGED', 'Review and accept every current booking disclosure before confirming.'), 409)
  }

  const policiesSnapshot = currentDocuments.map((document) => ({
    id: document.id,
    type: document.document_type,
    version: document.version,
    language: document.language,
  }))
  const bookingId = crypto.randomUUID()
  const holdExpiresAt = now + currentPolicy.hold_ttl_seconds * 1000
  const bookingContext = `booking:${quote.id}`
  const acceptanceStatements = currentDocuments.map((document) =>
    c.env.DB.prepare(
      `INSERT INTO policy_acceptances (id, user_id, document_id, onboarding_context, accepted_at)
       SELECT ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM bookings WHERE id = ? AND quote_id = ?)
          AND EXISTS (
          SELECT 1 FROM policy_documents
           WHERE id = ? AND status = 'approved' AND effective_at <= ?
        )`,
    ).bind(crypto.randomUUID(), user.id, document.id, bookingContext, now, bookingId, quote.id, document.id, now),
  )

  const insertBooking = c.env.DB.prepare(
    `INSERT INTO bookings
      (id, client_user_id, vehicle_id, quote_id, origin_json, destination_json,
       start_date, end_date, party_size, luggage_count, quote_snapshot_json,
       terms_snapshot_json, status, hold_expires_at, contact_share_consented_at, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'deposit_pending', ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM trip_quotes
         WHERE id = ? AND client_user_id = ? AND vehicle_id = ? AND policy_id = ? AND expires_at > ?
      )
        AND (? = 0 OR EXISTS (
          SELECT 1 FROM availability_requests
           WHERE id = ? AND quote_id = ? AND client_user_id = ? AND status = 'confirmed' AND hold_expires_at > ?
        ))
        AND EXISTS (
          SELECT 1 FROM vehicles AS vehicle
          JOIN driver_applications AS driver ON driver.id = vehicle.driver_application_id
           WHERE vehicle.id = ? AND vehicle.driver_application_id = ?
             AND vehicle.status = 'approved' AND driver.status = 'approved'
             AND vehicle.passenger_capacity >= ? AND vehicle.luggage_capacity >= ?
             AND ${approvedVehicleEvidencePredicate('vehicle')}
        )
        AND NOT EXISTS (
          SELECT 1 FROM vehicle_unavailability
           WHERE vehicle_id = ? AND start_date < ? AND end_date > ?
        )
        AND NOT EXISTS (
          SELECT 1 FROM bookings AS active
           JOIN vehicles AS active_vehicle ON active_vehicle.id = active.vehicle_id
           WHERE (active.vehicle_id = ? OR active_vehicle.driver_application_id = ?)
             AND active.start_date < ? AND active.end_date > ?
             AND (active.status = 'confirmed' OR
                  (active.status = 'deposit_pending' AND active.hold_expires_at > ?))
        )
        AND NOT EXISTS (
          SELECT 1 FROM availability_requests AS active
           WHERE active.id != COALESCE(?, '')
             AND (active.vehicle_id = ? OR active.driver_application_id = ?)
             AND active.start_date < ? AND active.end_date > ?
             AND active.status = 'confirmed' AND active.hold_expires_at > ?
        )
        AND (SELECT COUNT(*) FROM policy_documents
              WHERE document_type IN ('client_terms', 'client_privacy', 'booking_policy',
                'payment_policy', 'cancellation_policy', 'safety_policy')
                AND language = 'en' AND status = 'approved'
                AND effective_at IS NOT NULL AND effective_at <= ?
                AND id IN (${currentDocuments.map(() => '?').join(', ')})) = 6`,
  ).bind(
    bookingId,
    user.id,
    quote.vehicle_id,
    quote.id,
    JSON.stringify(originSnapshot),
    JSON.stringify(destinationSnapshot),
    quote.start_date,
    quote.end_date,
    quote.party_size,
    quote.luggage_count,
    JSON.stringify(previousQuote),
    JSON.stringify(policiesSnapshot),
    holdExpiresAt,
    now,
    now,
    now,
    quote.id,
    user.id,
    quote.vehicle_id,
    quote.policy_id,
    now,
    staffAvailabilityConfirmed ? 1 : 0,
    quote.availability_request_id,
    quote.id,
    user.id,
    now,
    quote.vehicle_id,
    previousQuote.driverApplicationId,
    quote.party_size,
    quote.luggage_count,
    now,
    now,
    now,
    now,
    now,
    now,
    quote.vehicle_id,
    quote.end_date,
    quote.start_date,
    quote.vehicle_id,
    previousQuote.driverApplicationId,
    quote.end_date,
    quote.start_date,
    now,
    quote.availability_request_id,
    quote.vehicle_id,
    previousQuote.driverApplicationId,
    quote.end_date,
    quote.start_date,
    now,
    now,
    ...currentDocuments.map((document) => document.id),
  )
  const convertAvailabilityHold = staffAvailabilityConfirmed
    ? c.env.DB.prepare(
      `UPDATE availability_requests SET status = 'converted_to_booking', updated_at = ?
        WHERE id = ? AND quote_id = ? AND client_user_id = ? AND status = 'confirmed' AND hold_expires_at > ?
          AND EXISTS (SELECT 1 FROM bookings WHERE quote_id = ? AND status = 'deposit_pending')`,
    ).bind(now, quote.availability_request_id, quote.id, user.id, now, quote.id)
    : c.env.DB.prepare('SELECT 1')
  const snapshotQuoteTerms = c.env.DB.prepare(
    `UPDATE trip_quotes SET terms_snapshot_json = ?, contact_share_consented_at = ?
      WHERE id = ? AND client_user_id = ? AND terms_snapshot_json IS NULL
        AND EXISTS (SELECT 1 FROM bookings WHERE quote_id = ? AND client_user_id = ?)`,
  ).bind(JSON.stringify(policiesSnapshot), now, quote.id, user.id, quote.id, user.id)
  const insertContactConsent = c.env.DB.prepare(
    `INSERT INTO booking_contact_consents (id, booking_id, client_user_id, consented_at)
     SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM bookings WHERE id = ? AND status = 'deposit_pending')`,
  ).bind(crypto.randomUUID(), bookingId, user.id, now, bookingId)
  const insertAudit = c.env.DB.prepare(
    `INSERT INTO marketplace_audit_events
      (id, actor_user_id, action, target_type, target_id, reason, prior_state, new_state, created_at)
     SELECT ?, ?, 'booking_hold_created', 'booking', ?, 'Client accepted current disclosures and contact-sharing consent.', NULL, 'deposit_pending', ?
      WHERE EXISTS (SELECT 1 FROM bookings WHERE id = ? AND status = 'deposit_pending')`,
  ).bind(crypto.randomUUID(), user.id, bookingId, now, bookingId)
  const holdCreatedNotification = notificationStatements(c.env.DB, {
    id: `booking.hold_created:${bookingId}`,
    eventType: 'booking.hold_created',
    eventVersion: 1,
    domainType: 'booking',
    domainId: bookingId,
    occurredAt: now,
    expiresAt: holdExpiresAt,
    recipients: [{ userId: user.id, role: 'client' }],
  }, now)

  let result
  try {
    result = await c.env.DB.batch([
      insertBooking,
      convertAvailabilityHold,
      ...(staffAvailabilityConfirmed ? [availabilityAuditStatement(c.env, {
        requestId: quote.availability_request_id!, actorUserId: user.id,
        action: 'availability_converted_to_booking', priorState: 'confirmed', newState: 'converted_to_booking', now,
      })] : []),
      ...holdCreatedNotification,
      ...acceptanceStatements,
      snapshotQuoteTerms,
      insertContactConsent,
      insertAudit,
    ])
  } catch {
    return c.json(apiError('BOOKING_UNAVAILABLE', 'This quote was already used or the vehicle became unavailable. Refresh availability and request a new quote.'), 409)
  }
  const bookingResult = result[0]
  if ((bookingResult?.meta.changes ?? 0) !== 1) {
    return c.json(apiError('BOOKING_UNAVAILABLE', 'This vehicle, quote, or disclosure set changed. Refresh availability and review a new quote.'), 409)
  }
  if (staffAvailabilityConfirmed && (result[1]?.meta.changes ?? 0) !== 1) {
    return c.json(apiError('BOOKING_UNAVAILABLE', 'The staff-confirmed date hold is no longer active. Ask Fave to check availability again.'), 409)
  }

  return c.json({
    bookingId,
    status: 'deposit_pending',
    holdExpiresAt,
    vehicleId: quote.vehicle_id,
    pickup: originSnapshot,
    destination: destinationSnapshot,
    quote: previousQuote,
    message: 'This vehicle is held while the deposit is completed.',
  }, 201)
})

tripsApp.get('/mine', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)

  const bookings = await c.env.DB.prepare(
    `SELECT booking.id, booking.vehicle_id, booking.origin_json, booking.destination_json,
            booking.start_date, booking.end_date,
            booking.party_size, booking.luggage_count, booking.quote_snapshot_json,
            booking.status, booking.hold_expires_at, vehicle.make, vehicle.model,
            vehicle.model_year, vehicle.passenger_capacity, vehicle.luggage_capacity
       FROM bookings AS booking
       JOIN vehicles AS vehicle ON vehicle.id = booking.vehicle_id
      WHERE booking.client_user_id = ?
      ORDER BY booking.created_at DESC LIMIT 50`,
  )
    .bind(user.id)
    .all<{
      id: string
      vehicle_id: string
      origin_json: string
      destination_json: string
      start_date: string
      end_date: string
      party_size: number
      luggage_count: number
      quote_snapshot_json: string
      status: string
      hold_expires_at: number
      make: string
      model: string
      model_year: number
      passenger_capacity: number
      luggage_capacity: number
    }>()

  return c.json({
    bookings: bookings.results.map((booking) => ({
      bookingId: booking.id,
      status: booking.status === 'deposit_pending' && booking.hold_expires_at <= Date.now()
        ? 'expired'
        : booking.status,
      holdExpiresAt: booking.hold_expires_at,
      pickup: JSON.parse(booking.origin_json) as TripLocationSnapshot,
      destination: JSON.parse(booking.destination_json) as TripLocationSnapshot,
      startDate: booking.start_date,
      endDate: booking.end_date,
      partySize: booking.party_size,
      luggageCount: booking.luggage_count,
      vehicle: {
        id: booking.vehicle_id,
        make: booking.make,
        model: booking.model,
        year: booking.model_year,
        passengerCapacity: booking.passenger_capacity,
        luggageCapacity: booking.luggage_capacity,
      },
      quote: JSON.parse(booking.quote_snapshot_json) as QuoteSnapshot,
    })),
  })
})

tripsApp.get('/:bookingId', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)
  const booking = await c.env.DB.prepare(
    `SELECT booking.id, booking.vehicle_id, booking.origin_json, booking.destination_json,
            booking.start_date, booking.end_date,
            booking.party_size, booking.luggage_count, booking.quote_snapshot_json,
            booking.status, booking.hold_expires_at, vehicle.make, vehicle.model,
            vehicle.model_year, vehicle.passenger_capacity, vehicle.luggage_capacity
       FROM bookings AS booking
       JOIN vehicles AS vehicle ON vehicle.id = booking.vehicle_id
      WHERE booking.id = ? AND booking.client_user_id = ? LIMIT 1`,
  )
    .bind(c.req.param('bookingId'), user.id)
    .first<{
      id: string
      vehicle_id: string
      origin_json: string
      destination_json: string
      start_date: string
      end_date: string
      party_size: number
      luggage_count: number
      quote_snapshot_json: string
      status: string
      hold_expires_at: number
      make: string
      model: string
      model_year: number
      passenger_capacity: number
      luggage_capacity: number
    }>()
  if (!booking) return c.json(apiError('NOT_FOUND', 'Booking was not found.'), 404)

  return c.json({
    bookingId: booking.id,
    status: booking.status === 'deposit_pending' && booking.hold_expires_at <= Date.now()
      ? 'expired'
      : booking.status,
    holdExpiresAt: booking.hold_expires_at,
    pickup: JSON.parse(booking.origin_json) as TripLocationSnapshot,
    destination: JSON.parse(booking.destination_json) as TripLocationSnapshot,
    startDate: booking.start_date,
    endDate: booking.end_date,
    partySize: booking.party_size,
    luggageCount: booking.luggage_count,
    vehicle: {
      id: booking.vehicle_id,
      make: booking.make,
      model: booking.model,
      year: booking.model_year,
      passengerCapacity: booking.passenger_capacity,
      luggageCapacity: booking.luggage_capacity,
    },
    quote: JSON.parse(booking.quote_snapshot_json) as QuoteSnapshot,
  })
})

export default tripsApp

export async function expirePendingDriverTripOffers(
  env: AuthBindings,
  now = Date.now(),
  clientUserId?: string,
  offerId?: string,
  driverApplicationId?: string,
): Promise<number> {
  const filters = ["status = 'pending'", 'expires_at <= ?']
  const bindings: Array<string | number> = [now]
  if (clientUserId) { filters.push('client_user_id = ?'); bindings.push(clientUserId) }
  if (offerId) { filters.push('id = ?'); bindings.push(offerId) }
  if (driverApplicationId) { filters.push('driver_application_id = ?'); bindings.push(driverApplicationId) }
  const pending = await env.DB.prepare(
    `SELECT id, client_user_id FROM driver_trip_offers WHERE ${filters.join(' AND ')}
      ORDER BY expires_at ASC LIMIT 100`,
  ).bind(...bindings).all<{ id: string; client_user_id: string }>()

  let expired = 0
  for (const offer of pending.results) {
    const transitionedAt = Date.now()
    const result = await env.DB.batch([
      env.DB.prepare(
        `UPDATE driver_trip_offers SET status = 'expired'
          WHERE id = ? AND status = 'pending' AND expires_at <= ?`,
      ).bind(offer.id, transitionedAt),
      ...notificationStatements(env.DB, {
        id: `booking.driver_offer_expired:${offer.id}`,
        eventType: 'booking.driver_offer_expired',
        eventVersion: 1,
        domainType: 'trip_offer',
        domainId: offer.id,
        occurredAt: transitionedAt,
        recipients: [{ userId: offer.client_user_id, role: 'client' }],
      }, transitionedAt),
    ])
    if ((result[0]?.meta.changes ?? 0) === 1) expired += 1
  }
  return expired
}

export async function expireDepositPendingBookings(env: AuthBindings): Promise<number> {
  const now = Date.now()
  const pending = await env.DB.prepare(
    `SELECT id, client_user_id FROM bookings
      WHERE status = 'deposit_pending' AND hold_expires_at <= ?
      ORDER BY hold_expires_at ASC LIMIT 100`,
  )
    .bind(now)
    .all<{ id: string; client_user_id: string }>()

  let expired = 0
  for (const booking of pending.results) {
    const transitionedAt = Date.now()
    const result = await env.DB.batch([
      env.DB.prepare(
        `UPDATE bookings SET status = 'expired', updated_at = ?
          WHERE id = ? AND status = 'deposit_pending' AND hold_expires_at <= ?`,
      ).bind(transitionedAt, booking.id, transitionedAt),
      env.DB.prepare(
        `INSERT INTO marketplace_audit_events
          (id, actor_user_id, actor_type, action, target_type, target_id, reason,
           prior_state, new_state, created_at)
         SELECT ?, NULL, 'system', 'booking_hold_expired', 'booking', ?,
                'Deposit hold expired before confirmation.', 'deposit_pending', 'expired', ?
          WHERE changes() = 1`,
      ).bind(crypto.randomUUID(), booking.id, transitionedAt),
      ...notificationStatements(env.DB, {
        id: `booking.expired:${booking.id}`,
        eventType: 'booking.expired',
        eventVersion: 1,
        domainType: 'booking',
        domainId: booking.id,
        occurredAt: transitionedAt,
        recipients: [{ userId: booking.client_user_id, role: 'client' }],
      }, transitionedAt),
    ])
    if ((result[0]?.meta.changes ?? 0) === 1) expired += 1
  }

  return expired
}
