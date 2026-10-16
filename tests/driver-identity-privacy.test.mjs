import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const driversSource = fileURLToPath(new URL('../fave-worker/src/drivers.ts', import.meta.url))

function loadDrivers({ user = { id: 'client-1', name: 'Client', email: 'client@example.test' }, db } = {}) {
  const exports = {}
  const routes = new Map()
  let auditCalls = 0
  let decryptCalls = 0
  class CapturingHono {
    use() { return this }
    get(path, handler) { routes.set(`GET ${path}`, handler); return this }
    post(path, handler) { routes.set(`POST ${path}`, handler); return this }
  }
  const code = ts.transpileModule(readFileSync(driversSource, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText

  vm.runInNewContext(code, {
    exports,
    require: (name) => {
      if (name === 'hono') return { Hono: CapturingHono }
      if (name === './review-access') return { reviewAccess: () => {}, isReviewMember: async (env, userId) => env.DB.prepare('SELECT 1 FROM review_memberships WHERE user_id = ? AND active = 1').bind(userId).first() }
      if (name === './marketplace-auth') return {
        apiError: (apiErrorCode, message) => ({ error: { code: apiErrorCode, message } }),
        getSignedInUser: async () => user,
        isMarketplaceAdmin: async (env, userId) => env.DB.prepare(
          'SELECT 1 AS allowed FROM admin_memberships WHERE user_id = ? AND active = 1 LIMIT 1',
        ).bind(userId).first(),
        writeMarketplaceAudit: async () => { auditCalls += 1 },
      }
      if (name === './marketplace-policies') return {
        getCurrentPolicies: async () => [],
        hasCurrentPolicyAcceptance: async () => false,
      }
      if (name === './private-files') return {
        readPrivateEvidence: async () => null,
        storePrivateEvidence: async () => null,
        storePrivateImage: async () => null,
      }
      if (name === './private-fields') return {
        decryptPrivateField: async () => { decryptCalls += 1; return 'SENSITIVE-NATIONAL-ID' },
        encryptPrivateField: async () => null,
      }
      throw new Error(`Unexpected module: ${name}`)
    },
    Date,
    Intl,
    Number,
    String,
    Set,
    Promise,
    JSON,
  })

  return { routes, exports, get auditCalls() { return auditCalls }, get decryptCalls() { return decryptCalls } }
}

test('signed-in non-admins cannot open a driver national ID record', async () => {
  const queries = []
  const db = {
    prepare(sql) {
      queries.push(sql)
      return { bind() { return this }, async first() { return null } }
    },
  }
  const app = loadDrivers({ db })
  const handler = app.routes.get('POST /:applicationId/identity-review')
  const context = {
    env: { DB: db },
    req: {
      raw: new Request('https://fave.test/api/admin/drivers/application-1/identity-review', { method: 'POST' }),
      json: async () => ({ reason: 'Review requested by operations' }),
      param: (name) => name === 'applicationId' ? 'application-1' : undefined,
    },
    json: (body, status = 200) => ({ body, status }),
  }

  const response = await handler(context)
  assert.equal(response.status, 403)
  assert.deepEqual(JSON.parse(JSON.stringify(response.body)), {
    error: { code: 'FORBIDDEN', message: 'You are not authorized to review identity evidence.' },
  })
  assert.equal(queries.length, 1)
  assert.match(queries[0], /FROM review_memberships/u)
  assert.equal(app.auditCalls, 0)
  assert.equal(app.decryptCalls, 0)
})

test('signed-in non-admins cannot list pending driver applications', async () => {
  const queries = []
  const db = {
    prepare(sql) {
      queries.push(sql)
      return { bind() { return this }, async first() { return null } }
    },
  }
  const app = loadDrivers({ db })
  const handler = app.routes.get('GET /pending')
  const context = {
    env: { DB: db },
    req: { raw: new Request('https://fave.test/api/admin/drivers/pending') },
    json: (body, status = 200) => ({ body, status }),
  }

  const response = await handler(context)
  assert.equal(response.status, 403)
  assert.deepEqual(JSON.parse(JSON.stringify(response.body)), {
    error: { code: 'FORBIDDEN', message: 'You are not authorized to review driver applications.' },
  })
  assert.equal(queries.length, 1)
  assert.match(queries[0], /FROM review_memberships/u)
})

test('a driver application response omits national ID values and private file keys', async () => {
  const queries = []
  const application = {
    id: 'application-1',
    user_id: 'driver-1',
    legal_name: 'Driver Example',
    phone_e164: '+256700000001',
    lodging_rate_ugx: 42_000,
    national_id_number: 'ENCRYPTED-NATIONAL-ID',
    national_id_last4: '4321',
    citizenship_attested_at: Date.now(),
    submission_version: 1,
    status: 'pending_verification',
    applicant_message: null,
    reviewer_reason: null,
    submitted_at: Date.now(),
    retention_expires_at: Date.now() + 60_000,
    retention_policy_id: 'retention-1',
    retention_policy_version: '1',
  }
  const db = {
    prepare(sql) {
      queries.push(sql)
      return {
        bind() { return this },
        async first() { return application },
        async all() {
          return { results: [{
            id: 'document-1',
            document_type: 'national_id_front',
            requirement_version: '1',
            review_status: 'pending',
            reviewer_reason: 'PRIVATE-REVIEW-NOTE',
            created_at: Date.now(),
            object_key: 'driver-documents/private-id',
          }] }
        },
      }
    },
  }
  const app = loadDrivers({ db })
  const handler = app.routes.get('GET /application')
  const context = {
    env: { DB: db, DRIVER_FILES: {} },
    req: { raw: new Request('https://fave.test/api/drivers/application') },
    json: (body, status = 200) => ({ body, status }),
  }

  const response = await handler(context)
  const serialized = JSON.stringify(response.body)
  assert.equal(response.status, 200, JSON.stringify(response.body))
  assert.equal(serialized.includes('ENCRYPTED-NATIONAL-ID'), false)
  assert.equal(serialized.includes('4321'), false)
  assert.equal(serialized.includes('PRIVATE-REVIEW-NOTE'), false)
  assert.equal(serialized.includes('driver-documents/private-id'), false)
  assert.deepEqual(JSON.parse(serialized).application.documents.map((document) => document.type), ['national_id_front'])
  assert.equal(JSON.parse(serialized).application.lodgingRateUgx, 42_000)
  assert.equal(app.decryptCalls, 0)
  assert.equal(queries.some((sql) => sql.includes('national_id_number')), true)
})

test('driver applications reject a missing or zero overnight rate', async () => {
  const db = { prepare() { throw new Error('invalid input must be rejected before database access') } }
  const app = loadDrivers({ db })
  const form = new FormData()
  form.set('legalName', 'Driver Example')
  form.set('phoneNumber', '+256700000001')
  form.set('nationalIdNumber', 'CM12345678')
  form.set('citizenshipConfirmation', 'ugandan_citizen')
  form.set('lodgingRateUgx', '0')
  const request = new Request('https://fave.test/api/drivers/application', { method: 'POST', body: form })
  const response = await app.routes.get('POST /application')({
    env: { DB: db, DRIVER_FILES: {} },
    req: { raw: request, formData: async () => form },
    json: (body, status = 200) => ({ body, status }),
  })

  assert.equal(response.status, 400)
  assert.equal(response.body.error.code, 'INVALID_APPLICATION')
})

test('approved drivers can add a missing lodging rate without resubmitting identity evidence', async () => {
  const queries = []
  const db = {
    prepare(sql) {
      const query = { sql, args: [] }
      queries.push(query)
      return {
        bind(...args) { query.args = args; return this },
        async first() { return { id: 'application-1' } },
        async run() { return { success: true, meta: { changes: 1 } } },
      }
    },
  }
  const app = loadDrivers({ db, user: { id: 'driver-1', name: 'Driver', email: 'driver@example.test' } })
  const request = new Request('https://fave.test/api/drivers/application/lodging-rate', { method: 'POST' })
  const response = await app.routes.get('POST /application/lodging-rate')({
    env: { DB: db },
    req: { raw: request, json: async () => ({ lodgingRateUgx: 42_000 }) },
    json: (body, status = 200) => ({ body, status }),
  })

  assert.equal(response.status, 200)
  assert.equal(response.body.lodgingRateUgx, 42_000)
  assert.match(queries[0].sql, /UPDATE driver_applications/u)
  assert.match(queries[0].sql, /status = 'approved'/u)
})
