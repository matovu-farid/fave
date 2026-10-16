import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import ts from 'typescript'
import * as vehicleFares from '../fave-worker/src/vehicle-fares.ts'

const bookingsSource = fileURLToPath(new URL('../fave-worker/src/bookings.ts', import.meta.url))
const testVehicleBenchmark = {
  amountUgx: 400_000,
  currency: 'UGX',
  derivationVersion: 1,
  basis: {
    routeId: 'kampala-jinja', routeVersion: 'approved-1',
    origin: { label: 'Kampala', latitude: 0.3476, longitude: 32.5825 },
    destination: { label: 'Jinja', latitude: 0.4479, longitude: 33.2026 },
    roundTripDistanceMeters: 160_000, rounding: 'ceiling_per_leg',
  },
}

function loadBookings({
  signedInUser = null,
  onRouteCalculation = () => undefined,
  routeResult = { kind: 'provider_error' },
  currentDocuments = [],
  notificationEvents = [],
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
        computeDrivingRoute: async (...args) => {
          onRouteCalculation(...args)
          return typeof routeResult === 'function' ? routeResult(...args) : routeResult
        },
        classifyLocation: async (_env, input) => ({
          kind: 'resolved', countryCode: 'UG', pickupArea: 'Kampala', broadArea: 'Kampala',
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
      // Legacy offer and pure fare tests use mocked D1. The new availability
      // lifecycle, including these helpers, is exercised against real SQLite.
      if (name === './availability-requests') return {
        expireAvailabilityRequests: async () => undefined,
        requestNeedsReviewPredicate: () => '0',
        requestReviewBindings: () => [],
        availabilityAuditStatement: (env) => env.DB.prepare('SELECT 1 /* availability audit */'),
      }
      if (name === './notification-store') return {
        buildNotificationEventStatements(_db, event) {
          notificationEvents.push(event)
          return [{ sql: 'SELECT 1 /* notification event */', args: [] }]
        },
      }
      if (name === './vehicle-fares') return vehicleFares
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

test('vehicle quotes itemize both route directions using the selected car benchmark, not global distance price', () => {
  const { buildVehicleQuoteSnapshot } = loadBookings()
  const benchmark = {
    amountUgx: 400_000,
    currency: 'UGX',
    derivationVersion: 1,
    basis: {
      routeId: 'kampala-jinja', routeVersion: 'approved-1',
      origin: { label: 'Kampala', latitude: 0.3476, longitude: 32.5825 },
      destination: { label: 'Jinja', latitude: 0.4479, longitude: 33.2026 },
      roundTripDistanceMeters: 160_000, rounding: 'ceiling_per_leg',
    },
  }
  const snapshot = buildVehicleQuoteSnapshot({
    id: 'fare-v1', version: '1', currency: 'UGX', quote_ttl_seconds: 60, hold_ttl_seconds: 60,
    rules_json: JSON.stringify({ components: [
      { key: 'driver_lodging', label: 'Driver lodging', amount: 1, unit: 'per_night' },
      { key: 'distance', label: 'Old shared distance price', amount: 2_000, unit: 'per_kilometer' },
      { key: 'base', label: 'Base fee', amount: 10_000, unit: 'fixed' },
    ], depositBasisPoints: 5000 }),
  }, { distanceMeters: 80_000, durationSeconds: 7200 }, { distanceMeters: 84_000, durationSeconds: 7500 }, 2, 2, 42_000, benchmark, { vehicleId: 'vehicle-1', driverApplicationId: 'driver-app-1' })

  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.components)), [
    { key: 'driver_lodging', label: 'Driver lodging', unit: 'per_night', unitRate: 42_000, quantity: 2, amount: 84_000 },
    { key: 'base', label: 'Base fee', unit: 'fixed', unitRate: 10_000, quantity: 1, amount: 10_000 },
    { key: 'outbound_transport', label: 'Outbound transport', unit: 'per_kilometer', unitRate: 2500, quantity: 80, amount: 200_000 },
    { key: 'return_transport', label: 'Return transport', unit: 'per_kilometer', unitRate: 2500, quantity: 84, amount: 210_000 },
  ])
  assert.equal(snapshot.totalAmount, 504_000)
  assert.equal(snapshot.depositAmount, 252_000)
  assert.equal(snapshot.outboundRoute.distanceMeters, 80_000)
  assert.equal(snapshot.returnRoute.distanceMeters, 84_000)
  assert.equal(snapshot.vehicleFareBenchmark.amountUgx, 400_000)
  assert.equal(snapshot.components.some((component) => component.key === 'distance'), false)
})

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

test('trip estimate creation fails closed when no approved fare policy is active', async () => {
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
      return Object.assign(query, {
        bind(...args) { query.args = args; return query },
        async first() {
          if (sql.includes('FROM driver_trip_offers')) return null
          if (sql.includes('FROM vehicles AS vehicle')) {
            return {
              id: 'vehicle-1', passenger_capacity: 4, luggage_capacity: 3, driver_lodging_rate_ugx: 42_000,
              benchmark_amount_ugx: testVehicleBenchmark.amountUgx,
              benchmark_basis_json: JSON.stringify(testVehicleBenchmark.basis),
              benchmark_derivation_version: 1,
            }
          }
          if (sql.includes('FROM vehicle_unavailability')) return null
          if (sql.includes('FROM fare_policies')) return null
          throw new Error(`Unexpected query: ${sql}`)
        },
        async run() { throw new Error('No quote may be inserted without an active policy') },
      })
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

  const response = await routes.get('/estimates')(context)
  assert.equal(response.status, 409)
  assert.deepEqual(JSON.parse(JSON.stringify(response.payload)), {
    error: {
      code: 'FARE_POLICY_UNAVAILABLE',
      message: 'Trip estimates are unavailable until the approved fare policy is configured.',
    },
  })
  assert.equal(routeCalculationCount, 0, 'do not request a route until a valid fare policy is available')
  assert.equal(queries.some((query) => query.sql.includes('INSERT INTO trip_quotes')), false)
  for (const query of queries) {
    assert.equal(query.args.length, (query.sql.match(/\?/gu) ?? []).length, 'every SQL placeholder has exactly one binding')
  }
})

test('client estimate is priced before intent and saved without creating a driver offer', async () => {
  const route = { kind: 'route', distanceMeters: 80_000, durationSeconds: 7_200 }
  const farePolicy = {
    id: 'fare-v1', version: '1', currency: 'UGX',
    rules_json: JSON.stringify({ vehicleBenchmark: testVehicleBenchmark.basis, components: [
      { key: 'driver_lodging', label: 'Driver accommodation', amount: 1, unit: 'per_night' },
      { key: 'distance', label: 'Old shared distance price', amount: 1_500, unit: 'per_kilometer' },
    ], depositBasisPoints: 5_000 }), quote_ttl_seconds: 3600, hold_ttl_seconds: 1800,
  }
  const { routes } = loadBookings({
    signedInUser: { id: 'client-1', name: 'Client' }, routeResult: route,
  })
  const queries = []
  const DB = {
    prepare(sql) {
      const query = { sql, args: [] }; queries.push(query)
      return Object.assign(query, {
        bind(...args) { query.args = args; return this },
        async first() {
          if (sql.includes('FROM vehicles AS vehicle')) return {
            id: 'vehicle-1', driver_application_id: 'driver-app-1', passenger_capacity: 4, luggage_capacity: 3,
            driver_lodging_rate_ugx: 42_000, benchmark_amount_ugx: testVehicleBenchmark.amountUgx,
            benchmark_basis_json: JSON.stringify(testVehicleBenchmark.basis), benchmark_derivation_version: 1,
          }
          if (sql.includes('FROM fare_policies')) return farePolicy
          if (sql.includes('FROM vehicle_unavailability')) return null
          throw new Error(`Unexpected query: ${sql}`)
        },
        async run() { return { success: true, meta: { changes: 1 } } },
      })
    },
  }
  const body = { origin: { address: 'Kampala' }, destination: { address: 'Jinja' }, startDate: '2099-01-01', endDate: '2099-01-03', partySize: 2, luggageCount: 1, vehicleId: 'vehicle-1' }
  const context = {
    env: { DB }, req: { raw: new Request('https://fave.test/api/trips/estimates', { method: 'POST' }), json: async () => body },
    json: (payload, status = 200) => ({ payload, status }),
  }

  const response = await routes.get('/estimates')(context)

  assert.equal(response.status, 201)
  assert.equal(response.payload.quote.totalAmount, 484_000)
  assert.equal(response.payload.quote.outboundRoute.distanceMeters, 80_000)
  assert.equal(response.payload.quote.returnRoute.distanceMeters, 80_000)
  assert.equal(queries.some((query) => query.sql.includes('INSERT INTO trip_estimates')), true)
  const saveEstimate = queries.find((query) => query.sql.includes('INSERT INTO trip_estimates'))
  assert.match(saveEstimate.sql, /JOIN vehicles AS booked_vehicle ON booked_vehicle\.id = bookings\.vehicle_id/u)
  assert.equal(queries.some((query) => query.sql.includes('INSERT INTO driver_trip_offers')), false)
  assert.equal(queries.some((query) => query.sql.includes('booking.driver_offer_created')), false)
  for (const query of queries) assert.equal(query.args.length, (query.sql.match(/\?/gu) ?? []).length)
})

test('a client can withdraw their own pending driver offer without creating a quote', async () => {
  const { routes } = loadBookings({ signedInUser: { id: 'client-1', name: 'Client' } })
  const queries = []
  const DB = {
    prepare(sql) {
      const query = { sql, args: [] }
      queries.push(query)
      return Object.assign(query, {
        bind(...args) { query.args = args; return this },
        async first() { return { driverUserId: 'driver-1' } },
        async run() { return { success: true, meta: { changes: 1 } } },
      })
    },
    async batch(statements) {
      return statements.map(statement => ({ meta: { changes: statement.sql.includes('UPDATE driver_trip_offers') ? 1 : 0 } }))
    },
  }
  const context = {
    env: { DB },
    req: {
      raw: new Request('https://fave.test/api/trips/quote-requests/offer-1/withdraw', { method: 'POST' }),
      param: name => name === 'offerId' ? 'offer-1' : undefined,
    },
    json: (payload, status = 200) => ({ payload, status }),
  }

  const response = await routes.get('/quote-requests/:offerId/withdraw')(context)

  assert.equal(response.status, 200)
  assert.deepEqual(JSON.parse(JSON.stringify(response.payload)), { offerId: 'offer-1', status: 'withdrawn' })
  const update = queries.find(item => item.sql.includes('UPDATE driver_trip_offers'))
  assert.match(update.sql, /SET status = 'withdrawn'/u)
  assert.match(update.sql, /client_user_id = \?/u)
  assert.match(update.sql, /status = 'pending' AND expires_at > \?/u)
  assert.equal(update.args[1], 'offer-1')
  assert.equal(update.args[2], 'client-1')
  assert.equal(typeof update.args[0], 'number')
  assert.equal(update.args[3], update.args[0], 'the expiry guard uses the same request timestamp as the update')
})

test('withdrawing a handled or expired driver offer returns a conflict', async () => {
  const { routes } = loadBookings({ signedInUser: { id: 'client-1', name: 'Client' } })
  const DB = {
    prepare() {
      return { bind() { return this }, async first() { return { driverUserId: 'driver-1' } }, async run() { return { success: true, meta: { changes: 0 } } } }
    },
    async batch(statements) { return statements.map(() => ({ meta: { changes: 0 } })) },
  }
  const context = {
    env: { DB },
    req: {
      raw: new Request('https://fave.test/api/trips/quote-requests/offer-1/withdraw', { method: 'POST' }),
      param: name => name === 'offerId' ? 'offer-1' : undefined,
    },
    json: (payload, status = 200) => ({ payload, status }),
  }

  const response = await routes.get('/quote-requests/:offerId/withdraw')(context)

  assert.equal(response.status, 409)
  assert.equal(response.payload.error.code, 'TRIP_OFFER_NOT_PENDING')
})

test('an unauthenticated client cannot withdraw a driver offer', async () => {
  const { routes } = loadBookings()
  const response = await routes.get('/quote-requests/:offerId/withdraw')({
    env: { DB: { prepare() { throw new Error('must not query an unauthenticated request') } } },
    req: {
      raw: new Request('https://fave.test/api/trips/quote-requests/offer-1/withdraw', { method: 'POST' }),
      param: name => name === 'offerId' ? 'offer-1' : undefined,
    },
    json: (payload, status = 200) => ({ payload, status }),
  })

  assert.equal(response.status, 401)
  assert.equal(response.payload.error.code, 'UNAUTHORIZED')
})

test('driver acceptance creates the quote using that driver’s registered lodging rate', async () => {
  const farePolicy = {
    id: 'fare-v1', version: '1', currency: 'UGX',
    rules_json: JSON.stringify({
      components: [
        { key: 'driver_lodging', label: 'Driver accommodation', amount: 1, unit: 'per_night' },
        { key: 'distance', label: 'Route', amount: 1_000, unit: 'per_kilometer' },
      ],
      depositBasisPoints: 5_000,
    }),
    quote_ttl_seconds: 3600, hold_ttl_seconds: 1800,
  }
  const location = {
    input: { address: 'Kampala' }, address: 'Kampala', formattedAddress: 'Kampala, Uganda',
    latitude: 0.3, longitude: 32.5,
  }
  const offer = {
    id: 'offer-1', client_user_id: 'client-1', vehicle_id: 'vehicle-1',
    origin_json: JSON.stringify(location), destination_json: JSON.stringify({ ...location, input: { address: 'Jinja' }, address: 'Jinja' }),
    start_date: '2099-01-01', end_date: '2099-01-03', party_size: 2, luggage_count: 1,
    status: 'pending', expires_at: Date.now() + 60_000, driver_application_id: 'driver-app-1',
    driver_lodging_rate_ugx: 42_000, passenger_capacity: 4, luggage_capacity: 3,
    benchmark_amount_ugx: testVehicleBenchmark.amountUgx,
    benchmark_basis_json: JSON.stringify(testVehicleBenchmark.basis),
    benchmark_derivation_version: testVehicleBenchmark.derivationVersion,
  }
  let routeCalls = 0
  const { routes } = loadBookings({
    signedInUser: { id: 'driver-1', name: 'Driver' },
    routeResult: (_env, origin, destination) => ({
      kind: 'ok', distanceMeters: origin.address === 'Jinja' ? 11_000 : 10_200,
      durationSeconds: destination.address === 'Jinja' ? 7_200 : 7_500,
    }),
    onRouteCalculation: () => { routeCalls += 1 },
  })
  const queries = []
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE trip_quotes (
      id TEXT PRIMARY KEY, client_user_id TEXT, vehicle_id TEXT, policy_id TEXT,
      origin_json TEXT, destination_json TEXT, start_date TEXT, end_date TEXT,
      party_size INTEGER, luggage_count INTEGER, route_distance_meters INTEGER,
      route_duration_seconds INTEGER, quote_json TEXT, expires_at INTEGER, created_at INTEGER
    );
    CREATE TABLE driver_trip_offers (
      id TEXT PRIMARY KEY, status TEXT NOT NULL, expires_at INTEGER NOT NULL,
      quote_id TEXT UNIQUE REFERENCES trip_quotes(id), responded_at INTEGER,
      driver_application_id TEXT, start_date TEXT, end_date TEXT
    );
  `)
  sqlite.prepare('INSERT INTO driver_trip_offers (id, status, expires_at, driver_application_id, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?)')
    .run(offer.id, 'pending', offer.expires_at, offer.driver_application_id, offer.start_date, offer.end_date)
  const DB = {
    prepare(sql) {
      const query = { sql, args: [] }
      queries.push(query)
      const statement = Object.assign(query, {
        bind(...args) { query.args = args; return statement },
        async first() {
          if (sql.includes('FROM driver_trip_offers AS offer')) return offer
          if (sql.includes('FROM vehicle_unavailability')) return null
          if (sql.includes('FROM fare_policies')) return farePolicy
          throw new Error(`Unexpected query: ${sql}`)
        },
        async run() { return { success: true, meta: { changes: 1 } } },
      })
      return statement
    },
    async batch(statements) {
      return statements.map((statement) => ({
        meta: { changes: sqlite.prepare(statement.sql).run(...statement.args).changes },
      }))
    },
  }
  const context = {
    env: { DB },
    req: {
      raw: new Request('https://fave.test/api/trips/driver-offers/offer-1/respond', { method: 'POST' }),
      json: async () => ({ decision: 'accept' }),
      param: () => 'offer-1',
    },
    json: (payload, status = 200) => ({ payload, status }),
  }

  const response = await routes.get('/driver-offers/:offerId/respond')(context)

  assert.equal(response.status, 200)
  assert.equal(response.payload.status, 'quoted')
  assert.equal(response.payload.quote.driverLodgingRate, 42_000)
  assert.equal(response.payload.quote.components.find((component) => component.key === 'driver_lodging').amount, 84_000)
  assert.equal(sqlite.prepare('SELECT quote_id FROM driver_trip_offers WHERE id = ?').get(offer.id).quote_id, response.payload.quoteId)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM trip_quotes').get().count, 1)
  assert.equal(routeCalls, 2)
  assert.equal(response.payload.returnRoute.distanceMeters, 11_000)
  assert.equal(response.payload.quote.returnRoute.distanceMeters, 11_000)
  assert.equal(response.payload.quote.components.find((component) => component.key === 'return_transport').amount, 27_500)
  assert.equal(response.payload.quote.components.some((component) => component.key === 'distance'), false)
  assert.equal(queries.some((query) => query.sql.includes('INSERT INTO trip_quotes')), true)
  const claim = queries.find((query) => query.sql.includes("SET status = 'quoting'"))
  assert.ok(claim.args[1] > offer.expires_at, 'the quote-preparation deadline should start when the driver accepts')
  assert.match(claim.sql, /NOT EXISTS[\s\S]*driver_trip_offers/u,
    'acceptance must atomically reject another overlapping offer for the same driver')
  for (const query of queries) {
    assert.equal(query.args.length, (query.sql.match(/\?/gu) ?? []).length, 'every SQL placeholder has exactly one binding')
  }
  sqlite.close()
})

test('driver decline creates no quote and returns only the attached offer status', async () => {
  const offer = {
    id: 'offer-1', client_user_id: 'client-1', vehicle_id: 'vehicle-1',
    origin_json: '{}', destination_json: '{}', start_date: '2099-01-01', end_date: '2099-01-02',
    party_size: 1, luggage_count: 0, status: 'pending', expires_at: Date.now() + 60_000,
    driver_application_id: 'driver-app-1', driver_lodging_rate_ugx: 42_000,
    passenger_capacity: 4, luggage_capacity: 3,
  }
  let routeCalls = 0
  const notificationEvents = []
  const { routes } = loadBookings({
    signedInUser: { id: 'driver-1', name: 'Driver' },
    onRouteCalculation: () => { routeCalls += 1 },
    notificationEvents,
  })
  const queries = []
  const DB = {
    prepare(sql) {
      const query = { sql, args: [] }
      queries.push(query)
      return Object.assign(query, {
        bind(...args) { query.args = args; return this },
        async first() {
          if (sql.includes('FROM driver_trip_offers AS offer')) return offer
          throw new Error(`Unexpected query: ${sql}`)
        },
        async run() { return { success: true, meta: { changes: 1 } } },
      })
    },
    async batch(statements) {
      return statements.map(statement => ({ meta: { changes: statement.sql.includes('notification event') ? 0 : 1 } }))
    },
  }
  const response = await routes.get('/driver-offers/:offerId/respond')({
    env: { DB },
    req: {
      raw: new Request('https://fave.test/api/trips/driver-offers/offer-1/respond', { method: 'POST' }),
      json: async () => ({ decision: 'decline' }),
      param: () => 'offer-1',
    },
    json: (payload, status = 200) => ({ payload, status }),
  })

  assert.equal(response.status, 200)
  assert.equal(response.payload.status, 'declined')
  assert.equal(routeCalls, 0)
  assert.equal(queries.some((query) => query.sql.includes('INSERT INTO trip_quotes')), false)
  assert.equal(notificationEvents[0].eventType, 'booking.driver_offer_declined')
  assert.equal(notificationEvents[0].recipients[0].userId, 'client-1')
})

test('client current-offer recovery fails a quote preparation that was interrupted past its deadline', async () => {
  const offer = {
    id: 'offer-1', client_user_id: 'client-1', vehicle_id: 'vehicle-1',
    status: 'quoting', quote_id: null, expires_at: Date.now() - 1,
  }
  const { routes } = loadBookings({ signedInUser: { id: 'client-1', name: 'Client' } })
  const queries = []
  const DB = {
    prepare(sql) {
      const query = { sql, args: [] }
      queries.push(query)
      return Object.assign(query, {
        bind(...args) { query.args = args; return this },
        async all() { return { results: [] } },
        async first() {
          if (sql.includes('FROM driver_trip_offers')) return offer
          throw new Error(`Unexpected query: ${sql}`)
        },
        async run() {
          if (sql.includes("SET status = 'quote_failed'") && sql.includes("status = 'quoting'")) {
            offer.status = 'quote_failed'
          }
          return { success: true, meta: { changes: 1 } }
        },
      })
    },
  }

  const response = await routes.get('/quote-requests/current')({
    env: { DB },
    req: { raw: new Request('https://fave.test/api/trips/quote-requests/current') },
    json: (payload, status = 200) => ({ payload, status }),
  })

  assert.equal(response.payload.offer.status, 'quote_failed')
  assert.equal(queries.some((query) => query.sql.includes("status = 'quoting'")), true)
})

test('client offer polling recovers an interrupted quote preparation after its deadline', async () => {
  const offer = {
    id: 'offer-1', client_user_id: 'client-1', vehicle_id: 'vehicle-1',
    status: 'quoting', quote_id: null, expires_at: Date.now() - 1,
  }
  const { routes } = loadBookings({ signedInUser: { id: 'client-1', name: 'Client' } })
  const DB = {
    prepare(sql) {
      const query = { sql, args: [] }
      return Object.assign(query, {
        bind() { return this },
        async all() { return { results: [] } },
        async first() {
          if (sql.includes('FROM driver_trip_offers')) return offer
          throw new Error(`Unexpected query: ${sql}`)
        },
        async run() {
          if (sql.includes("SET status = 'quote_failed'") && sql.includes("status = 'quoting'")) {
            offer.status = 'quote_failed'
          }
          return { success: true, meta: { changes: 1 } }
        },
      })
    },
  }

  const response = await routes.get('/quote-requests/:offerId')({
    env: { DB },
    req: {
      raw: new Request('https://fave.test/api/trips/quote-requests/offer-1'),
      param: () => 'offer-1',
    },
    json: (payload, status = 200) => ({ payload, status }),
  })

  assert.equal(response.payload.status, 'quote_failed')
})

test('client current-offer response restores the saved trip and selected car details', async () => {
  const pickup = {
    input: { latitude: 0.3, longitude: 32.5 }, address: 'Kampala pin',
    formattedAddress: 'Kampala, Uganda', latitude: 0.3, longitude: 32.5,
  }
  const destination = {
    input: { address: 'Jinja' }, address: 'Jinja', formattedAddress: 'Jinja, Uganda', latitude: 0.4, longitude: 33.2,
  }
  const offer = {
    id: 'offer-1', vehicle_id: 'vehicle-1', status: 'pending', quote_id: null,
    expires_at: Date.now() + 60_000, origin_json: JSON.stringify(pickup),
    destination_json: JSON.stringify(destination), start_date: '2099-01-01', end_date: '2099-01-03',
    party_size: 2, luggage_count: 1, vehicle_make: 'Toyota', vehicle_model: 'Noah',
    vehicle_year: 2022, passenger_capacity: 6, luggage_capacity: 4,
  }
  const { routes } = loadBookings({ signedInUser: { id: 'client-1', name: 'Client' } })
  const DB = {
    prepare(sql) {
      const query = { sql, args: [] }
      return Object.assign(query, {
        bind() { return this },
        async all() { return { results: [] } },
        async first() {
          if (sql.includes('FROM driver_trip_offers AS offer')) return offer
          throw new Error(`Unexpected query: ${sql}`)
        },
        async run() { return { success: true, meta: { changes: 0 } } },
      })
    },
  }

  const response = await routes.get('/quote-requests/current')({
    env: { DB },
    req: { raw: new Request('https://fave.test/api/trips/quote-requests/current') },
    json: (payload, status = 200) => ({ payload, status }),
  })

  assert.deepEqual(JSON.parse(JSON.stringify(response.payload.offer.tripRequest)), {
    pickup, destination, startDate: '2099-01-01', endDate: '2099-01-03', partySize: 2, luggageCount: 1,
    vehicle: { id: 'vehicle-1', make: 'Toyota', model: 'Noah', year: 2022, passengerCapacity: 6, luggageCapacity: 4 },
  })
})

test('current offer does not restore a quote that already belongs to a booking', async () => {
  const offer = {
    id: 'offer-1', vehicle_id: 'vehicle-1', status: 'quoted', quote_id: 'quote-1',
    expires_at: Date.now() + 60_000, origin_json: '{}', destination_json: '{}',
    start_date: '2099-01-01', end_date: '2099-01-02', party_size: 1, luggage_count: 0,
    vehicle_make: 'Toyota', vehicle_model: 'Noah', vehicle_year: 2022,
    passenger_capacity: 4, luggage_capacity: 2,
  }
  const queries = []
  const { routes } = loadBookings({ signedInUser: { id: 'client-1', name: 'Client' } })
  const DB = {
    prepare(sql) {
      queries.push(sql)
      return {
        bind() { return this },
        async all() { return { results: [] } },
        async first() {
          if (sql.includes('FROM driver_trip_offers AS offer')) return offer
          if (sql.includes('FROM bookings WHERE quote_id')) return { id: 'booking-1' }
          throw new Error(`Unexpected query: ${sql}`)
        },
        async run() { return { success: true, meta: { changes: 0 } } },
      }
    },
  }

  const response = await routes.get('/quote-requests/current')({
    env: { DB },
    req: { raw: new Request('https://fave.test/api/trips/quote-requests/current') },
    json: (payload, status = 200) => ({ payload, status }),
  })

  assert.equal(response.payload.offer.status, 'booked')
  assert.equal(response.payload.offer.quote, undefined)
  assert.equal(queries.some((sql) => sql.includes('FROM trip_quotes')), false)
})

test('late route completion cannot save or return a quote after timeout recovery wins', async () => {
  const farePolicy = {
    id: 'fare-v1', version: '1', currency: 'UGX',
    rules_json: JSON.stringify({
      components: [{ key: 'base', label: 'Base fare', amount: 1000, unit: 'fixed' }],
      depositBasisPoints: 5000,
    }),
    quote_ttl_seconds: 3600, hold_ttl_seconds: 1800,
  }
  const location = { input: { address: 'Kampala' }, address: 'Kampala', formattedAddress: 'Kampala, Uganda', latitude: 0.3, longitude: 32.5 }
  const offer = {
    id: 'offer-1', client_user_id: 'client-1', vehicle_id: 'vehicle-1',
    origin_json: JSON.stringify(location), destination_json: JSON.stringify({ ...location, address: 'Jinja' }),
    start_date: '2099-01-01', end_date: '2099-01-03', party_size: 2, luggage_count: 1,
    status: 'pending', expires_at: Date.now() + 60_000, driver_application_id: 'driver-app-1',
    driver_lodging_rate_ugx: 42_000, passenger_capacity: 4, luggage_capacity: 3,
  }
  let quoteRows = 0
  const { routes } = loadBookings({
    signedInUser: { id: 'driver-1', name: 'Driver' },
    routeResult: { kind: 'ok', distanceMeters: 10_200, durationSeconds: 7200 },
    onRouteCalculation: () => { offer.status = 'quote_failed' },
  })
  const DB = {
    prepare(sql) {
      const query = { sql, args: [] }
      return Object.assign(query, {
        bind() { return this },
        async first() {
          if (sql.includes('FROM driver_trip_offers AS offer')) return offer
          if (sql.includes('FROM vehicle_unavailability')) return null
          if (sql.includes('FROM fare_policies')) return farePolicy
          throw new Error(`Unexpected query: ${sql}`)
        },
        async run() {
          if (sql.includes('INSERT INTO trip_quotes')) quoteRows += 1
          return { success: true, meta: { changes: sql.includes("SET status = 'quoting'") ? 1 : 0 } }
        },
      })
    },
    async batch(statements) {
      if (statements[0].sql.includes("SET status = 'quoting'")) {
        return [{ meta: { changes: 1 } }, { meta: { changes: 0 } }]
      }
      assert.equal(statements.length, 3)
      assert.match(statements[0].sql, /INSERT INTO trip_quotes[\s\S]*status = 'quoting'[\s\S]*expires_at > \?/u)
      assert.match(statements[1].sql, /UPDATE driver_trip_offers SET status = 'quoted'/u)
      assert.match(statements[2].sql, /notification event/u)
      return [{ meta: { changes: 0 } }, { meta: { changes: 0 } }, { meta: { changes: 0 } }]
    },
  }

  const response = await routes.get('/driver-offers/:offerId/respond')({
    env: { DB },
    req: {
      raw: new Request('https://fave.test/api/trips/driver-offers/offer-1/respond', { method: 'POST' }),
      json: async () => ({ decision: 'accept' }),
      param: () => 'offer-1',
    },
    json: (payload, status = 200) => ({ payload, status }),
  })

  assert.equal(response.status, 409)
  assert.notEqual(response.payload.status, 'quoted')
  assert.equal(quoteRows, 0, 'a stale route response must not leave an orphan quote')
})

test('trip estimate fails closed when the selected driver has no registered lodging rate', async () => {
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
          if (sql.includes('FROM fare_policies')) return null
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

  const response = await routes.get('/estimates')(context)

  assert.equal(response.status, 409)
  assert.equal(response.payload.error.code, 'DRIVER_LODGING_RATE_REQUIRED')
  assert.equal(routeCalls, 0)
})

test('booking confirmation fails closed when required approved disclosures are unavailable', async () => {
  const farePolicy = {
    id: 'policy-1', version: '1', currency: 'UGX',
    rules_json: JSON.stringify({
      components: [
        { key: 'base', label: 'Base fare', amount: 10_000, unit: 'fixed' },
        { key: 'driver_lodging', label: 'Driver lodging', amount: 1, unit: 'per_night' },
      ],
      depositBasisPoints: 5_000,
    }),
    quote_ttl_seconds: 3600,
    hold_ttl_seconds: 1800,
  }
  const route = { kind: 'route', distanceMeters: 10_000, durationSeconds: 3_000 }
  const quoteSnapshot = loadBookings().buildVehicleQuoteSnapshot(farePolicy, route, route, 2, 2, 10_000, testVehicleBenchmark, { vehicleId: 'vehicle-1', driverApplicationId: 'driver-app-1' })
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

test('staff-confirmed quote preserves its saved price and converts its date hold into the deposit hold', async () => {
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
  const quoteSnapshot = loadBookings().buildVehicleQuoteSnapshot(farePolicy, route, route, 2, 2, 42_000, testVehicleBenchmark, { vehicleId: 'vehicle-1', driverApplicationId: 'driver-app-1' })
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
    availability_request_id: 'request-1', availability_status: 'confirmed',
    availability_hold_expires_at: Date.now() + 60_000,
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
      queries.push(...statements.map((statement) => ({ sql: statement.sql, args: statement.args ?? [] })))
      return statements.map((_, index) => ({ meta: { changes: index < 2 ? 1 : 0 } }))
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
  const bookingInsert = queries.find((query) => query.sql.includes('INSERT INTO bookings'))
  const holdConversion = queries.find((query) => query.sql.includes("SET status = 'converted_to_booking'"))
  assert.ok(bookingInsert)
  assert.match(bookingInsert.sql, /active\.id != COALESCE\(\?, ''\)/u)
  assert.ok(holdConversion)
  assert.match(holdConversion.sql, /status = 'confirmed' AND hold_expires_at > \?/u)
  assert.equal(response.payload.quote.components.find((component) => component.key === 'driver_lodging').unitRate, 42_000)
  assert.equal(response.payload.quote.components.find((component) => component.key === 'driver_lodging').amount, 84_000)
  assert.equal(queries.some((query) => /lodging_rate_ugx/u.test(query.sql)), false, 'confirmation must use the accepted snapshot, not the driver profile rate')
})

test('nearest-UGX vehicle quotes round each line and deposit without repricing historical snapshots', () => {
  const { buildVehicleQuoteSnapshot } = loadBookings()
  const policy = {
    id: 'fare-nearest', version: 'nearest-v1', currency: 'UGX', quote_ttl_seconds: 86400, hold_ttl_seconds: 1800,
    rules_json: JSON.stringify({ components: [{ key: 'driver_lodging', label: 'Driver lodging', amount: 1, unit: 'per_night' }], depositBasisPoints: 3333 }),
  }
  const benchmark = { ...testVehicleBenchmark, amountUgx: 400001, basis: { ...testVehicleBenchmark.basis, rounding: 'nearest_per_leg' } }
  const route = { distanceMeters: 80001, durationSeconds: 7200 }
  const quote = buildVehicleQuoteSnapshot(policy, route, route, 1, 1, 42000, benchmark)
  assert.ok(quote)
  assert.equal(quote.components.find((item) => item.key === 'outbound_transport').amount, 200003)
  assert.equal(quote.totalAmount, 442006)
  assert.equal(quote.depositAmount, 147321)
  assert.equal(quote.vehicleFareBenchmark.basis.rounding, 'nearest_per_leg')
  const historical = buildVehicleQuoteSnapshot(policy, route, route, 1, 1, 42000, { ...benchmark, basis: { ...benchmark.basis, rounding: 'ceiling_per_leg' } })
  assert.equal(historical.totalAmount, 442008)
  assert.equal(historical.depositAmount, 147322)
  assert.equal(buildVehicleQuoteSnapshot({ ...policy, currency: 'USD' }, route, route, 1, 1, 42000, benchmark), null)
})

test('a UGX vehicle benchmark cannot produce a quote labeled with a different currency', () => {
  const { buildVehicleQuoteSnapshot } = loadBookings()
  const policy = { id: 'invalid-currency', version: 'v1', currency: 'USD', rules_json: JSON.stringify({ components: [{ key: 'driver_lodging', label: 'Driver lodging', amount: 1, unit: 'per_night' }], depositBasisPoints: 5000 }) }
  const route = { distanceMeters: 80000, durationSeconds: 7200 }
  assert.equal(buildVehicleQuoteSnapshot(policy, route, route, 1, 1, 42000, testVehicleBenchmark), null)
})

test('nearest-UGX pricing cannot open a checkout with a deposit rounded to zero', () => {
  const { buildVehicleQuoteSnapshot } = loadBookings()
  const policy = { id: 'tiny-fare', version: 'v1', currency: 'UGX', rules_json: JSON.stringify({ components: [{ key: 'driver_lodging', label: 'Driver lodging', amount: 1, unit: 'per_night' }], depositBasisPoints: 100 }) }
  const benchmark = { ...testVehicleBenchmark, amountUgx: 1, basis: { ...testVehicleBenchmark.basis, rounding: 'nearest_per_leg' } }
  const route = { distanceMeters: 160000, durationSeconds: 7200 }
  assert.equal(buildVehicleQuoteSnapshot(policy, route, route, 1, 1, 1, benchmark), null)
})
