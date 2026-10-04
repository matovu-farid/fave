import { Hono } from 'hono'
import type { AuthBindings } from './auth'
import {
  apiError,
  getSignedInUser,
  writeMarketplaceAudit,
} from './marketplace-auth'
import { computeDrivingRoute, classifyLocation, parseLocationInput } from './google-maps'
import { getCurrentPolicies, getVerifiedPhone } from './marketplace-policies'
import { approvedVehicleEvidencePredicate } from './vehicles'

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
  components: Array<{ key: string; label: string; amount: number }>
  totalAmount: number
  depositAmount: number
  depositBasisPoints: number
  farePolicyVersion: string
  distanceMeters: number
  durationSeconds: number
  nights: number
}

type TripLocationSnapshot = {
  input: { address: string } | { latitude: number; longitude: number }
  address: string
  formattedAddress: string | null
  latitude: number
  longitude: number
}

const tripsApp = new Hono<{ Bindings: AuthBindings }>()

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

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function daysBetween(startDate: string, endDate: string): number {
  return (Date.parse(`${endDate}T00:00:00.000Z`) - Date.parse(`${startDate}T00:00:00.000Z`)) / 86_400_000
}

function kampalaToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Kampala', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
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

function buildQuoteSnapshot(
  policy: FarePolicy,
  route: { distanceMeters: number; durationSeconds: number },
  nights: number,
  partySize: number,
): QuoteSnapshot | null {
  const rules = parseFareRules(policy)
  if (!rules || !/^[A-Z]{3}$/u.test(policy.currency)) return null

  const distanceKilometers = Math.ceil(route.distanceMeters / 1000)
  const components = rules.components.map((component) => ({
    key: component.key,
    label: component.label,
    amount: component.amount * (
      component.unit === 'fixed' ? 1 :
        component.unit === 'per_kilometer' ? distanceKilometers :
          component.unit === 'per_night' ? nights : partySize
    ),
  }))
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
  const startDate = input.startDate
  const endDate = input.endDate
  const partySize = input.partySize
  const luggageCount = input.luggageCount
  if (
    !origin || !destination || !isDate(startDate) || !isDate(endDate) || startDate < kampalaToday() || startDate >= endDate ||
    daysBetween(startDate, endDate) > 7 ||
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
    startDate,
    endDate,
    partySize: Number(partySize),
    luggageCount: Number(luggageCount),
  }
}

