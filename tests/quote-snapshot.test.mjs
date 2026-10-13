import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'
import ts from 'typescript'

const bookingsSource = fileURLToPath(new URL('../fave-worker/src/bookings.ts', import.meta.url))

function loadBookings({
  signedInUser = null,
  onRouteCalculation = () => undefined,
  routeResult = { kind: 'provider_error' },
  currentDocuments = [],
} = {}) {
  const exports = {}
  const routes = new Map()
  class CapturingHono {
    post(path, handler) { routes.set(path, handler); return this }
    get(path, handler) { routes.set(path, handler); return this }
  }
  const code = ts.transpileModule(readFileSync(bookingsSource, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText

  vm.runInNewContext(code, {
    exports,
    require: name => {
      if (name === 'hono') return { Hono: CapturingHono }
      if (name === './marketplace-auth') return {
        apiError: (apiErrorCode, message) => ({ error: { code: apiErrorCode, message } }),
        getSignedInUser: async () => signedInUser,
        writeMarketplaceAudit: async () => undefined,
      }
      if (name === './google-maps') return {
        computeDrivingRoute: async (...args) => { onRouteCalculation(...args); return routeResult },
        classifyLocation: async (_env, input) => ({
          kind: 'resolved', countryCode: 'UG', pickupArea: 'Kampala',
          formattedAddress: 'Kampala, Uganda', latitude: 0.3, longitude: 32.5,
          input,
        }),
        parseLocationInput: value => {
          if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            if (typeof value.address === 'string' && value.address.trim()) return { address: value.address.trim() }
            if (typeof value.latitude === 'number' && typeof value.longitude === 'number') return value
          }
          return null
        },
      }
      if (name === './marketplace-policies') return { getCurrentPolicies: async () => currentDocuments }
      if (name === './trip-dates') return {
        daysBetween: () => 2,
        parseTripDateRange: () => ({ startDate: '2099-01-01', endDate: '2099-01-03' }),
      }
      if (name === './vehicles') return { approvedVehicleEvidencePredicate: () => '? AND ? AND ? AND ? AND ? AND ?' }
      throw new Error(`Unexpected module: ${name}`)
    },
    JSON,
    Number,
    Math,
    Date,
    Promise,
    crypto: webcrypto,
  })

  return { ...exports, routes }
}

test('quote snapshots retain unit rates and quantities for later trip extensions', () => {
  const { buildQuoteSnapshot } = loadBookings()
  assert.equal(typeof buildQuoteSnapshot, 'function', 'quote snapshot builder is available for focused testing')

  const snapshot = buildQuoteSnapshot({
    id: 'fare-v1',
    version: '1',
    currency: 'UGX',
    rules_json: JSON.stringify({
      components: [
        { key: 'car', label: 'Car hire', amount: 100_000, unit: 'per_night' },
        { key: 'cleaning', label: 'Cleaning fee', amount: 25_000, unit: 'fixed' },
        { key: 'distance', label: 'Distance', amount: 1_500, unit: 'per_kilometer' },
        { key: 'passengers', label: 'Passengers', amount: 2_000, unit: 'per_passenger' },
      ],
      depositBasisPoints: 5_000,
    }),
  }, { distanceMeters: 10_200, durationSeconds: 7_200 }, 2, 3)

  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.components)), [
    { key: 'car', label: 'Car hire', unit: 'per_night', unitRate: 100_000, quantity: 2, amount: 200_000 },
    { key: 'cleaning', label: 'Cleaning fee', unit: 'fixed', unitRate: 25_000, quantity: 1, amount: 25_000 },
    { key: 'distance', label: 'Distance', unit: 'per_kilometer', unitRate: 1_500, quantity: 11, amount: 16_500 },
    { key: 'passengers', label: 'Passengers', unit: 'per_passenger', unitRate: 2_000, quantity: 3, amount: 6_000 },
  ])
  assert.equal(snapshot.totalAmount, 247_500)
  assert.equal(snapshot.depositAmount, 123_750)
})

