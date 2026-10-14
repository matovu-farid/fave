import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const source = fileURLToPath(new URL('../fave-worker/src/notifications.ts', import.meta.url))
const adminSource = fileURLToPath(new URL('../fave-worker/src/admin-notifications.ts', import.meta.url))

function loadRoutes({ user = { id: 'user-1' }, page } = {}) {
  const exports = {}
  const routes = new Map()
  const calls = []
  class CapturingHono {
    get(path, handler) { routes.set(`GET ${path}`, handler); return this }
    post(path, handler) { routes.set(`POST ${path}`, handler); return this }
    delete(path, handler) { routes.set(`DELETE ${path}`, handler); return this }
  }
  const code = ts.transpileModule(readFileSync(source, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  vm.runInNewContext(code, {
    exports,
    require: name => {
      if (name === 'hono') return { Hono: CapturingHono }
      if (name === './marketplace-auth') return {
        apiError: (code, message) => ({ error: { code, message } }),
        getSignedInUser: async () => user,
      }
      if (name === './notification-store') return {
        listNotifications: async (...args) => { calls.push(['list', ...args]); return page },
        markNotificationRead: async (...args) => { calls.push(['read', ...args]); return args[1] === 'user-1' && args[2] === 'notification-1' },
        markAllNotificationsRead: async (...args) => { calls.push(['readAll', ...args]); return 3 },
      }
      if (name === './notification-delivery') return {
        safeNotificationCopy: () => ({ title: 'New trip offer', body: 'A trip offer is waiting for your response.' }),
      }
      throw new Error(`Unexpected module: ${name}`)
    },
    JSON,
    Number,
    Date,
    Promise,
  })
  return { routes, calls }
}

function context({ userId = 'notification-1', url = 'https://fave.test/api/notifications/inbox' } = {}) {
  return {
    env: { DB: {} },
    req: {
      raw: new Request(url),
      query: key => new URL(url).searchParams.get(key) ?? undefined,
      param: () => userId,
    },
    json: (payload, status = 200) => ({ payload, status }),
  }
}

test('inbox API rejects signed-out users before querying notification data', async () => {
  const { routes, calls } = loadRoutes({ user: null })
  const response = await routes.get('GET /inbox')(context())

  assert.equal(response.status, 401)
  assert.deepEqual(calls, [])
})

test('inbox returns safe rendered fields and scopes listing to the signed-in user', async () => {
  const page = {
    items: [{
      id: 'notification-1', eventId: 'event-1', eventType: 'booking.driver_offer_created',
      templateKey: 'driver_offer_received', routeKey: 'driver_offers', domainId: 'secret-domain',
      priority: 'time_sensitive', createdAt: 10, readAt: null,
    }],
    unreadCount: 1,
    nextCursor: { createdAt: 10, id: 'notification-1' },
  }
  const { routes, calls } = loadRoutes({ page })
  const response = await routes.get('GET /inbox')(context({ url: 'https://fave.test/api/notifications/inbox?limit=30' }))
  const payload = JSON.parse(JSON.stringify(response.payload))

  assert.equal(calls[0][2], 'user-1')
  assert.equal(payload.notifications[0].title, 'New trip offer')
  assert.equal(payload.notifications[0].isRead, false)
  assert.equal(payload.unreadCount, 1)
  assert.equal(JSON.stringify(payload).includes('secret-domain'), false)
  assert.equal(JSON.stringify(payload).includes('event-1'), false)
})

test('read endpoints use only the signed-in user and return not-found for other users’ notifications', async () => {
  const { routes, calls } = loadRoutes()
  const read = await routes.get('POST /inbox/:notificationId/read')(context({ userId: 'notification-other' }))
  const readAll = await routes.get('POST /inbox/read-all')(context())

  assert.equal(read.status, 404)
  assert.equal(readAll.payload.updated, 3)
  assert.deepEqual(calls.filter(call => call[0] === 'read')[0].slice(2, 4), ['user-1', 'notification-other'])
  assert.equal(calls.find(call => call[0] === 'readAll')[2], 'user-1')
})

function loadAdminRoutes({ user = { id: 'admin-1' }, admin = true, current = null, device = true } = {}) {
  const exports = {}
  const routes = new Map()
  const audits = []
  const statements = []
  class CapturingHono {
    get(path, handler) { routes.set(`GET ${path}`, handler); return this }
    post(path, handler) { routes.set(`POST ${path}`, handler); return this }
  }
  const code = ts.transpileModule(readFileSync(adminSource, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  vm.runInNewContext(code, {
    exports,
    require: name => {
      if (name === 'hono') return { Hono: CapturingHono }
      if (name === './marketplace-auth') return {
        apiError: (code, message) => ({ error: { code, message } }),
        getSignedInUser: async () => user,
        isMarketplaceAdmin: async () => admin,
        writeMarketplaceAudit: async (_env, event) => { audits.push(event) },
      }
      throw new Error(`Unexpected module: ${name}`)
    },
    JSON,
    Number,
    String,
    Date,
    Promise,
    crypto: globalThis.crypto,
  })
  const DB = {
    prepare(sql) {
      const statement = { sql, args: [] }
      statements.push(statement)
      return Object.assign(statement, {
        bind(...args) { statement.args = args; return this },
        async first() {
          if (sql.includes('FROM notification_outbox AS outbox WHERE outbox.delivery_id')) return current
          if (sql.includes('FROM notification_push_tokens')) return device ? { available: 1 } : null
          if (sql.includes('MIN(created_at)')) return { createdAt: null }
          return null
        },
        async all() {
          if (sql.includes('GROUP BY status')) return { results: [{ status: 'failed', count: 1 }] }
          if (sql.includes('WHERE delivery.status IN')) return { results: current ? [{
            deliveryId: current.deliveryId, eventType: 'booking.driver_offer_created', status: current.status,
            attemptCount: 5, errorCategory: 'expo_temporary_failure', createdAt: 10,
          }] : [] }
          return { results: [] }
        },
        async run() { return { success: true, meta: { changes: 1 } } },
      })
    },
    async batch(batchStatements) {
      for (const statement of batchStatements) statements.push(statement)
      return batchStatements.map(statement => ({ meta: { changes: statement.sql.includes('UPDATE notification_outbox') ? 1 : 1 } }))
    },
  }
  return { routes, audits, statements, DB }
}

function adminContext(DB, deliveryId = 'delivery-1') {
  return {
    env: { DB, NOTIFICATION_QUEUE: { async send(message) { assert.deepEqual(JSON.parse(JSON.stringify(message)), { deliveryId }) } } },
    req: { raw: new Request('https://fave.test/api/admin/notifications/health'), param: () => deliveryId },
    json: (payload, status = 200) => ({ payload, status }),
  }
}

test('notification health requires an admin and returns redacted delivery metadata', async () => {
  const signedOut = loadAdminRoutes({ user: null })
  assert.equal((await signedOut.routes.get('GET /health')(adminContext(signedOut.DB))).status, 401)
  const nonAdmin = loadAdminRoutes({ admin: false })
  assert.equal((await nonAdmin.routes.get('GET /health')(adminContext(nonAdmin.DB))).status, 403)

  const admin = loadAdminRoutes({ current: { deliveryId: 'delivery-12345678', status: 'dead_lettered', expiresAt: null, recipientUserId: 'private-user' } })
  const response = await admin.routes.get('GET /health')(adminContext(admin.DB))
  const serialized = JSON.stringify(response.payload)
  assert.equal(serialized.includes('private-user'), false)
  assert.equal(response.payload.failures[0].deliveryRef, 'delivery')
  assert.equal(response.payload.failures[0].attemptCount, 5)
})

test('admin retry refuses an expired delivery and audits the terminal outcome', async () => {
  const expired = loadAdminRoutes({ current: {
    deliveryId: 'delivery-1', status: 'dead_lettered', expiresAt: 1, recipientUserId: 'user-1',
  } })
  const ctx = adminContext(expired.DB)
  const response = await expired.routes.get('POST /:deliveryId/retry')(ctx)
  assert.equal(response.status, 409)
  assert.deepEqual(JSON.parse(JSON.stringify(response.payload)), { result: 'expired' })
  assert.equal(expired.audits[0].action, 'notification_retry_expired')
  assert.equal(expired.statements.some(statement => statement.sql.includes('NOTIFICATION_QUEUE')), false)
})

test('admin retry rechecks a current token, queues an opaque ID, and records the operator action', async () => {
  const current = loadAdminRoutes({ current: {
    deliveryId: 'delivery-1', status: 'dead_lettered', expiresAt: null, recipientUserId: 'user-1',
  } })
  const response = await current.routes.get('POST /:deliveryId/retry')(adminContext(current.DB))
  assert.equal(response.status, 202)
  assert.equal(response.payload.result, 'queued')
  assert.equal(current.audits[0].action, 'notification_retry_queued')
  assert.equal(current.statements.some(statement => statement.sql.includes('notification_retry_audit')), true)
})