tripsApp.post('/quote', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)

  const body: unknown = await c.req.json().catch(() => null)
  const validation = await validateTripRequest(c.env, body)
  if (validation.kind !== 'valid') {
    const status = validation.kind === 'invalid' ? 400 : validation.kind === 'provider' ? 503 : 422
    return c.json(apiError(validation.kind.toUpperCase(), validation.message), status)
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return c.json(apiError('INVALID_TRIP', 'Enter a valid trip request.'), 400)
  }
  const vehicleId = (body as Record<string, unknown>).vehicleId
  if (typeof vehicleId !== 'string' || vehicleId.length > 80) {
    return c.json(apiError('VEHICLE_REQUIRED', 'Choose an approved vehicle to request a quote.'), 400)
  }

  const vehicle = await c.env.DB.prepare(
    `SELECT vehicle.id, vehicle.passenger_capacity, vehicle.luggage_capacity
      FROM vehicles AS vehicle
       JOIN driver_applications AS driver ON driver.id = vehicle.driver_application_id
      WHERE vehicle.id = ? AND vehicle.status = 'approved' AND driver.status = 'approved'
        AND ${approvedVehicleEvidencePredicate('vehicle')}
      LIMIT 1`,
  )
    .bind(vehicleId, Date.now(), Date.now(), Date.now(), Date.now(), Date.now(), Date.now())
    .first<{ id: string; passenger_capacity: number; luggage_capacity: number }>()
  if (!vehicle) return c.json(apiError('VEHICLE_UNAVAILABLE', 'This vehicle is not available for selection.'), 409)
  if (vehicle.passenger_capacity < validation.partySize || vehicle.luggage_capacity < validation.luggageCount) {
    return c.json(apiError('VEHICLE_CAPACITY', 'This vehicle does not have enough passenger or luggage capacity.'), 422)
  }

  const now = Date.now()
  const overlap = await c.env.DB.prepare(
    `SELECT 1 AS unavailable FROM vehicle_unavailability
      WHERE vehicle_id = ? AND start_date < ? AND end_date > ?
     UNION ALL
     SELECT 1 AS unavailable FROM bookings
      WHERE vehicle_id = ? AND start_date < ? AND end_date > ?
        AND (status = 'confirmed' OR (status = 'deposit_pending' AND hold_expires_at > ?))
     LIMIT 1`,
  )
    .bind(vehicleId, validation.endDate, validation.startDate,
      vehicleId, validation.endDate, validation.startDate, now)
    .first<{ unavailable: number }>()
  if (overlap) return c.json(apiError('VEHICLE_DATES_UNAVAILABLE', 'This vehicle already has a hold or booking for those dates.'), 409)

  const farePolicy = await getActiveFarePolicy(c.env)
  if (!farePolicy) {
    return c.json(apiError('FARE_POLICY_UNAVAILABLE', 'Trip quotes are unavailable until the approved fare policy is configured.'), 409)
  }

  const route = await computeDrivingRoute(c.env, validation.origin, validation.destination)
  if (route.kind === 'provider_error') {
    return c.json(apiError('GOOGLE_MAPS_UNAVAILABLE', 'We could not calculate this road route right now.'), 503)
  }
  if (route.kind === 'no_route') {
    return c.json(apiError('ROUTE_NOT_FOUND', 'Google Maps could not find a drivable route for these locations.'), 422)
  }

  const quoteSnapshot = buildQuoteSnapshot(
    farePolicy,
    route,
    daysBetween(validation.startDate, validation.endDate),
    validation.partySize,
  )
  if (!quoteSnapshot) {
    return c.json(apiError('FARE_POLICY_INVALID', 'The active fare policy is incomplete.'), 409)
  }

  const quoteId = crypto.randomUUID()
  const createdAt = Date.now()
  const expiresAt = createdAt + farePolicy.quote_ttl_seconds * 1000
  await c.env.DB.prepare(
    `INSERT INTO trip_quotes
      (id, client_user_id, vehicle_id, policy_id, origin_json, destination_json,
       start_date, end_date, party_size, luggage_count, route_distance_meters,
       route_duration_seconds, quote_json, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      quoteId,
      user.id,
      vehicleId,
      farePolicy.id,
      JSON.stringify(validation.originSnapshot),
      JSON.stringify(validation.destinationSnapshot),
      validation.startDate,
      validation.endDate,
      validation.partySize,
      validation.luggageCount,
      route.distanceMeters,
      route.durationSeconds,
      JSON.stringify(quoteSnapshot),
      expiresAt,
      createdAt,
    )
    .run()

  return c.json({
    quoteId,
    vehicleId,
    pickup: validation.originSnapshot,
    destination: validation.destinationSnapshot,
    route: {
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      provider: 'google_maps',
    },
    quote: quoteSnapshot,
    expiresAt,
  }, 201)
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
    `SELECT id, vehicle_id, policy_id, origin_json, destination_json, start_date, end_date,
            party_size, luggage_count, route_distance_meters, route_duration_seconds,
            quote_json, expires_at
       FROM trip_quotes WHERE id = ? AND client_user_id = ? LIMIT 1`,
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
    }>()
  if (!quote) return c.json(apiError('QUOTE_NOT_FOUND', 'This trip quote was not found.'), 404)

  const now = Date.now()
  if (quote.expires_at <= now) {
    return c.json(apiError('QUOTE_EXPIRED', 'This quote expired. Request a fresh quote before confirming.'), 409)
  }

  const currentPolicy = await getActiveFarePolicy(c.env)
  if (!currentPolicy || currentPolicy.id !== quote.policy_id) {
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

  const [pickup, destinationResult] = await Promise.all([
    classifyLocation(c.env, origin),
    classifyLocation(c.env, destination),
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
  const originSnapshot = toTripLocationSnapshot(origin, pickup)
  const destinationSnapshot = toTripLocationSnapshot(destination, destinationResult)
  if (!matchesStoredLocation(storedOrigin, originSnapshot) ||
      !matchesStoredLocation(storedDestination, destinationSnapshot)) {
    return c.json(apiError('QUOTE_CHANGED', 'A trip location resolved differently. Request and review a fresh quote before confirming.'), 409)
  }

  const currentRoute = await computeDrivingRoute(c.env, origin, destination)
  if (currentRoute.kind === 'provider_error') {
    return c.json(apiError('GOOGLE_MAPS_UNAVAILABLE', 'We could not recheck this trip route right now.'), 503)
  }
  if (currentRoute.kind === 'no_route') {
    return c.json(apiError('QUOTE_CHANGED', 'The route is no longer available. Request a new quote.'), 409)
  }
  if (
    currentRoute.distanceMeters !== quote.route_distance_meters ||
    currentRoute.durationSeconds !== quote.route_duration_seconds
  ) {
    return c.json(apiError('QUOTE_CHANGED', 'The route estimate changed. Request and review a new quote before confirming.'), 409)
  }

  const currentSnapshot = buildQuoteSnapshot(
    currentPolicy,
    currentRoute,
    daysBetween(quote.start_date, quote.end_date),
    quote.party_size,
  )
  if (!currentSnapshot || JSON.stringify(currentSnapshot) !== JSON.stringify(previousQuote)) {
    return c.json(apiError('QUOTE_CHANGED', 'The fare changed. Review a new quote before confirming.'), 409)
  }

  const [profile, phone, currentDocuments] = await Promise.all([
    c.env.DB.prepare(
      `SELECT legal_name, phone_e164 FROM client_profiles WHERE user_id = ? LIMIT 1`,
    )
      .bind(user.id)
      .first<{ legal_name: string; phone_e164: string }>(),
    getVerifiedPhone(c.env, user.id),
    getCurrentPolicies(
      c.env,
      ['client_terms', 'client_privacy', 'booking_policy', 'payment_policy', 'cancellation_policy', 'safety_policy'],
      'en',
    ),
  ])
  if (!profile || !phone || phone.phone_e164 !== profile.phone_e164) {
    return c.json(apiError('PHONE_NOT_VERIFIED', 'Complete client profile and verify control of the same phone number before booking.'), 409)
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
        AND EXISTS (
          SELECT 1 FROM vehicles AS vehicle
          JOIN driver_applications AS driver ON driver.id = vehicle.driver_application_id
           WHERE vehicle.id = ? AND vehicle.status = 'approved' AND driver.status = 'approved'
             AND vehicle.passenger_capacity >= ? AND vehicle.luggage_capacity >= ?
             AND ${approvedVehicleEvidencePredicate('vehicle')}
        )
        AND NOT EXISTS (
          SELECT 1 FROM vehicle_unavailability
           WHERE vehicle_id = ? AND start_date < ? AND end_date > ?
        )
        AND NOT EXISTS (
          SELECT 1 FROM bookings AS active
           WHERE active.vehicle_id = ? AND active.start_date < ? AND active.end_date > ?
             AND (active.status = 'confirmed' OR
                  (active.status = 'deposit_pending' AND active.hold_expires_at > ?))
        )
        AND EXISTS (
          SELECT 1 FROM client_profiles AS profile
          JOIN phone_verifications AS phone ON phone.user_id = profile.user_id
           WHERE profile.user_id = ? AND profile.phone_e164 = phone.phone_e164
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
    quote.id,
    user.id,
    quote.vehicle_id,
    currentPolicy.id,
    now,
    quote.vehicle_id,
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
    quote.end_date,
    quote.start_date,
    now,
    user.id,
    now,
    ...currentDocuments.map((document) => document.id),
  )
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

  let result
  try {
    result = await c.env.DB.batch([
      insertBooking,
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

export async function expireDepositPendingBookings(env: AuthBindings): Promise<number> {
  const now = Date.now()
  const pending = await env.DB.prepare(
    `SELECT id FROM bookings
      WHERE status = 'deposit_pending' AND hold_expires_at <= ?
      ORDER BY hold_expires_at ASC LIMIT 100`,
  )
    .bind(now)
    .all<{ id: string }>()

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
    ])
    if ((result[0]?.meta.changes ?? 0) === 1) expired += 1
  }

  return expired
}