test('quote snapshots use the selected driver lodging rate instead of a global nightly amount', () => {
  const { buildQuoteSnapshot } = loadBookings()
  const snapshot = buildQuoteSnapshot({
    id: 'fare-v1',
    version: '1',
    currency: 'UGX',
    rules_json: JSON.stringify({
      components: [
        { key: 'driver_lodging', label: 'Driver accommodation', amount: 1, unit: 'per_night' },
        { key: 'distance', label: 'Distance', amount: 1_500, unit: 'per_kilometer' },
      ],
      depositBasisPoints: 5_000,
    }),
  }, { distanceMeters: 10_200, durationSeconds: 7_200 }, 2, 3, 42_000)

  assert.equal(snapshot.components[0].unitRate, 42_000)
  assert.equal(snapshot.components[0].amount, 84_000)
  assert.equal(snapshot.totalAmount, 100_500)
  assert.equal(snapshot.driverLodgingRate, 42_000)
})

test('trip quote creation fails closed when no approved fare policy is active', async () => {
  let routeCalculationCount = 0
  const { routes } = loadBookings({
    signedInUser: { id: 'client-1', name: 'Client', email: 'client@example.test' },
    onRouteCalculation: () => { routeCalculationCount += 1 },
  })
  const queries = []
  const DB = {
    prepare(sql) {
      const query = { sql, args: [] }
      queries.push(query)
      return {
        bind(...args) { query.args = args; return this },
        async first() {
          if (sql.includes('FROM vehicles AS vehicle')) {
            return { id: 'vehicle-1', passenger_capacity: 4, luggage_capacity: 3, driver_lodging_rate_ugx: 42_000 }
          }
          if (sql.includes('FROM vehicle_unavailability')) return null
          if (sql.includes('FROM fare_policies')) return null
          throw new Error(`Unexpected query: ${sql}`)
        },
        async run() { throw new Error('No quote may be inserted without an active policy') },
      }
    },
  }
  const body = {
    origin: { address: 'Kampala' },
    destination: { address: 'Jinja' },
    startDate: '2099-01-01',
    endDate: '2099-01-03',
    partySize: 2,
    luggageCount: 1,
    vehicleId: 'vehicle-1',
  }
  const request = new Request('https://fave.test/api/trips/quote', { method: 'POST' })
  const context = {
    env: { DB },
    req: { raw: request, json: async () => body },
    json: (payload, status = 200) => ({ payload, status }),
  }

  const response = await routes.get('/quote')(context)
  assert.equal(response.status, 409)
  assert.deepEqual(JSON.parse(JSON.stringify(response.payload)), {
    error: {
      code: 'FARE_POLICY_UNAVAILABLE',
      message: 'Trip quotes are unavailable until the approved fare policy is configured.',
    },
  })
  assert.equal(routeCalculationCount, 0, 'do not request a route until a valid fare policy is available')
  assert.equal(queries.some((query) => query.sql.includes('INSERT INTO trip_quotes')), false)
  for (const query of queries) {
    assert.equal(query.args.length, (query.sql.match(/\?/gu) ?? []).length, 'every SQL placeholder has exactly one binding')
  }
})

test('trip quote uses the selected vehicle driver lodging rate', async () => {
  const route = { kind: 'route', distanceMeters: 10_200, durationSeconds: 7_200 }
  const farePolicy = {
    id: 'fare-v1', version: '1', currency: 'UGX',
    rules_json: JSON.stringify({
      components: [
        { key: 'driver_lodging', label: 'Driver accommodation', amount: 1, unit: 'per_night' },
        { key: 'distance', label: 'Distance', amount: 1_500, unit: 'per_kilometer' },
      ],
      depositBasisPoints: 5_000,
    }),
    quote_ttl_seconds: 3600,
    hold_ttl_seconds: 1800,
  }
  const { routes } = loadBookings({
    signedInUser: { id: 'client-1', name: 'Client', email: 'client@example.test' },
    routeResult: route,
  })
  const queries = []
  const DB = {
    prepare(sql) {
      const query = { sql, args: [] }
      queries.push(query)
      return {
        bind(...args) { query.args = args; return this },
        async first() {
          if (sql.includes('FROM vehicles AS vehicle')) {
            return { id: 'vehicle-1', passenger_capacity: 4, luggage_capacity: 3, driver_lodging_rate_ugx: 42_000 }
          }
          if (sql.includes('FROM vehicle_unavailability')) return null
          if (sql.includes('FROM fare_policies')) return farePolicy
          throw new Error(`Unexpected query: ${sql}`)
        },
        async run() { return { success: true } },
      }
    },
  }
  const body = {
    origin: { address: 'Kampala' }, destination: { address: 'Jinja' },
    startDate: '2099-01-01', endDate: '2099-01-03',
    partySize: 2, luggageCount: 1, vehicleId: 'vehicle-1',
  }
  const context = {
    env: { DB },
    req: { raw: new Request('https://fave.test/api/trips/quote', { method: 'POST' }), json: async () => body },
    json: (payload, status = 200) => ({ payload, status }),
  }

  const response = await routes.get('/quote')(context)

  assert.equal(response.status, 201)
  assert.equal(response.payload.quote.components.find((component) => component.key === 'driver_lodging').unitRate, 42_000)
  assert.equal(response.payload.quote.driverLodgingRate, 42_000)
  assert.equal(queries.some((query) => query.sql.includes('INSERT INTO trip_quotes')), true)
})

