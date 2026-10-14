import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'
import * as contracts from '../fave-worker/src/notification-contracts.ts'

const authMigrationPath = fileURLToPath(new URL('../fave-worker/migrations/0001_better_auth.sql', import.meta.url))
const tokenMigrationPath = fileURLToPath(new URL('../fave-worker/migrations/0016_notification_push_tokens.sql', import.meta.url))
const notificationMigrationPath = fileURLToPath(new URL('../fave-worker/migrations/0017_notifications.sql', import.meta.url))
const storeSourcePath = fileURLToPath(new URL('../fave-worker/src/notification-store.ts', import.meta.url))

function loadNotificationStore() {
  const exports = {}
  const source = readFileSync(storeSourcePath, 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  vm.runInNewContext(code, {
    exports,
    require: (name) => {
      if (name === './notification-contracts') return contracts
      throw new Error(`Unexpected module: ${name}`)
    },
    crypto,
  })
  return exports
}

function createDatabase() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(readFileSync(authMigrationPath, 'utf8'))
  db.exec(readFileSync(tokenMigrationPath, 'utf8'))
  db.exec(readFileSync(notificationMigrationPath, 'utf8'))
  db.prepare('INSERT INTO user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)')
    .run('user-1', 'One', 'one@example.test', 1, 1)
  db.prepare('INSERT INTO user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)')
    .run('user-2', 'Two', 'two@example.test', 1, 1)
  return db
}

function createD1Adapter(db, { failAtBatchStatement = 0 } = {}) {
  let batchCount = 0
  const prepare = (sql) => {
    let values = []
    return {
      bind(...boundValues) { values = boundValues; return this },
      async run() {
        const result = db.prepare(sql).run(...values)
        return { ...result, meta: { changes: Number(result.changes) } }
      },
      async first() { return db.prepare(sql).get(...values) ?? null },
      async all() { return { results: db.prepare(sql).all(...values) } },
    }
  }
  return {
    prepare,
    async batch(statements) {
      db.exec('BEGIN IMMEDIATE')
      try {
        const results = []
        for (const statement of statements) {
          batchCount += 1
          if (failAtBatchStatement === batchCount) throw new Error('injected batch failure')
          results.push(await statement.run())
        }
        db.exec('COMMIT')
        return results
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
  }
}

function sampleEvent({ id = 'event-1', recipient = 'user-1', occurredAt = 10, expiresAt = 20 } = {}) {
  return {
    id,
    eventType: 'booking.driver_offer_created',
    eventVersion: 1,
    domainType: 'trip_offer',
    domainId: `offer-${id}`,
    occurredAt,
    expiresAt,
    recipients: [{ userId: recipient, role: 'driver' }],
  }
}

test('notification migration creates the event, inbox, outbox, delivery, and retry-audit tables', () => {
  const db = createDatabase()
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name)
    for (const name of [
      'notification_events',
      'notifications',
      'notification_outbox',
      'notification_deliveries',
      'notification_retry_audit',
    ]) {
      assert.ok(tables.includes(name), `missing table ${name}`)
    }
  } finally {
    db.close()
  }
})

