import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const driversSource = fileURLToPath(new URL('../fave-worker/src/drivers.ts', import.meta.url))
const vehiclesSource = fileURLToPath(new URL('../fave-worker/src/vehicles.ts', import.meta.url))

function loadModule(sourcePath, imports = {}) {
  const exports = {}
  const code = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText

  vm.runInNewContext(code, {
    exports,
    require: (name) => {
      if (name in imports) return imports[name]
      if (name === 'hono') {
        return { Hono: class {
          get() { return this }
          post() { return this }
          patch() { return this }
          delete() { return this }
        } }
      }
      throw new Error(`Unexpected module: ${name}`)
    },
    Date,
    Intl,
    Number,
    String,
    Set,
    Promise,
    Response,
    Headers,
    JSON,
    Math,
  })

  return exports
}

function loadVehicleCatalog(user = { id: 'client-1', name: 'Client', email: 'client@example.test' }) {
  const drivers = loadModule(driversSource, {
    './marketplace-auth': {
      apiError() {}, getSignedInUser() {}, isMarketplaceAdmin() {}, writeMarketplaceAudit() {},
    },
    './marketplace-policies': { getCurrentPolicies() {}, hasCurrentPolicyAcceptance() {} },
    './private-files': { readPrivateEvidence() {}, storePrivateEvidence() {}, storePrivateImage() {} },
    './private-fields': { decryptPrivateField() {}, encryptPrivateField() {} },
  })
  const routes = new Map()
  class CapturingHono {
    get(path, handler) { routes.set(path, handler); return this }
    post() { return this }
    patch() { return this }
    delete() { return this }
  }

  const vehicleExports = loadModule(vehiclesSource, {
    hono: { Hono: CapturingHono },
    './drivers': {
      approvedDriverEvidencePredicate: drivers.approvedDriverEvidencePredicate,
    },
    './marketplace-auth': {
      apiError: (code, message) => ({ error: { code, message } }),
      getSignedInUser: async () => user,
      isMarketplaceAdmin: async () => false,
      writeMarketplaceAudit: async () => undefined,
    },
    './private-files': {
      readPrivateEvidence: async () => null,
      readPublicVehiclePhoto: async () => null,
      storePrivateEvidence: async () => null,
      storePublicVehiclePhoto: async () => null,
    },
  })

  return { routes, ...vehicleExports }
}

function createDatabase(vehicleRow, photoRows) {
  const queries = []
  return {
    queries,
    prepare(sql) {
      const query = { sql, args: [] }
      queries.push(query)
      return {
        bind(...args) { query.args = args; return this },
        async all() {
          if (sql.includes('FROM vehicles AS vehicle')) return { results: [vehicleRow] }
          if (sql.includes('FROM vehicle_media')) return { results: photoRows }
          throw new Error(`Unexpected query: ${sql}`)
        },
      }
    },
  }
}

test('vehicle catalog only returns public vehicle facts and approved client photos', async () => {
  const { routes, vehiclesApp } = loadVehicleCatalog()
  assert.ok(vehiclesApp)
  const handler = routes.get('/catalog')
  assert.equal(typeof handler, 'function')

  const DB = createDatabase({
    id: 'vehicle-1',
    make: 'Toyota',
    model: 'Noah',
    model_year: 2022,
    passenger_capacity: 6,
    luggage_capacity: 4,
    comfort_details: 'Air conditioning',
    accessibility_details: '',
    registration_number: 'PRIVATE-PLATE',
    driver_application_id: 'PRIVATE-DRIVER-ID',
    applicant_message: 'PRIVATE-REVIEW-NOTE',
  }, [
    { id: 'photo-approved', review_status: 'approved', media_kind: 'client_photo', object_key: 'vehicle-documents/private-id' },
  ])
  const request = new Request('https://fave.test/api/vehicles/catalog?startDate=2099-01-01&endDate=2099-01-02&partySize=2&luggageCount=1')
  const context = {
    env: { DB },
    req: {
      raw: request,
      query: (name) => new URL(request.url).searchParams.get(name) ?? undefined,
    },
    json: (body, status = 200) => ({ body, status }),
  }

  const response = await handler(context)
  assert.equal(response.status, 200)
  assert.deepEqual(JSON.parse(JSON.stringify(response.body)), {
    vehicles: [{
      id: 'vehicle-1',
      make: 'Toyota',
      model: 'Noah',
      year: 2022,
      passengerCapacity: 6,
      luggageCapacity: 4,
      comfortDetails: 'Air conditioning',
      accessibilityDetails: '',
      photos: [{ id: 'photo-approved', url: '/api/vehicles/vehicle-1/photos/photo-approved' }],
    }],
  })

  assert.equal(DB.queries.length, 2)
  for (const query of DB.queries) {
    assert.equal(query.args.length, (query.sql.match(/\?/gu) ?? []).length, 'every SQL placeholder has exactly one binding')
  }
  assert.match(DB.queries[0].sql, /vehicle\.status = 'approved' AND driver\.status = 'approved'/u)
  assert.match(DB.queries[1].sql, /media_kind = 'client_photo' AND review_status = 'approved'/u)
})

test('vehicle catalog rejects unauthenticated searches before querying vehicle data', async () => {
  const { routes } = loadVehicleCatalog(null)
  const handler = routes.get('/catalog')
  const queriedSql = []
  const request = new Request('https://fave.test/api/vehicles/catalog?startDate=2099-01-01&endDate=2099-01-02&partySize=2&luggageCount=1')
  const context = {
    env: { DB: { prepare(sql) { queriedSql.push(sql); throw new Error('database must not be queried') } } },
    req: {
      raw: request,
      query: (name) => new URL(request.url).searchParams.get(name) ?? undefined,
    },
    json: (body, status = 200) => ({ body, status }),
  }

  const response = await handler(context)
  assert.equal(response.status, 401)
  assert.deepEqual(JSON.parse(JSON.stringify(response.body)), {
    error: { code: 'UNAUTHORIZED', message: 'Sign in to continue.' },
  })
  assert.deepEqual(queriedSql, [])
})
