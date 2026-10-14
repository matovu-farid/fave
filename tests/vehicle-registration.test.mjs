import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const migrationPath = fileURLToPath(new URL('../fave-worker/migrations/0018_vehicle_fare_benchmarks.sql', import.meta.url))

test('vehicle benchmark migration keeps legacy vehicles unpriced and validates submitted values', () => {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE vehicles (id TEXT PRIMARY KEY, make TEXT NOT NULL);
    INSERT INTO vehicles (id, make) VALUES ('legacy-1', 'Toyota');`)
  db.exec(readFileSync(migrationPath, 'utf8'))

  const legacy = db.prepare('SELECT benchmark_amount_ugx, benchmark_basis_json, benchmark_derivation_version FROM vehicles WHERE id = ?').get('legacy-1')
  assert.deepEqual({ ...legacy }, {
    benchmark_amount_ugx: null,
    benchmark_basis_json: null,
    benchmark_derivation_version: null,
  })
  assert.throws(() => db.prepare('INSERT INTO vehicles (id, make, benchmark_amount_ugx) VALUES (?, ?, ?)').run('invalid-1', 'Toyota', 0))
  assert.throws(() => db.prepare('INSERT INTO vehicles (id, make, benchmark_basis_json) VALUES (?, ?, ?)').run('invalid-2', 'Toyota', '{'))
  db.prepare('INSERT INTO vehicles (id, make, benchmark_amount_ugx, benchmark_basis_json, benchmark_derivation_version) VALUES (?, ?, ?, ?, ?)')
    .run('priced-1', 'Toyota', 400_000, JSON.stringify({ routeId: 'kampala-jinja', roundTripDistanceMeters: 160_000 }), 1)
  db.close()
})