test('notification inbox enforces user ownership and one item per event recipient', () => {
  const db = createDatabase()
  try {
    db.prepare(`INSERT INTO notification_events
      (id, event_type, event_version, domain_type, domain_id, occurred_at, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('event-1', 'driver.offer.created', 1, 'trip_offer', 'offer-1', 10, '{}', 10)
    const insert = db.prepare(`INSERT INTO notifications
      (id, event_id, recipient_user_id, template_key, route_key, priority, created_at, read_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    insert.run('notification-1', 'event-1', 'user-1', 'driver_offer', 'driver_offers', 'time_sensitive', 10, null)

    assert.throws(
      () => insert.run('notification-2', 'event-1', 'user-1', 'driver_offer', 'driver_offers', 'time_sensitive', 11, null),
      /UNIQUE constraint failed/u,
    )
    assert.throws(
      () => insert.run('notification-3', 'event-1', 'missing-user', 'driver_offer', 'driver_offers', 'time_sensitive', 11, null),
      /FOREIGN KEY constraint failed/u,
    )
  } finally {
    db.close()
  }
})

test('notification outbox delivery identifiers are unique and delivery rows keep no raw push token', () => {
  const db = createDatabase()
  try {
    db.prepare(`INSERT INTO notification_events
      (id, event_type, event_version, domain_type, domain_id, occurred_at, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('event-1', 'driver.offer.created', 1, 'trip_offer', 'offer-1', 10, '{}', 10)
    db.prepare(`INSERT INTO notifications
      (id, event_id, recipient_user_id, template_key, route_key, priority, created_at, read_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('notification-1', 'event-1', 'user-1', 'driver_offer', 'driver_offers', 'time_sensitive', 10, null)
    const insert = db.prepare(`INSERT INTO notification_outbox
      (delivery_id, notification_id, event_id, recipient_user_id, status, not_before, expires_at, attempt_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    insert.run('delivery-1', 'notification-1', 'event-1', 'user-1', 'pending', 10, 20, 0, 10)
    assert.throws(
      () => insert.run('delivery-1', 'notification-1', 'event-1', 'user-1', 'pending', 10, 20, 0, 10),
      /UNIQUE constraint failed/u,
    )

    const columns = db.prepare('PRAGMA table_info(notification_deliveries)').all().map(column => column.name)
    assert.ok(columns.includes('push_token_id'))
    assert.ok(!columns.includes('push_token'))
  } finally {
    db.close()
  }
})

test('deleting an account removes its private inbox and tokens but retains the non-identifying event', () => {
  const db = createDatabase()
  try {
    db.prepare(`INSERT INTO notification_events
      (id, event_type, event_version, domain_type, domain_id, occurred_at, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('event-1', 'driver.offer.created', 1, 'trip_offer', 'offer-1', 10, '{}', 10)
    db.prepare(`INSERT INTO notification_push_tokens
      (id, user_id, token, platform, created_at, last_registered_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run('token-1', 'user-1', 'ExponentPushToken[device-1]', 'ios', 10, 10)
    db.prepare(`INSERT INTO notifications
      (id, event_id, recipient_user_id, template_key, route_key, priority, created_at, read_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('notification-1', 'event-1', 'user-1', 'driver_offer', 'driver_offers', 'time_sensitive', 10, null)
    db.prepare(`INSERT INTO notification_outbox
      (delivery_id, notification_id, event_id, recipient_user_id, status, not_before, attempt_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('delivery-1', 'notification-1', 'event-1', 'user-1', 'pending', 10, 0, 10)
    db.prepare(`INSERT INTO notification_deliveries
      (id, delivery_id, push_token_id, platform, status, attempt_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('device-delivery-1', 'delivery-1', 'token-1', 'ios', 'queued', 0, 10, 10)

    db.prepare('DELETE FROM user WHERE id = ?').run('user-1')

    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM notification_push_tokens WHERE user_id = ?').get('user-1').count, 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE recipient_user_id = ?').get('user-1').count, 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM notification_outbox WHERE recipient_user_id = ?').get('user-1').count, 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM notification_events WHERE id = ?').get('event-1').count, 1)
  } finally {
    db.close()
  }
})

test('notification history has no automatic cleanup trigger or delete schedule in the migration', () => {
  const migration = readFileSync(notificationMigrationPath, 'utf8')
  assert.doesNotMatch(migration, /CREATE\s+TRIGGER|ON\s+DELETE\s+CASCADE\s+ON\s+notification_events/iu)
  assert.doesNotMatch(migration, /expires_at\s*<\s*CURRENT_TIMESTAMP|DELETE\s+FROM\s+notifications/iu)
})

test('creating an event atomically stores the event, private inbox row, and push outbox item', async () => {
  const db = createDatabase()
  try {
    const { createNotificationEvent } = loadNotificationStore()
    const result = await createNotificationEvent(createD1Adapter(db), sampleEvent(), 10)
    assert.equal(result.eventId, 'event-1')
    assert.equal(result.notifications.length, 1)
    assert.equal(result.notifications[0].userId, 'user-1')
    assert.ok(result.notifications[0].id)
    assert.ok(result.notifications[0].deliveryId)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM notification_events').get().count, 1)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM notifications').get().count, 1)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM notification_outbox').get().count, 1)
  } finally {
    db.close()
  }
})

test('ordinary pushes respect the Africa/Kampala night quiet hours while urgent and driver offers bypass them', async () => {
  const db = createDatabase()
  try {
    const { createNotificationEvent } = loadNotificationStore()
    const now = Date.parse('2026-10-14T19:00:00.000Z')
    const event = {
      id: 'ordinary-1', eventType: 'booking.quote_requested', eventVersion: 1,
      domainType: 'trip_offer', domainId: 'offer-1', occurredAt: now,
      expiresAt: now + 24 * 60 * 60 * 1000,
      recipients: [{ userId: 'user-1', role: 'client' }],
    }
    await createNotificationEvent(createD1Adapter(db), event, now)
    const delayed = db.prepare('SELECT not_before AS notBefore FROM notification_outbox WHERE event_id = ?').get(event.id).notBefore
    assert.equal(delayed, Date.parse('2026-10-15T05:00:00.000Z'), '22:00 Kampala should wait until 08:00')

    const quietHourBoundaries = [
      { id: 'before-quiet-hours', at: '2026-10-14T17:59:00.000Z', expected: '2026-10-14T17:59:00.000Z' }, // 20:59 EAT
      { id: 'quiet-hours-start', at: '2026-10-14T18:00:00.000Z', expected: '2026-10-15T05:00:00.000Z' }, // 21:00 EAT
      { id: 'quiet-hours-end-minus-one', at: '2026-10-15T04:59:00.000Z', expected: '2026-10-15T05:00:00.000Z' }, // 07:59 EAT
      { id: 'quiet-hours-end', at: '2026-10-15T05:00:00.000Z', expected: '2026-10-15T05:00:00.000Z' }, // 08:00 EAT
    ]
    for (const boundary of quietHourBoundaries) {
      const boundaryTime = Date.parse(boundary.at)
      await createNotificationEvent(createD1Adapter(db), {
        id: boundary.id, eventType: 'booking.quote_requested', eventVersion: 1,
        domainType: 'trip_offer', domainId: `offer-${boundary.id}`, occurredAt: boundaryTime,
        expiresAt: boundaryTime + 24 * 60 * 60 * 1000,
        recipients: [{ userId: 'user-1', role: 'client' }],
      }, boundaryTime)
      const actual = db.prepare('SELECT not_before AS notBefore FROM notification_outbox WHERE event_id = ?').get(boundary.id).notBefore
      assert.equal(actual, Date.parse(boundary.expected), `${boundary.at} should follow the Kampala quiet-hours boundary`)
    }

    const urgentNow = Date.parse('2026-10-14T20:00:00.000Z')
    await createNotificationEvent(createD1Adapter(db), {
      id: 'urgent-1', eventType: 'payment.balance_due', eventVersion: 1,
      domainType: 'payment', domainId: 'payment-1', occurredAt: urgentNow,
      recipients: [{ userId: 'user-1', role: 'client' }],
    }, urgentNow)
    const urgent = db.prepare('SELECT not_before AS notBefore FROM notification_outbox WHERE event_id = ?').get('urgent-1').notBefore
    assert.equal(urgent, urgentNow)

    const offerNow = Date.parse('2026-10-14T20:00:00.000Z')
    await createNotificationEvent(createD1Adapter(db), {
      id: 'offer-1', eventType: 'booking.driver_offer_created', eventVersion: 1,
      domainType: 'trip_offer', domainId: 'offer-2', occurredAt: offerNow,
      expiresAt: offerNow + 15 * 60 * 1000,
      recipients: [{ userId: 'user-2', role: 'driver' }],
    }, offerNow)
    const offer = db.prepare('SELECT not_before AS notBefore FROM notification_outbox WHERE event_id = ?').get('offer-1').notBefore
    assert.equal(offer, offerNow)
  } finally {
    db.close()
  }
})

test('notification statements can join a domain transition in the same D1 transaction', async () => {
  const db = createDatabase()
  try {
    db.exec('CREATE TABLE sample_domain_state (id TEXT PRIMARY KEY, status TEXT NOT NULL)')
    db.prepare('INSERT INTO sample_domain_state (id, status) VALUES (?, ?)').run('domain-1', 'pending')
    const { buildNotificationEventStatements } = loadNotificationStore()
    const d1 = createD1Adapter(db)
    await d1.batch([
      d1.prepare('UPDATE sample_domain_state SET status = ? WHERE id = ?').bind('accepted', 'domain-1'),
      ...buildNotificationEventStatements(d1, sampleEvent(), 10),
    ])
    assert.equal(db.prepare('SELECT status FROM sample_domain_state WHERE id = ?').get('domain-1').status, 'accepted')
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM notifications').get().count, 1)
  } finally {
    db.close()
  }
})

test('domain transition rolls back when an atomic notification statement fails', async () => {
  const db = createDatabase()
  try {
    db.exec('CREATE TABLE sample_domain_state (id TEXT PRIMARY KEY, status TEXT NOT NULL)')
    db.prepare('INSERT INTO sample_domain_state (id, status) VALUES (?, ?)').run('domain-1', 'pending')
    const { buildNotificationEventStatements } = loadNotificationStore()
    const d1 = createD1Adapter(db, { failAtBatchStatement: 3 })
    await assert.rejects(
      d1.batch([
        d1.prepare('UPDATE sample_domain_state SET status = ? WHERE id = ?').bind('accepted', 'domain-1'),
        ...buildNotificationEventStatements(d1, sampleEvent(), 10),
      ]),
      /injected batch failure/u,
    )
    assert.equal(db.prepare('SELECT status FROM sample_domain_state WHERE id = ?').get('domain-1').status, 'pending')
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM notification_events').get().count, 0)
  } finally {
    db.close()
  }
})

test('gated notification statements do nothing when the preceding domain transition changed no row', async () => {
  const db = createDatabase()
  try {
    const { buildNotificationEventStatements } = loadNotificationStore()
    const d1 = createD1Adapter(db)
    await d1.batch([
      d1.prepare('UPDATE user SET name = ? WHERE id = ?').bind('Missing', 'missing-user'),
      ...buildNotificationEventStatements(d1, sampleEvent(), 10, { requirePriorChange: true }),
    ])
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM notification_events').get().count, 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM notifications').get().count, 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM notification_outbox').get().count, 0)
  } finally {
    db.close()
  }
})

test('replaying the same event idempotently returns its original inbox and outbox rows', async () => {
  const db = createDatabase()
  try {
    const { createNotificationEvent } = loadNotificationStore()
    const d1 = createD1Adapter(db)
    const first = await createNotificationEvent(d1, sampleEvent(), 10)
    const replay = await createNotificationEvent(d1, sampleEvent(), 11)
    assert.equal(JSON.stringify(replay), JSON.stringify(first))
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM notification_events').get().count, 1)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM notifications').get().count, 1)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM notification_outbox').get().count, 1)
  } finally {
    db.close()
  }
})

test('event, inbox, and outbox writes roll back together when an outbox statement fails', async () => {
  const db = createDatabase()
  try {
    const { createNotificationEvent } = loadNotificationStore()
    await assert.rejects(
      createNotificationEvent(createD1Adapter(db, { failAtBatchStatement: 3 }), sampleEvent(), 10),
      /injected batch failure/u,
    )
    for (const table of ['notification_events', 'notifications', 'notification_outbox']) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, `${table} rolled back`)
    }
  } finally {
    db.close()
  }
})