test('trip quote fails closed when the selected driver has no registered lodging rate', async () => {
  let routeCalls = 0
  const { routes } = loadBookings({
    signedInUser: { id: 'client-1', name: 'Client', email: 'client@example.test' },
    onRouteCalculation: () => { routeCalls += 1 },
  })
  const DB = {
    prepare(sql) {
      return {
        bind() { return this },
        async first() {
          if (sql.includes('FROM vehicles AS vehicle')) {
            return { id: 'vehicle-1', passenger_capacity: 4, luggage_capacity: 3, driver_lodging_rate_ugx: null }
          }
          throw new Error(`The route must stop before this query: ${sql}`)
        },
        async run() { throw new Error('A quote must not be saved without a driver lodging rate') },
      }
    },
  }
  const body = {
    origin: { address: 'Kampala' }, destination: { address: 'Jinja' },
    startDate: '2099-01-01', endDate: '2099-01-03',
    partySize: 2, luggageCount: 1, vehicleId: 'vehicle-1',
  }
  const context = {
    env: { DB },
    req: { raw: new Request('https://fave.test/api/trips/quote', { method: 'POST' }), json: async () => body },
    json: (payload, status = 200) => ({ payload, status }),
  }

  const response = await routes.get('/quote')(context)

  assert.equal(response.status, 409)
  assert.equal(response.payload.error.code, 'DRIVER_LODGING_RATE_REQUIRED')
  assert.equal(routeCalls, 0)
})

test('booking confirmation fails closed when required approved disclosures are unavailable', async () => {
  const farePolicy = {
    id: 'policy-1', version: '1', currency: 'UGX',
    rules_json: JSON.stringify({
      components: [{ key: 'base', label: 'Base fare', amount: 10_000, unit: 'fixed' }],
      depositBasisPoints: 5_000,
    }),
    quote_ttl_seconds: 3600,
    hold_ttl_seconds: 1800,
  }
  const route = { kind: 'route', distanceMeters: 10_000, durationSeconds: 3_000 }
  const quoteSnapshot = loadBookings().buildQuoteSnapshot(farePolicy, route, 2, 2)
  const location = {
    input: { address: 'Kampala' },
    address: 'Kampala',
    formattedAddress: 'Kampala, Uganda',
    latitude: 0.3,
    longitude: 32.5,
  }
  const quote = {
    id: 'quote-1', vehicle_id: 'vehicle-1', policy_id: 'policy-1',
    origin_json: JSON.stringify(location), destination_json: JSON.stringify(location),
    start_date: '2099-01-01', end_date: '2099-01-03',
    party_size: 2, luggage_count: 1,
    route_distance_meters: route.distanceMeters,
    route_duration_seconds: route.durationSeconds,
    quote_json: JSON.stringify(quoteSnapshot),
    expires_at: Date.now() + 60_000,
  }
  const { routes } = loadBookings({
    signedInUser: { id: 'client-1', name: 'Client', email: 'client@example.test' },
    routeResult: route,
    currentDocuments: [],
  })
  const queries = []
  const DB = {
    prepare(sql) {
      const query = { sql, args: [] }
      queries.push(query)
      return {
        bind(...args) { query.args = args; return this },
        async first() {
          if (sql.includes('FROM trip_quotes')) return quote
          if (sql.includes('FROM fare_policies')) return farePolicy
          if (sql.includes('FROM client_profiles')) return { legal_name: 'Client', phone_e164: '+256700000001' }
          throw new Error(`Unexpected query: ${sql}`)
        },
        async run() { throw new Error('A booking must not be inserted without current disclosures') },
      }
    },
  }
  const body = {
    quoteId: 'quote-1',
    accepted: true,
    contactSharingConsent: true,
    acceptedDisclosureIds: ['doc-1', 'doc-2', 'doc-3', 'doc-4', 'doc-5', 'doc-6'],
  }
  const request = new Request('https://fave.test/api/trips/confirm', { method: 'POST' })
  const context = {
    env: { DB },
    req: { raw: request, json: async () => body },
    json: (payload, status = 200) => ({ payload, status }),
  }

  const response = await routes.get('/confirm')(context)
  assert.equal(response.status, 409)
  assert.deepEqual(JSON.parse(JSON.stringify(response.payload)), {
    error: {
      code: 'BOOKING_TERMS_UNAVAILABLE',
      message: 'Current approved booking disclosures are not available.',
    },
  })
  assert.equal(queries.some((query) => query.sql.includes('INSERT INTO bookings')), false)
  assert.equal(queries.some((query) => query.sql.includes('INSERT INTO policy_acceptances')), false)
})

