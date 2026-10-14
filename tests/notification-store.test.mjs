import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const authMigrationPath = fileURLToPath(new URL('../fave-worker/migrations/0001_better_auth.sql', import.meta.url))
const tokenMigrationPath = fileURLToPath(new URL('../fave-worker/migrations/0016_notification_push_tokens.sql', import.meta.url))
const notificationMigrationPath = fileURLToPath(new URL('../fave-worker/migrations/0017_notifications.sql', import.meta.url))

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