test('inbox list and read actions stay scoped to the signed-in user', async () => {
  const db = createDatabase()
  try {
    const { createNotificationEvent, listNotifications, markAllNotificationsRead, markNotificationRead } = loadNotificationStore()
    const d1 = createD1Adapter(db)
    await createNotificationEvent(d1, sampleEvent(), 10)
    await createNotificationEvent(d1, sampleEvent({ id: 'event-2', recipient: 'user-1', occurredAt: 11, expiresAt: 21 }), 11)

    const page = await listNotifications(d1, 'user-1', null, 1)
    const otherUserPage = await listNotifications(d1, 'user-2', null, 20)
    assert.equal(page.items.length, 1)
    assert.equal(page.items[0].eventId, 'event-2')
    assert.equal(page.unreadCount, 2)
    assert.equal(otherUserPage.items.length, 0)
    assert.equal(otherUserPage.unreadCount, 0)
    assert.equal(await markNotificationRead(d1, 'user-2', page.items[0].id, 12), false)
    assert.equal(await markNotificationRead(d1, 'user-1', page.items[0].id, 12), true)
    assert.equal(await markAllNotificationsRead(d1, 'user-2', 13), 0)
    assert.equal(await markAllNotificationsRead(d1, 'user-1', 13), 1)
    assert.equal((await listNotifications(d1, 'user-1', null, 20)).unreadCount, 0)
  } finally {
    db.close()
  }
})

