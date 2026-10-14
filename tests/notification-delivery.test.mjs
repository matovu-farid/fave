import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'
import ts from 'typescript'

const source = fileURLToPath(new URL('../fave-worker/src/notification-delivery.ts', import.meta.url))

function loadDelivery({ due = [], fetcher = async () => Response.json({ data: [{ status: 'ok', id: 'ticket-1' }] }) } = {}) {
  const exports = {}
  const statements = []
  const code = ts.transpileModule(readFileSync(source, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  vm.runInNewContext(code, {
    exports,
    require: name => name === './notification-store'
      ? { claimDueNotificationDeliveries: async () => due }
      : (() => { throw new Error(`Unexpected module: ${name}`) })(),
    JSON,
    Date,
    Number,
    String,
    Promise,
    crypto: webcrypto,
    fetch,
  })
  return { ...exports, statements, fetcher }
}

function fakeDb({ delivery = null, devices = [] } = {}) {
  const queries = []
  return {
    queries,
    prepare(sql) {
      const query = { sql, args: [] }
      queries.push(query)
      return Object.assign(query, {
        bind(...args) { query.args = args; return this },
        async first() {
          if (sql.includes('FROM notification_outbox AS outbox')) return delivery
          if (sql.includes('FROM notification_deliveries WHERE')) return null
          return null
        },
        async all() {
          if (sql.includes('FROM notification_push_tokens')) return { results: devices }
          return { results: [] }
        },
        async run() { return { success: true, meta: { changes: 1 } } },
      })
    },
    async batch(statements) {
      for (const statement of statements) queries.push(statement)
      return statements.map(() => ({ success: true, meta: { changes: 1 } }))
    },
  }
}

function queueMessage(body) {
  const calls = { ack: 0, retry: [] }
  return {
    calls,
    body,
    ack() { calls.ack += 1 },
    retry(options) { calls.retry.push(options) },
  }
}

test('outbox dispatcher enqueues only delivery IDs and returns enqueue failures to the due queue', async () => {
  const due = [{ deliveryId: 'delivery-1' }, { deliveryId: 'delivery-2' }]
  const { dispatchDueNotificationDeliveries } = loadDelivery({ due })
  const sent = []
  const db = fakeDb()
  const env = {
    DB: db,
    NOTIFICATION_QUEUE: { async send(value) {
      sent.push(value)
      if (value.deliveryId === 'delivery-2') throw new Error('offline')
    } },
  }

  const queued = await dispatchDueNotificationDeliveries(env, 1000)

  assert.equal(queued, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [{ deliveryId: 'delivery-1' }, { deliveryId: 'delivery-2' }])
  assert.equal(db.queries.some(query => /SET status = 'queued'/u.test(query.sql)), true)
  assert.equal(db.queries.some(query => /SET status = 'pending'/u.test(query.sql) && /queue_enqueue_failed/u.test(query.sql)), true)
})

test('queue consumer sends privacy-safe preview data and saves the Expo ticket', async () => {
  const delivery = {
    deliveryId: 'delivery-1', notificationId: 'notification-1', recipientUserId: 'user-1',
    templateKey: 'driver_offer_received', routeKey: 'driver_offers', priority: 'time_sensitive', expiresAt: 5000,
  }
  const device = { id: 'token-row-1', token: 'ExpoPushToken[private]', platform: 'ios' }
  let requestBody
  const { handleNotificationQueue } = loadDelivery({ fetcher: async (_url, options) => {
    requestBody = JSON.parse(options.body)
    return Response.json({ data: [{ status: 'ok', id: 'ticket-1' }] })
  } })
  const db = fakeDb({ delivery, devices: [device] })
  const message = queueMessage({ deliveryId: 'delivery-1' })

  await handleNotificationQueue({ queue: 'fave-notification-delivery', messages: [message] }, { DB: db }, async (...args) => {
    requestBody = JSON.parse(args[1].body)
    return Response.json({ data: [{ status: 'ok', id: 'ticket-1' }] })
  }, 1000)

  assert.equal(message.calls.ack, 1)
  assert.deepEqual(requestBody.data, { notificationId: 'notification-1', routeKey: 'driver_offers' })
  assert.equal(requestBody.body, 'A trip offer is waiting for your response.')
  assert.equal(JSON.stringify({ body: requestBody.body, data: requestBody.data }).includes('private'), false)
  assert.equal(db.queries.some(query => /notification_deliveries/u.test(query.sql)), true)
  assert.equal(db.queries.some(query => query.sql.includes("status = ?") && query.args.includes('complete')), true)
})

test('expired and unregistered notifications are acknowledged without sending new pushes', async () => {
  const expired = {
    deliveryId: 'delivery-expired', notificationId: 'n1', recipientUserId: 'user-1',
    templateKey: 'driver_offer_received', routeKey: 'driver_offers', priority: 'time_sensitive', expiresAt: 999,
  }
  const { handleNotificationQueue } = loadDelivery()
  const expiredDb = fakeDb({ delivery: expired })
  const expiredMessage = queueMessage({ deliveryId: expired.deliveryId })
  let sends = 0
  const fetcher = async () => { sends += 1; return Response.json({}) }

  await handleNotificationQueue({ queue: 'fave-notification-delivery', messages: [expiredMessage] }, { DB: expiredDb }, fetcher, 1000)
  assert.equal(expiredMessage.calls.ack, 1)
  assert.equal(sends, 0)
  assert.equal(expiredDb.queries.some(query => /status = 'expired'/u.test(query.sql)), true)

  const noDevicesDb = fakeDb({ delivery: { ...expired, expiresAt: null } })
  const noDevicesMessage = queueMessage({ deliveryId: expired.deliveryId })
  await handleNotificationQueue({ queue: 'fave-notification-delivery', messages: [noDevicesMessage] }, { DB: noDevicesDb }, fetcher, 1000)
  assert.equal(noDevicesMessage.calls.ack, 1)
  assert.equal(noDevicesDb.queries.some(query => /status = 'suppressed'/u.test(query.sql)), true)
  assert.equal(sends, 0)
})

test('DLQ consumer marks delivery and device attempts for operations without replaying them', async () => {
  const { handleNotificationQueue } = loadDelivery()
  const db = fakeDb()
  const message = queueMessage({ deliveryId: 'delivery-1' })

  await handleNotificationQueue({ queue: 'fave-notification-dlq', messages: [message] }, { DB: db }, async () => {
    throw new Error('DLQ messages must not be sent again')
  }, 1000)

  assert.equal(message.calls.ack, 1)
  assert.equal(db.queries.some(query => /status = 'dead_lettered'/u.test(query.sql)), true)
})

test('receipt sweep checks only mature Expo tickets and does not poll missing receipts every minute', async () => {
  const { sweepExpoReceipts } = loadDelivery()
  const queries = []
  const db = {
    prepare(sql) {
      const statement = { sql, args: [] }
      queries.push(statement)
      return Object.assign(statement, {
        bind(...args) { statement.args = args; return this },
        async all() { return { results: [{
          id: 'device-delivery-1', deliveryId: 'delivery-1', tokenId: 'token-1',
          ticketId: 'ticket-1', platform: 'ios', lastAttemptAt: 1000,
        }] } },
        async run() { return { meta: { changes: 1 } } },
      })
    },
  }

  const checked = await sweepExpoReceipts({ DB: db }, async () => Response.json({ data: {} }), 20 * 60_000)

  assert.equal(checked, 0, 'a missing receipt remains eligible for a later retry')
  assert.match(queries[0].sql, /receipt_checked_at IS NULL OR delivery\.receipt_checked_at <= \?/u)
  assert.equal(queries.some(query => /SET receipt_checked_at/u.test(query.sql)), true)
})