test('booking confirmation preserves the driver lodging rate captured in the quote', async () => {
  const farePolicy = {
    id: 'policy-1', version: '1', currency: 'UGX',
    rules_json: JSON.stringify({
      components: [
        { key: 'driver_lodging', label: 'Driver accommodation', amount: 1, unit: 'per_night' },
        { key: 'distance', label: 'Distance', amount: 1_500, unit: 'per_kilometer' },
      ],
      depositBasisPoints: 5_000,
    }),
    quote_ttl_seconds: 3600,
    hold_ttl_seconds: 1800,
  }
  const route = { kind: 'route', distanceMeters: 10_200, durationSeconds: 7_200 }
  const quoteSnapshot = loadBookings().buildQuoteSnapshot(farePolicy, route, 2, 2, 42_000)
  const location = {
    input: { address: 'Kampala' },
    address: 'Kampala',
    formattedAddress: 'Kampala, Uganda',
    latitude: 0.3,
    longitude: 32.5,
  }
  const quote = {
    id: 'quote-1', vehicle_id: 'vehicle-1', policy_id: 'policy-1',
    origin_json: JSON.stringify(location), destination_json: JSON.stringify(location),
    start_date: '2099-01-01', end_date: '2099-01-03',
    party_size: 2, luggage_count: 1,
    route_distance_meters: route.distanceMeters,
    route_duration_seconds: route.durationSeconds,
    quote_json: JSON.stringify(quoteSnapshot),
    expires_at: Date.now() + 60_000,
  }
  const currentDocuments = [
    'client_terms', 'client_privacy', 'booking_policy', 'payment_policy', 'cancellation_policy', 'safety_policy',
  ].map((document_type, index) => ({
    id: `doc-${index + 1}`, document_type, version: '1', language: 'en',
  }))
  const { routes } = loadBookings({
    signedInUser: { id: 'client-1', name: 'Client', email: 'client@example.test' },
    routeResult: route,
    currentDocuments,
  })
  const queries = []
  const DB = {
    prepare(sql) {
      const query = { sql, args: [] }
      queries.push(query)
      return {
        bind(...args) { query.args = args; return this },
        async first() {
          if (sql.includes('FROM trip_quotes')) return quote
          if (sql.includes('FROM fare_policies')) return farePolicy
          if (sql.includes('FROM client_profiles')) return { legal_name: 'Client', phone_e164: '+256700000001' }
          throw new Error(`Confirmation must not need mutable driver data: ${sql}`)
        },
      }
    },
    async batch(statements) {
      return statements.map((_, index) => ({ meta: { changes: index === 0 ? 1 : 0 } }))
    },
  }
  const body = {
    quoteId: 'quote-1',
    accepted: true,
    contactSharingConsent: true,
    acceptedDisclosureIds: currentDocuments.map((document) => document.id),
  }
  const context = {
    env: { DB },
    req: { raw: new Request('https://fave.test/api/trips/confirm', { method: 'POST' }), json: async () => body },
    json: (payload, status = 200) => ({ payload, status }),
  }

  const response = await routes.get('/confirm')(context)

  assert.equal(response.status, 201)
  assert.equal(response.payload.quote.driverLodgingRate, 42_000)
  assert.equal(response.payload.quote.components.find((component) => component.key === 'driver_lodging').unitRate, 42_000)
  assert.equal(response.payload.quote.components.find((component) => component.key === 'driver_lodging').amount, 84_000)
  assert.equal(queries.some((query) => /lodging_rate_ugx/u.test(query.sql)), false, 'confirmation must use the accepted snapshot, not the driver profile rate')
})