test('outbox dispatcher claims due work, reclaims expired leases, and marks stale offers expired', async () => {
  const db = createDatabase()
  try {
    const { claimDueNotificationDeliveries, createNotificationEvent } = loadNotificationStore()
    const d1 = createD1Adapter(db)
    await createNotificationEvent(d1, sampleEvent({ id: 'due', occurredAt: 10, expiresAt: 100 }), 10)
    await createNotificationEvent(d1, sampleEvent({ id: 'not-due', occurredAt: 10, expiresAt: 100 }), 10)
    await createNotificationEvent(d1, sampleEvent({ id: 'expired', occurredAt: 10, expiresAt: 15 }), 10)
    db.prepare('UPDATE notification_outbox SET not_before = ? WHERE event_id = ?').run(50, 'not-due')

    const firstClaim = await claimDueNotificationDeliveries(d1, 20, 30, 10)
    assert.deepEqual(firstClaim.map(row => row.eventId), ['due'])
    const reclaimed = await claimDueNotificationDeliveries(d1, 31, 41, 10)
    assert.deepEqual(reclaimed.map(row => row.eventId), ['due'])
    const stale = db.prepare('SELECT status FROM notification_outbox WHERE event_id = ?').get('expired')
    assert.equal(stale.status, 'expired')
  } finally {
    db.close()
  }
})
