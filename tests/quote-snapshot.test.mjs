import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
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
      return Object.assign(query, {
        bind(...args) { query.args = args; return query },
        async first() {
          if (sql.includes('FROM driver_trip_offers')) return null
          if (sql.includes('FROM vehicles AS vehicle')) {
            return { id: 'vehicle-1', passenger_capacity: 4, luggage_capacity: 3, driver_lodging_rate_ugx: 42_000 }
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

test('trip quote request waits for the selected driver before calculating a price', async () => {
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
  let routeCalls = 0
  const { routes } = loadBookings({
    signedInUser: { id: 'client-1', name: 'Client', email: 'client@example.test' },
    routeResult: route,
    onRouteCalculation: () => { routeCalls += 1 },
  })
  const queries = []
  const DB = {
    prepare(sql) {
      const query = { sql, args: [] }
      queries.push(query)
      return {
        bind(...args) { query.args = args; return this },
        async first() {
          if (sql.includes('FROM driver_trip_offers')) return null
          if (sql.includes('FROM vehicles AS vehicle')) {
            return { id: 'vehicle-1', passenger_capacity: 4, luggage_capacity: 3, driver_lodging_rate_ugx: 42_000 }
          }
          if (sql.includes('FROM vehicle_unavailability')) return null
          if (sql.includes('FROM fare_policies')) return farePolicy
          throw new Error(`Unexpected query: ${sql}`)
        },
        async run() { return { success: true, meta: { changes: 1 } } },
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

  assert.equal(response.status, 202)
  assert.equal(response.payload.status, 'pending_driver_acceptance')
  assert.equal(routeCalls, 0)
  assert.equal(queries.some((query) => query.sql.includes('INSERT INTO driver_trip_offers')), true)
  assert.match(queries.find((query) => query.sql.includes('INSERT INTO driver_trip_offers')).sql, /NOT EXISTS/u,
    'offer creation must recheck availability inside its atomic insert')
  assert.equal(queries.some((query) => query.sql.includes('INSERT INTO trip_quotes')), false)
})

test('a client can withdraw their own pending driver offer without creating a quote', async () => {
  const { routes } = loadBookings({ signedInUser: { id: 'client-1', name: 'Client' } })
  let query
  const DB = {
    prepare(sql) {
      query = { sql, args: [] }
      return {
        bind(...args) { query.args = args; return this },
        async run() { return { success: true, meta: { changes: 1 } } },
      }
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
  assert.match(query.sql, /SET status = 'withdrawn'/u)
  assert.match(query.sql, /client_user_id = \?/u)
  assert.match(query.sql, /status = 'pending' AND expires_at > \?/u)
  assert.equal(query.args[1], 'offer-1')
  assert.equal(query.args[2], 'client-1')
  assert.equal(typeof query.args[0], 'number')
  assert.equal(query.args[3], query.args[0], 'the expiry guard uses the same request timestamp as the update')
})

test('withdrawing a handled or expired driver offer returns a conflict', async () => {
  const { routes } = loadBookings({ signedInUser: { id: 'client-1', name: 'Client' } })
  const DB = {
    prepare() {
      return { bind() { return this }, async run() { return { success: true, meta: { changes: 0 } } } }
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

test('requesting a trip saves a private driver offer and does not return a quote before acceptance', async () => {
  let routeCalls = 0
  const { routes } = loadBookings({
    signedInUser: { id: 'client-1', name: 'Client', email: 'client@example.test' },
    onRouteCalculation: () => { routeCalls += 1 },
  })
  const queries = []
  const DB = {
    prepare(sql) {
      const query = { sql, args: [] }
      queries.push(query)
      return {
        bind(...args) { query.args = args; return this },
        async first() {
          if (sql.includes('FROM driver_trip_offers')) return null
          if (sql.includes('FROM vehicles AS vehicle')) {
            return {
              id: 'vehicle-1', driver_application_id: 'driver-app-1', driver_user_id: 'driver-1',
              passenger_capacity: 4, luggage_capacity: 3, driver_lodging_rate_ugx: 42_000,
            }
          }
          if (sql.includes('FROM vehicle_unavailability')) return null
          if (sql.includes('FROM fare_policies')) return {
            id: 'fare-v1', version: '1', currency: 'UGX',
            rules_json: JSON.stringify({ components: [{ key: 'driver_lodging', label: 'Lodging', amount: 1, unit: 'per_night' }], depositBasisPoints: 5000 }),
            quote_ttl_seconds: 3600, hold_ttl_seconds: 1800,
          }
          throw new Error(`Unexpected query: ${sql}`)
        },
        async run() { return { success: true, meta: { changes: 1 } } },
      }
    },
  }
  const body = {
    origin: { address: 'Kampala' }, destination: { address: 'Jinja' },
    startDate: '2099-01-01', endDate: '2099-01-03', partySize: 2,
    luggageCount: 1, vehicleId: 'vehicle-1',
  }
  const context = {
    env: { DB },
    req: { raw: new Request('https://fave.test/api/trips/quote', { method: 'POST' }), json: async () => body },
    json: (payload, status = 200) => ({ payload, status }),
  }
  const before = Date.now()

  const response = await routes.get('/quote')(context)

  const after = Date.now()
  assert.equal(response.status, 202)
  assert.equal(response.payload.status, 'pending_driver_acceptance')
  assert.equal(typeof response.payload.offerId, 'string')
  assert.ok(response.payload.expiresAt >= before + 15 * 60 * 1000)
  assert.ok(response.payload.expiresAt <= after + 15 * 60 * 1000)
  assert.equal(routeCalls, 0, 'do not calculate a client quote before driver acceptance')
  assert.equal(queries.some((query) => query.sql.includes('INSERT INTO driver_trip_offers')), true)
  assert.equal(queries.some((query) => query.sql.includes('INSERT INTO trip_quotes')), false)
  const offerInsert = queries.find((query) => query.sql.includes('INSERT INTO driver_trip_offers'))
  assert.doesNotMatch(offerInsert.sql, /phone|email|contact/iu, 'driver offers must not store client contact details')
  for (const query of queries) {
    assert.equal(query.args.length, (query.sql.match(/\?/gu) ?? []).length, 'every SQL placeholder has exactly one binding')
  }
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
    origin_json: JSON.stringify(location), destination_json: JSON.stringify({ ...location, address: 'Jinja' }),
    start_date: '2099-01-01', end_date: '2099-01-03', party_size: 2, luggage_count: 1,
    status: 'pending', expires_at: Date.now() + 60_000, driver_application_id: 'driver-app-1',
    driver_lodging_rate_ugx: 42_000, passenger_capacity: 4, luggage_capacity: 3,
  }
  let routeCalls = 0
  const { routes } = loadBookings({
    signedInUser: { id: 'driver-1', name: 'Driver' },
    routeResult: { kind: 'ok', distanceMeters: 10_200, durationSeconds: 7_200 },
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
      quote_id TEXT UNIQUE REFERENCES trip_quotes(id)
    );
  `)
  sqlite.prepare('INSERT INTO driver_trip_offers (id, status, expires_at) VALUES (?, ?, ?)')
    .run(offer.id, 'quoting', offer.expires_at)
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
  assert.equal(routeCalls, 1)
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
  const { routes } = loadBookings({
    signedInUser: { id: 'driver-1', name: 'Driver' },
    onRouteCalculation: () => { routeCalls += 1 },
  })
  const queries = []
  const DB = {
    prepare(sql) {
      const query = { sql, args: [] }
      queries.push(query)
      return {
        bind(...args) { query.args = args; return this },
        async first() {
          if (sql.includes('FROM driver_trip_offers AS offer')) return offer
          throw new Error(`Unexpected query: ${sql}`)
        },
        async run() { return { success: true, meta: { changes: 1 } } },
      }
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
      return {
        bind(...args) { query.args = args; return this },
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
      }
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
      return {
        bind() { return this },
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
      }
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
      return {
        bind() { return this },
        async first() {
          if (sql.includes('FROM driver_trip_offers AS offer')) return offer
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
      return {
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
      }
    },
    async batch(statements) {
      assert.equal(statements.length, 2)
      assert.match(statements[0].sql, /INSERT INTO trip_quotes[\s\S]*status = 'quoting'[\s\S]*expires_at > \?/u)
      assert.match(statements[1].sql, /UPDATE driver_trip_offers SET status = 'quoted'/u)
      return [{ meta: { changes: 0 } }, { meta: { changes: 0 } }]
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
