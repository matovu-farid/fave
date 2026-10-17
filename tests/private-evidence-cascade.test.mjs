import test from 'node:test'
import assert from 'node:assert/strict'
import { availabilityFixture } from './helpers/availability-fixture.mjs'

const counts = f => Object.fromEntries(['user', 'driver_applications', 'driver_application_documents', 'vehicles', 'vehicle_media', 'private_evidence_deletion_jobs'].map(table => [table, f.sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]))
const document = f => f.sql.prepare('SELECT id, object_key FROM driver_application_documents ORDER BY id LIMIT 1').get()
const media = f => f.sql.prepare("SELECT id, object_key FROM vehicle_media WHERE media_kind='registration_document' ORDER BY id LIMIT 1").get()
function job(f, type, row, overrides = {}) {
  f.insert('private_evidence_deletion_jobs', { id: `cleanup-${row.id}`, target_type: type, target_id: row.id, object_key: row.object_key, created_at: f.clock.now, ...overrides })
}

for (const [label, query] of [
  ['identity', "DELETE FROM user WHERE id='driver'"],
  ['driver application', "DELETE FROM driver_applications WHERE id='driver-app'"],
  ['vehicle', "DELETE FROM vehicles WHERE id='car-1'"],
  ['driver document', "DELETE FROM driver_application_documents WHERE document_type='national_id_front'"],
  ['private vehicle evidence', "DELETE FROM vehicle_media WHERE media_kind='registration_document'"],
  ['client-facing photo source', "DELETE FROM vehicle_media WHERE media_kind='client_photo'"],
]) {
  test(`deleting ${label} cannot discard object keys without durable cleanup`, t => {
    const f = availabilityFixture(t), before = counts(f)
    assert.throws(() => f.sql.exec(query), /evidence cleanup required/u)
    assert.deepEqual(counts(f), before, 'an aborted cascade must preserve every affected row')
  })
}

for (const type of ['driver_application_document', 'vehicle_media']) {
  for (const mismatch of ['target_id', 'target_type', 'object_key']) {
    test(`${type} deletion requires a cleanup job matching ${mismatch}`, t => {
      const f = availabilityFixture(t), row = type === 'vehicle_media' ? media(f) : document(f)
      const table = type === 'vehicle_media' ? 'vehicle_media' : 'driver_application_documents'
      job(f, type, row, { [mismatch]: mismatch === 'target_type' ? type === 'vehicle_media' ? 'driver_application_document' : 'vehicle_media' : 'unrelated-synthetic-value' })
      assert.throws(() => f.sql.prepare(`DELETE FROM ${table} WHERE id=?`).run(row.id), /evidence cleanup required/u)
      assert.ok(f.sql.prepare(`SELECT id FROM ${table} WHERE id=?`).get(row.id))
    })
  }
}

test('one prepared cleanup job cannot authorize a multi-row cascade and the batch rolls back', async t => {
  const f = availabilityFixture(t), before = counts(f), row = document(f)
  await assert.rejects(f.DB.batch([
    f.DB.prepare(`INSERT INTO private_evidence_deletion_jobs (id,target_type,target_id,object_key,created_at)
      VALUES (?,'driver_application_document',?,?,?)`).bind('cleanup-one', row.id, row.object_key, f.clock.now),
    f.DB.prepare("DELETE FROM user WHERE id='driver'"),
  ]), /evidence cleanup required/u)
  assert.deepEqual(counts(f), before)
})

test('matched durable jobs survive parent deletion, storage failure and a successful cleanup retry', async t => {
  const f = availabilityFixture(t)
  const files = [
    ...f.sql.prepare('SELECT id,object_key FROM driver_application_documents').all().map(row => ({ ...row, type: 'driver_application_document' })),
    ...f.sql.prepare('SELECT id,object_key FROM vehicle_media').all().map(row => ({ ...row, type: 'vehicle_media' })),
  ]
  const stored = new Set(files.map(row => row.object_key))
  for (const row of files) job(f, row.type, row)
  f.sql.prepare('DELETE FROM user WHERE id=?').run('driver')
  assert.equal(counts(f).driver_application_documents, 0)
  assert.equal(counts(f).vehicle_media, 0)
  assert.equal(counts(f).private_evidence_deletion_jobs, files.length)

  let unavailable = true
  const env = { DB: f.DB, DRIVER_FILES: { async delete(key) { if (unavailable) throw Error('Synthetic unavailable storage'); stored.delete(key) } } }
  const { deleteRetiredEvidence } = f.loadWorkerModule('private-evidence-retention')
  for (const type of ['driver_application_document', 'vehicle_media']) assert.equal(await deleteRetiredEvidence(env, type), 0)
  assert.equal(counts(f).private_evidence_deletion_jobs, files.length)
  assert.equal(stored.size, files.length)
  unavailable = false
  let removed = 0
  for (const type of ['driver_application_document', 'vehicle_media']) removed += await deleteRetiredEvidence(env, type)
  assert.equal(removed, files.length)
  assert.equal(stored.size, 0)
  assert.equal(counts(f).private_evidence_deletion_jobs, 0)
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM marketplace_audit_events WHERE new_state='deleted'").get().n, files.length)
})
