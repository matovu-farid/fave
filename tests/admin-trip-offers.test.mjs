import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import vm from 'node:vm'
import ts from 'typescript'

const sourcePath = fileURLToPath(new URL('../fave-worker/src/admin-trip-offers.ts', import.meta.url))
const offerMigrationPath = fileURLToPath(new URL('../fave-worker/migrations/0014_driver_trip_offers.sql', import.meta.url))
const followUpMigrationPath = fileURLToPath(new URL('../fave-worker/migrations/0015_driver_trip_offer_followups.sql', import.meta.url))

test('offer and follow-up migrations persist an audited call outcome for an assigned driver offer', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE user (id TEXT PRIMARY KEY);
      CREATE TABLE driver_applications (id TEXT PRIMARY KEY);
      CREATE TABLE vehicles (id TEXT PRIMARY KEY);
      CREATE TABLE trip_quotes (id TEXT PRIMARY KEY);
    `)
    db.exec(readFileSync(offerMigrationPath, 'utf8'))
    db.exec(readFileSync(followUpMigrationPath, 'utf8'))
    db.prepare('INSERT INTO user (id) VALUES (?)').run('client-1')
    db.prepare('INSERT INTO user (id) VALUES (?)').run('staff-1')
    db.prepare('INSERT INTO driver_applications (id) VALUES (?)').run('driver-app-1')
    db.prepare('INSERT INTO vehicles (id) VALUES (?)').run('vehicle-1')
    db.prepare(`INSERT INTO driver_trip_offers
      (id, client_user_id, driver_application_id, vehicle_id, origin_json, destination_json,
       start_date, end_date, party_size, luggage_count, status, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('offer-1', 'client-1', 'driver-app-1', 'vehicle-1', '{}', '{}', '2099-01-01', '2099-01-02', 1, 0, 'pending', 1000, 1)

    db.prepare(`INSERT INTO driver_trip_offer_followups
      (id, offer_id, actor_user_id, outcome, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run('follow-up-1', 'offer-1', 'staff-1', 'no_answer', 'Called twice', 10)

    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM driver_trip_offer_followups WHERE offer_id = ?').get('offer-1').count, 1)
    assert.throws(
      () => db.prepare(`INSERT INTO driver_trip_offer_followups
        (id, offer_id, actor_user_id, outcome, note, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run('follow-up-2', 'offer-1', 'staff-1', 'accept', null, 11),
      /CHECK constraint failed/u,
    )
    assert.equal(db.prepare('SELECT status FROM driver_trip_offers WHERE id = ?').get('offer-1').status, 'pending')
  } finally {
    db.close()
  }
})

function loadAdminTripOffers({ user = { id: 'staff-1', name: 'Staff' }, admin = true, db }) {
  const exports = {}
  const routes = new Map()
  const audits = []
  class CapturingHono {
    get(path, handler) { routes.set(`GET ${path}`, handler); return this }
    post(path, handler) { routes.set(`POST ${path}`, handler); return this }
  }
  const code = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  vm.runInNewContext(code, {
    exports,
    require: (name) => {
      if (name === 'hono') return { Hono: CapturingHono }
      if (name === './marketplace-auth') return {
        apiError: (code, message) => ({ error: { code, message } }),
        getSignedInUser: async () => user,
        isMarketplaceAdmin: async () => admin,
        writeMarketplaceAudit: async (_env, event) => { audits.push(event) },
      }
      throw new Error(`Unexpected module: ${name}`)
    },
    Date,
    Number,
    String,
    JSON,
    Promise,
    crypto: { randomUUID: () => 'follow-up-1' },
  })
  return { routes, exports, audits }
}

function context(db, { method = 'GET', path = '/api/admin/trip-offers', body = null } = {}) {
  return {
    env: { DB: db },
    req: {
      raw: new Request(`https://fave.test${path}`, { method }),
      param: (name) => name === 'offerId' ? 'offer-1' : undefined,
      json: async () => body,
    },
    json: (value, status = 200) => ({ body: value, status }),
  }
}

test('non-admins cannot load the driver offer queue', async () => {
  const queries = []
  const db = { prepare(sql) { queries.push(sql); return { bind() { return this }, async run() {}, async all() { return { results: [] } } } } }
  const app = loadAdminTripOffers({ admin: false, db })
  const response = await app.routes.get('GET /') (context(db))
  assert.equal(response.status, 403)
  assert.equal(queries.length, 0, 'offer data is never queried before authorization')
})

