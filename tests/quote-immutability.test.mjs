import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const migrationPath = fileURLToPath(new URL('../fave-worker/migrations/0004_immutable_quote_snapshots.sql', import.meta.url))

function createDatabase() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE trip_quotes (
      id TEXT PRIMARY KEY,
      client_user_id TEXT NOT NULL,
      vehicle_id TEXT NOT NULL,
      policy_id TEXT NOT NULL,
      origin_json TEXT NOT NULL,
      destination_json TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      party_size INTEGER NOT NULL,
      luggage_count INTEGER NOT NULL,
      route_distance_meters INTEGER NOT NULL,
      route_duration_seconds INTEGER NOT NULL,
      quote_json TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      terms_snapshot_json TEXT,
      contact_share_consented_at INTEGER
    );
    CREATE TABLE bookings (
      id TEXT PRIMARY KEY,
      quote_snapshot_json TEXT NOT NULL,
      status TEXT NOT NULL
    );
  `)
  db.exec(readFileSync(migrationPath, 'utf8'))
  return db
}

test('trip quote and booking fare snapshots cannot be overwritten', () => {
  const db = createDatabase()
  try {
    db.prepare(`INSERT INTO trip_quotes
      (id, client_user_id, vehicle_id, policy_id, origin_json, destination_json,
       start_date, end_date, party_size, luggage_count, route_distance_meters,
       route_duration_seconds, quote_json, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('quote-1', 'client-1', 'vehicle-1', 'policy-1', '{}', '{}', '2026-11-01', '2026-11-02', 1, 0, 1000, 60, '{"totalAmount":100}', 999, 1)
    db.prepare('INSERT INTO bookings (id, quote_snapshot_json, status) VALUES (?, ?, ?)')
      .run('booking-1', '{"totalAmount":100}', 'confirmed')

    assert.throws(
      () => db.prepare('UPDATE trip_quotes SET quote_json = ? WHERE id = ?').run('{"totalAmount":1}', 'quote-1'),
      /trip quote fare snapshot is immutable/u,
    )
    assert.throws(
      () => db.prepare('UPDATE bookings SET quote_snapshot_json = ? WHERE id = ?').run('{"totalAmount":1}', 'booking-1'),
      /booking fare snapshot is immutable/u,
    )

    db.prepare('UPDATE trip_quotes SET terms_snapshot_json = ?, contact_share_consented_at = ? WHERE id = ?')
      .run('{"accepted":true}', 123, 'quote-1')
    assert.equal(db.prepare('SELECT terms_snapshot_json FROM trip_quotes WHERE id = ?').get('quote-1').terms_snapshot_json, '{"accepted":true}')
    assert.equal(db.prepare('SELECT quote_json FROM trip_quotes WHERE id = ?').get('quote-1').quote_json, '{"totalAmount":100}')
  } finally {
    db.close()
  }
})
