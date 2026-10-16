import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const migrationsDirectory = fileURLToPath(new URL('../fave-worker/migrations/', import.meta.url))

function databaseWithMigrations() {
  const db = new DatabaseSync(':memory:')
  for (const filename of readdirSync(migrationsDirectory).filter((file) => file.endsWith('.sql')).sort()) {
    db.exec(readFileSync(`${migrationsDirectory}/${filename}`, 'utf8'))
  }
  return db
}

test('staff availability request records reference an immutable saved estimate', () => {
  const db = databaseWithMigrations()
  db.exec(`
    INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
    VALUES ('client', 'Client', 'client@example.com', 1, 1, 1);
    INSERT INTO driver_applications (id, user_id, legal_name, phone_e164, national_id_number,
      national_id_last4, status, created_at, updated_at, lodging_rate_ugx)
    VALUES ('driver-app', 'client', 'Driver', '+256700000000', 'national-id', '0000', 'approved', 1, 1, 42000);
    INSERT INTO vehicles (id, driver_application_id, make, model, model_year, passenger_capacity,
      luggage_capacity, comfort_details, registration_number, status, created_at, updated_at)
    VALUES ('vehicle', 'driver-app', 'Make', 'Model', 2020, 4, 2, 'Comfortable', 'UAA000A', 'approved', 1, 1);
    INSERT INTO fare_policies (id, version, currency, rules_json, quote_ttl_seconds, hold_ttl_seconds,
      active, approved_at, effective_at)
    VALUES ('policy', 'v1', 'UGX', '{}', 3600, 600, 1, 1, 1);
    INSERT INTO trip_estimates (id, client_user_id, vehicle_id, driver_application_id, policy_id,
      origin_json, destination_json, start_date, end_date, party_size, luggage_count, snapshot_json, created_at)
    VALUES ('estimate', 'client', 'vehicle', 'driver-app', 'policy', '{}', '{}', '2099-01-01',
      '2099-01-03', 1, 0, '{"totalAmount":42}', 1);
    INSERT INTO availability_requests (id, estimate_id, client_user_id, vehicle_id, driver_application_id,
      start_date, end_date, status, created_at, updated_at)
    VALUES ('request', 'estimate', 'client', 'vehicle', 'driver-app', '2099-01-01', '2099-01-03', 'requested', 2, 2);
  `)

  assert.throws(() => db.exec(`UPDATE trip_estimates SET snapshot_json = '{"totalAmount":1}' WHERE id = 'estimate'`), /immutable/)
  assert.throws(() => db.exec(`INSERT INTO availability_requests (id, estimate_id, client_user_id, vehicle_id, driver_application_id, start_date, end_date, status, created_at, updated_at) VALUES ('duplicate', 'estimate', 'client', 'vehicle', 'driver-app', '2099-01-01', '2099-01-03', 'requested', 3, 3)`), /UNIQUE/)
  db.close()
})

test('pending staff requests do not reserve a vehicle and decisions are date specific', () => {
  const db = databaseWithMigrations()
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
  assert.ok(tables.includes('availability_requests'))
  assert.ok(tables.includes('availability_request_calls'))
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((row) => row.name)
  assert.ok(indexes.includes('availability_requests_vehicle_dates'))
  db.close()
})