test('admin queue contains pending and recent status but no client contact or exact address', async () => {
  const queries = []
  const row = {
    id: 'offer-1', status: 'pending', expires_at: Date.now() + 60_000, created_at: Date.now(),
    start_date: '2099-01-01', end_date: '2099-01-02', make: 'Toyota', model: 'RAV4',
    origin_json: JSON.stringify({ formattedAddress: '12 Private Street, Kololo, Kampala, Uganda' }),
    destination_json: JSON.stringify({ formattedAddress: '9 Secret Lane, Entebbe, Uganda' }),
    follow_up_count: 1,
  }
  const processingRow = { ...row, id: 'offer-2', status: 'quoting' }
  const db = { prepare(sql) { queries.push(sql); return {
    bind() { return this }, async run() { return { meta: { changes: 1 } } },
    async all() {
      if (sql.includes("offer.status = 'pending'")) return { results: [row] }
      if (sql.includes("offer.status = 'quoting'")) return { results: [processingRow] }
      return { results: [] }
    },
  } } }
  const app = loadAdminTripOffers({ db })
  const response = await app.routes.get('GET /')(context(db))
  assert.equal(response.status, 200)
  assert.equal(response.body.pendingOffers[0].status, 'pending')
  assert.equal(response.body.processingOffers[0].status, 'quoting')
  assert.equal(response.body.recentOffers.length, 0)
  const serialized = JSON.stringify(response.body)
  assert.match(serialized, /Kampala, Uganda/u)
  assert.doesNotMatch(serialized, /Private Street|Secret Lane|client_user_id|phone_e164/u)
  assert.match(queries[1], /ORDER BY offer\.expires_at ASC/u)
})

test('admin queue classifies timed-out quote preparation as quote_failed', async () => {
  const now = Date.now()
  const rows = [
    {
      id: 'offer-quoting', status: 'quoting', expires_at: now - 1, created_at: now - 60_000,
      responded_at: now - 30_000, start_date: '2099-01-01', end_date: '2099-01-02',
      make: 'Toyota', model: 'RAV4', origin_json: '{}', destination_json: '{}', follow_up_count: 0,
    },
    {
      id: 'offer-pending', status: 'pending', expires_at: now - 1, created_at: now - 120_000,
      responded_at: null, start_date: '2099-01-01', end_date: '2099-01-02',
      make: 'Honda', model: 'Fit', origin_json: '{}', destination_json: '{}', follow_up_count: 0,
    },
  ]
  const queries = []
  const db = {
    prepare(sql) {
      const query = { sql, args: [] }
      queries.push(query)
      return {
        bind(...args) { query.args = args; return this },
        async run() {
          if (sql.includes('UPDATE driver_trip_offers')) {
            for (const row of rows) {
              if (['pending', 'quoting'].includes(row.status) && row.expires_at <= query.args[1]) {
                row.status = row.status === 'quoting' ? 'quote_failed' : 'expired'
                row.responded_at ??= query.args[0]
              }
            }
          }
          return { meta: { changes: 1 } }
        },
        async all() {
          if (sql.includes("offer.status = 'pending'")) {
            return { results: rows.filter((row) => row.status === 'pending' && row.expires_at > query.args[0]) }
          }
          if (sql.includes('offer.status IN')) {
            return { results: rows.filter((row) => ['quoted', 'declined', 'expired', 'withdrawn', 'quote_failed'].includes(row.status)) }
          }
          if (sql.includes("offer.status = 'quoting'")) {
            return { results: rows.filter((row) => row.status === 'quoting') }
          }
          return { results: [] }
        },
      }
    },
  }

  const app = loadAdminTripOffers({ db })
  const response = await app.routes.get('GET /')(context(db))

  assert.equal(response.status, 200)
  assert.equal(response.body.recentOffers.find((offer) => offer.offerId === 'offer-quoting').status, 'quote_failed')
  assert.equal(response.body.recentOffers.find((offer) => offer.offerId === 'offer-pending').status, 'expired')
  assert.equal(response.body.processingOffers.length, 0)
  assert.match(queries[0].sql, /CASE WHEN status = 'quoting' THEN 'quote_failed' ELSE 'expired' END/u)
})

test('opening assigned driver contact audits the access before returning the number', async () => {
  const queries = []
  const db = { prepare(sql) { queries.push(sql); return {
    bind() { return this }, async first() {
      return { offer_id: 'offer-1', driver_name: 'Driver Example', driver_phone: '+256700000001' }
    },
  } } }
  const app = loadAdminTripOffers({ db })
  const response = await app.routes.get('POST /:offerId/driver-contact')(context(db, {
    method: 'POST', path: '/api/admin/trip-offers/offer-1/driver-contact',
  }))
  assert.equal(response.status, 200)
  assert.equal(response.body.driver.phone, '+256700000001')
  assert.equal(app.audits.length, 1)
  assert.equal(app.audits[0].action, 'driver_trip_offer_contact_accessed')
  assert.equal(app.audits[0].targetId, 'offer-1')
})

test('call follow-up records allowed outcome and audit without changing offer status', async () => {
  const queries = []
  const db = { prepare(sql) { queries.push(sql); return {
    bind() { return this }, async first() { return { id: 'offer-1', status: 'pending', expires_at: Date.now() + 60_000 } },
    async run() { return { meta: { changes: 1 } } },
  } } }
  const app = loadAdminTripOffers({ db })
  const response = await app.routes.get('POST /:offerId/follow-ups')(context(db, {
    method: 'POST', path: '/api/admin/trip-offers/offer-1/follow-ups',
    body: { outcome: 'no_answer', note: 'Called twice' },
  }))
  assert.equal(response.status, 201)
  assert.equal(response.body.followUpId, 'follow-up-1')
  assert.match(queries[1], /INSERT INTO driver_trip_offer_followups/u)
  assert.doesNotMatch(queries.join('\n'), /UPDATE driver_trip_offers/u)
  assert.equal(app.audits[0].action, 'driver_trip_offer_followup_recorded')
})
