import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import { webcrypto } from 'node:crypto'
import vm from 'node:vm'
import ts from 'typescript'

const worker = resolve(fileURLToPath(new URL('../../fave-worker/', import.meta.url)))
const nodeRequire = createRequire(`${worker}/package.json`)
export const disclosureTypes = ['client_terms', 'client_privacy', 'booking_policy', 'payment_policy', 'cancellation_policy', 'safety_policy']
export const tripInput = {
  origin: { address: 'Private pickup, Kampala' }, destination: { address: 'Private destination, Jinja' },
  startDate: '2099-01-05', endDate: '2099-01-07', partySize: 2, luggageCount: 1, vehicleId: 'car-1',
}

// Execute production SQL against every production migration. Only the external
// identity provider, map provider, and wall clock are substituted.
export function availabilityFixture(t) {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys = ON')
  for (const name of readdirSync(`${worker}/migrations`).filter((name) => name.endsWith('.sql')).sort()) {
    sql.exec(readFileSync(`${worker}/migrations/${name}`, 'utf8'))
  }
  t.after(() => sql.close())
  const clock = { now: Date.parse('2099-01-01T09:00:00Z') }
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])) }
    static now() { return clock.now }
  }
  const DB = {
    async exec(query) { sql.exec(query) },
    prepare(query) {
      const statement = sql.prepare(query)
      return {
        args: [], query,
        bind(...args) {
          const expected = (query.match(/\?/gu) ?? []).length
          if (expected !== args.length) throw new Error(`Expected ${expected} SQL bindings, got ${args.length}: ${query}`)
          this.args = args; return this
        },
        async first(column) { const row = statement.get(...this.args) ?? null; return column && row ? row[column] : row },
        allSync() { const results = statement.all(...this.args); return { success: true, results, meta: { changes: sql.prepare('SELECT changes() AS count').get().count } } },
        async all() { return this.allSync() },
        runSync() { return { success: true, meta: { changes: Number(statement.run(...this.args).changes) } } },
        async run() { return this.runSync() },
      }
    },
    async batch(statements) {
      sql.exec('BEGIN IMMEDIATE')
      try {
        const results = statements.map((statement) => statement.allSync())
        sql.exec('COMMIT')
        return results
      } catch (error) { sql.exec('ROLLBACK'); throw error }
    },
  }
  const insert = (table, row) => sql.prepare(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row))
  for (const id of ['client-1', 'client-2', 'staff', 'driver']) {
    insert('user', { id, name: id, email: `${id}@example.test`, emailVerified: 1, createdAt: 1, updatedAt: 1 })
    insert('session', { id: `${id}-session`, userId: id, token: `${id}-test-token`, expiresAt: clock.now + 365 * 86400000, createdAt: clock.now, updatedAt: clock.now })
    insert('client_profiles', { user_id: id, legal_name: id, phone_e164: '+256700000000', created_at: 1, updated_at: 1 })
  }
  insert('admin_memberships', { user_id: 'staff', active: 1, granted_at: 1 })
  for (const document_type of [...disclosureTypes, 'driver_terms', 'driver_privacy']) {
    insert('policy_documents', { id: document_type, document_type, version: 'v1', language: 'en', body: 'Test disclosure', status: 'approved', effective_at: 1, created_at: 1 })
    if (document_type.startsWith('driver_')) insert('policy_acceptances', { id: `${document_type}-acceptance`, user_id: 'driver', document_id: document_type, onboarding_context: 'driver_onboarding', accepted_at: 1 })
  }
  const retentionExpiry = clock.now + 365 * 86400000
  insert('retention_policies', { id: 'retention', record_type: 'driver_application', version: 'v1', retention_days: 365, active: 1, approved_at: 1 })
  insert('driver_applications', { id: 'driver-app', user_id: 'driver', legal_name: 'Driver', phone_e164: '+256700000001', national_id_number: 'TEST-ONLY-ID', national_id_last4: '0001', status: 'approved', created_at: 1, updated_at: 1, lodging_rate_ugx: 42000, citizenship_attested_at: 1, retention_expires_at: retentionExpiry })
  for (const document_type of ['national_id_front', 'national_id_back', 'passport_photo']) {
    insert('driver_verification_requirements', { id: document_type, document_type, version: 'v1', required: 1, active: 1, approved_at: 1 })
    insert('driver_application_documents', { id: document_type, application_id: 'driver-app', document_type, object_key: document_type, content_type: 'image/jpeg', byte_size: 1, review_status: 'approved', created_at: 1, requirement_version: 'v1', retention_expires_at: retentionExpiry })
  }
  insert('vehicle_verification_requirements', { id: 'registration', evidence_type: 'registration_document', version: 'v1', required: 1, active: 1, approved_at: 1 })
  const basis = {
    routeId: 'kampala-jinja', routeVersion: 'approved-1',
    origin: { label: 'Kampala', latitude: 0.3476, longitude: 32.5825 },
    destination: { label: 'Jinja', latitude: 0.4479, longitude: 33.2026 },
    roundTripDistanceMeters: 160000, rounding: 'ceiling_per_leg',
  }
  for (const id of ['car-1', 'car-2']) {
    insert('vehicles', { id, driver_application_id: 'driver-app', make: 'Toyota', model: id, model_year: 2022, passenger_capacity: 4, luggage_capacity: 3, comfort_details: 'Comfortable', registration_number: id, status: 'approved', created_at: 1, updated_at: 1, benchmark_amount_ugx: 400000, benchmark_basis_json: JSON.stringify(basis), benchmark_derivation_version: 1 })
    for (const media_kind of ['registration_document', 'client_photo', 'client_photo']) {
      const mediaId = webcrypto.randomUUID()
      insert('vehicle_media', { id: mediaId, vehicle_id: id, media_kind, object_key: mediaId, content_type: 'image/jpeg', byte_size: 1, review_status: 'approved', requirement_version: 'v1', retention_expires_at: retentionExpiry, created_at: 1 })
    }
  }
  insert('fare_policies', { id: 'fare-v1', version: 'v1', currency: 'UGX', active: 1, approved_at: 1, effective_at: 1, quote_ttl_seconds: 3600, hold_ttl_seconds: 1800, rules_json: JSON.stringify({ components: [{ key: 'driver_lodging', label: 'Driver accommodation', amount: 1, unit: 'per_night' }], depositBasisPoints: 5000 }) })
  const cache = new Map()
  const maps = {
    parseLocationInput: (value) => value && typeof value === 'object' && (typeof value.address === 'string' && value.address.trim() || Number.isFinite(value.latitude) && Number.isFinite(value.longitude)) ? value : null,
    classifyLocation: async (_env, input) => ({ kind: 'resolved', countryCode: 'UG', pickupArea: 'Kampala', broadArea: 'Kampala', formattedAddress: input.address ?? 'Pinned pickup', latitude: 0.3, longitude: 32.5 }),
    computeDrivingRoute: async () => ({ kind: 'route', distanceMeters: 80000, durationSeconds: 7200 }),
  }
  function load(path) {
    if (path === `${worker}/src/auth.ts`) return { createAuth: () => ({ api: { getSession: async ({ headers }) => {
      const user = sql.prepare('SELECT id, name, email FROM user WHERE id = ?').get(headers.get('x-test-user') ?? '')
      const session = user ? sql.prepare('SELECT * FROM session WHERE userId = ?').get(user.id) : null
      return user && session && session.expiresAt > clock.now ? { user, session } : null
    } } }) }
    if (path === `${worker}/src/google-maps.ts`) return maps
    if (cache.has(path)) return cache.get(path).exports
    const module = { exports: {} }
    cache.set(path, module)
    const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
    vm.runInNewContext(code, {
      module, exports: module.exports, console, crypto: webcrypto, Date: ClockDate, Number, String, Math, Intl, JSON, Promise,
      Request, Response, Headers, URL, File, FormData, TextEncoder, TextDecoder, Uint8Array, Buffer, setTimeout, clearTimeout,
      require: (name) => name.startsWith('.') ? load(resolve(dirname(path), `${name}.ts`)) : nodeRequire(name),
    }, { filename: path })
    return module.exports
  }
  const trips = load(`${worker}/src/bookings.ts`).default
  const admin = load(`${worker}/src/admin-availability-requests.ts`).default
  const vehicles = load(`${worker}/src/vehicles.ts`).vehiclesApp
  const adminVehicles = load(`${worker}/src/vehicles.ts`).adminVehiclesApp
  const adminDrivers = load(`${worker}/src/drivers.ts`).adminDriversApp
  async function request(app, method, path, { user = 'client-1', body, headers = {} } = {}) {
    const response = await app.request(`https://fave.test${path}`, {
      method, headers: { 'content-type': 'application/json', ...(user ? { 'x-test-user': user } : {}), origin: 'https://fave.test', ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }, { DB, BETTER_AUTH_URL: 'https://fave.test' })
    return { status: response.status, body: response.headers.get('content-type')?.includes('json') ? await response.json() : await response.text() }
  }
  const trip = (method, path, options) => request(trips, method, path, options)
  const staff = (method, path, options = {}) => request(admin, method, path, { user: 'staff', ...options })
  const vehicle = (method, path, options) => request(vehicles, method, path, options)
  const reviewDriver = (method, path, options = {}) => request(adminDrivers, method, path, { user: 'staff', ...options })
  const reviewVehicle = (method, path, options = {}) => request(adminVehicles, method, path, { user: 'staff', ...options })
  const reviewSecurity = (method, path, options = {}) => request(load(`${worker}/src/admin-review-security.ts`).default, method, path, { user: 'staff', ...options })
  async function estimateAndRequest(options = {}) {
    const estimate = await trip('POST', '/estimates', { ...options, body: { ...tripInput, ...options.body } })
    if (estimate.status !== 201) throw new Error(`Could not create fixture estimate: ${JSON.stringify(estimate)}`)
    const result = await trip('POST', `/estimates/${estimate.body.estimateId}/availability-request`, options)
    if (result.status !== 201) throw new Error(`Could not create fixture request: ${JSON.stringify(result)}`)
    return { estimate: estimate.body, request: result.body }
  }
  async function logCall(requestId, outcome = 'reached') { return staff('POST', `/${requestId}/calls`, { body: { outcome, note: 'Synthetic test call' } }) }
  function grantReview(user = 'staff', method = 'passkey') {
    insert('review_memberships', { user_id: user, active: 1, granted_at: 1 })
    if (method === 'passkey') insert('passkey', { id: `${user}-key`, userId: user, publicKey: 'synthetic', credentialID: `${user}-credential`, counter: 0, deviceType: 'multiDevice', backedUp: 1 })
    else {
      insert('twoFactor', { id: `${user}-key`, userId: user, secret: 'synthetic', backupCodes: 'synthetic', verified: 1 })
      sql.prepare('UPDATE user SET twoFactorEnabled=1 WHERE id=?').run(user)
    }
    insert('review_session_proofs', { session_id: `${user}-session`, source_session_id: `${user}-session`, user_id: user, origin: 'https://fave.test', method, credential_id: `${user}-key`, verified_at: clock.now, expires_at: clock.now + 600000 })
  }
  return { sql, DB, clock, maps, insert, trip, staff, vehicle, reviewDriver, estimateAndRequest, logCall, grantReview, reviewVehicle, reviewSecurity }

}
