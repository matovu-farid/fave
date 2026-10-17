import test from 'node:test'
import assert from 'node:assert/strict'
import { availabilityFixture } from './helpers/availability-fixture.mjs'

function evidenceFixture(t) {
  const f = availabilityFixture(t)
  const objects = new Map()
  const deleted = []
  for (const row of f.sql.prepare('SELECT object_key FROM driver_application_documents UNION SELECT object_key FROM vehicle_media').all()) objects.set(row.object_key, 'synthetic evidence')
  const bucket = {
    fail: false,
    async put(key) { objects.set(key, 'new synthetic evidence') },
    async delete(keys) {
      if (bucket.fail) throw new Error('synthetic storage failure')
      for (const key of Array.isArray(keys) ? keys : [keys]) { deleted.push(key); objects.delete(key) }
    },
  }
  const env = { DB: f.DB, DRIVER_FILES: bucket, DRIVER_ID_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') }
  const drivers = f.loadWorkerModule('drivers')
  const vehicles = f.loadWorkerModule('vehicles')
  const submit = async () => {
    const form = new FormData()
    for (const [key, value] of Object.entries({ legalName: 'Synthetic Driver', phoneNumber: '+256700000001', lodgingRateUgx: '42000', nationalIdNumber: 'TEST-ONLY-NEW-ID', citizenshipConfirmation: 'ugandan_citizen' })) form.set(key, value)
    for (const type of ['national_id_front', 'national_id_back', 'passport_photo']) form.set(`evidence:${type}`, new File([new Uint8Array([0xff, 0xd8, 0xff, 0])], `${type}.jpg`, { type: 'image/jpeg' }))
    const response = await drivers.driversApp.request('https://fave.test/application', { method: 'POST', headers: { 'x-test-user': 'driver' }, body: form }, env)
    return { status: response.status, body: await response.json() }
  }
  const interceptSelection = (matches, after) => {
    const prepare = f.DB.prepare.bind(f.DB)
    let intercepted = false
    f.DB.prepare = query => {
      const statement = prepare(query)
      if (matches(query)) {
        const all = statement.all.bind(statement)
        statement.all = async () => {
          const result = await all()
          if (!intercepted) { intercepted = true; await after() }
          return result
        }
      }
      return statement
    }
  }
  return { ...f, env, bucket, objects, deleted, submit, interceptSelection,
    purgeDriver: () => drivers.purgeExpiredDriverEvidence(env),
    purgeVehicle: () => vehicles.purgeExpiredVehicleEvidence(env) }
}

test('resubmission preserves prior evidence deadlines and collection metadata', async t => {
  const f = evidenceFixture(t)
  f.sql.exec("UPDATE driver_applications SET status='needs_correction'; UPDATE driver_application_documents SET retention_policy_id='retention'")
  const prior = f.sql.prepare('SELECT id, object_key, created_at, retention_expires_at, retention_policy_id FROM driver_application_documents ORDER BY id').all()
  f.clock.now += 86400000
  const result = await f.submit()
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.equal(f.sql.prepare('SELECT submission_version FROM driver_applications').get().submission_version, 2)
  assert.deepEqual(f.sql.prepare('SELECT id, object_key, created_at, retention_expires_at, retention_policy_id FROM driver_application_documents WHERE submission_version=1 ORDER BY id').all(), prior)
  await f.purgeDriver()
  for (const row of prior) assert.ok(f.objects.has(row.object_key))
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM driver_application_documents WHERE submission_version=2').get().n, 3)
  f.grantReview()
  const approval = await f.reviewDriver('POST', '/driver-app/decision', { body: { decision: 'approve', reason: 'Synthetic review' } })
  assert.equal(approval.status, 409, 'approved files from the old submission cannot approve the new one')
})

test('application expiry does not shorten a document own retention deadline', async t => {
  const f = evidenceFixture(t)
  f.sql.prepare('UPDATE driver_applications SET retention_expires_at=?').run(f.clock.now)
  const count = f.sql.prepare('SELECT COUNT(*) AS n FROM driver_application_documents').get().n
  await f.purgeDriver()
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM driver_application_documents').get().n, count)
  assert.deepEqual(f.deleted, [])
  assert.equal(f.sql.prepare('SELECT national_id_number FROM driver_applications').get().national_id_number, '')
})

test('a renewed driver document selected by an old purge keeps its object', async t => {
  const f = evidenceFixture(t)
  f.sql.prepare('UPDATE driver_application_documents SET retention_expires_at=? WHERE id=?').run(f.clock.now, 'national_id_front')
  f.interceptSelection(q => q.includes('FROM driver_application_documents AS document') && q.includes('LIMIT 100'), () => {
    f.sql.prepare('UPDATE driver_application_documents SET retention_expires_at=? WHERE id=?').run(f.clock.now + 86400000, 'national_id_front')
  })
  await f.purgeDriver()
  assert.ok(f.objects.has('national_id_front'))
  assert.ok(f.sql.prepare('SELECT id FROM driver_application_documents WHERE id=?').get('national_id_front'))
})

test('a renewed vehicle document selected by an old purge keeps the listing and object', async t => {
  const f = evidenceFixture(t)
  const row = f.sql.prepare("SELECT id, object_key FROM vehicle_media WHERE vehicle_id='car-1' AND media_kind='registration_document'").get()
  f.sql.prepare('UPDATE vehicle_media SET retention_expires_at=? WHERE id=?').run(f.clock.now, row.id)
  f.interceptSelection(q => q.includes('FROM vehicle_media') && q.includes("media_kind != 'client_photo'") && q.includes('LIMIT 50'), () => {
    f.sql.prepare('UPDATE vehicle_media SET retention_expires_at=? WHERE id=?').run(f.clock.now + 86400000, row.id)
  })
  await f.purgeVehicle()
  assert.ok(f.objects.has(row.object_key))
  assert.equal(f.sql.prepare("SELECT status FROM vehicles WHERE id='car-1'").get().status, 'approved')
})

test('purging superseded vehicle proof does not pause a listing with current proof', async t => {
  const f = evidenceFixture(t)
  f.insert('vehicle_media', { id: 'old-proof', vehicle_id: 'car-1', media_kind: 'registration_document', object_key: 'old-proof', content_type: 'image/jpeg', byte_size: 1, review_status: 'approved', requirement_version: 'v1', retention_expires_at: f.clock.now, created_at: 1 })
  f.objects.set('old-proof', 'synthetic superseded evidence')
  await f.purgeVehicle()
  assert.equal(f.sql.prepare("SELECT status FROM vehicles WHERE id='car-1'").get().status, 'approved')
  assert.equal(f.objects.has('old-proof'), false)
})

test('failed retirement audit never removes an object still referenced by its evidence row', async t => {
  const f = evidenceFixture(t)
  f.sql.prepare('UPDATE driver_application_documents SET retention_expires_at=? WHERE id=?').run(f.clock.now, 'national_id_front')
  f.sql.exec("CREATE TRIGGER reject_retention_audit BEFORE INSERT ON marketplace_audit_events WHEN NEW.action LIKE 'driver_document_retention_%' BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END")
  await f.purgeDriver()
  assert.ok(f.sql.prepare('SELECT id FROM driver_application_documents WHERE id=?').get('national_id_front'))
  assert.ok(f.objects.has('national_id_front'))
})

test('storage failure leaves a durable deletion job and a later sweep completes it once', async t => {
  const f = evidenceFixture(t)
  f.sql.prepare('UPDATE driver_application_documents SET retention_expires_at=? WHERE id=?').run(f.clock.now, 'national_id_front')
  f.bucket.fail = true
  await f.purgeDriver()
  assert.equal(f.sql.prepare('SELECT id FROM driver_application_documents WHERE id=?').get('national_id_front'), undefined, 'retired proof must not remain an active evidence reference')
  assert.ok(f.objects.has('national_id_front'))
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM private_evidence_deletion_jobs').get().n, 1)
  assert.deepEqual({ ...f.sql.prepare('SELECT attempts, last_error_code FROM private_evidence_deletion_jobs').get() }, { attempts: 1, last_error_code: 'R2_DELETE_FAILED' })
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM marketplace_audit_events WHERE action='driver_document_retention_expired'").get().n, 0)
  f.bucket.fail = false
  await Promise.all([f.purgeDriver(), f.purgeDriver()])
  assert.equal(f.objects.has('national_id_front'), false)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM private_evidence_deletion_jobs').get().n, 0)
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM marketplace_audit_events WHERE action='driver_document_retention_expired'").get().n, 1)
})

test('failed resubmission rolls back the version and preserves existing objects', async t => {
  const f = evidenceFixture(t)
  f.sql.exec("UPDATE driver_applications SET status='needs_correction'; CREATE TRIGGER reject_submission BEFORE INSERT ON marketplace_audit_events WHEN NEW.action='driver_application_resubmitted' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END")
  const prior = f.sql.prepare('SELECT * FROM driver_application_documents ORDER BY id').all()
  const result = await f.submit()
  assert.equal(result.status, 503)
  assert.equal(f.sql.prepare('SELECT submission_version FROM driver_applications').get().submission_version, 1)
  assert.deepEqual(f.sql.prepare('SELECT * FROM driver_application_documents ORDER BY id').all(), prior)
  assert.equal(f.objects.size, 9, 'only the original three identity and six vehicle objects remain')
})

test('a shorter new application policy does not rebase old evidence expiry', async t => {
  const f = evidenceFixture(t)
  f.sql.exec("UPDATE driver_applications SET status='needs_correction'; UPDATE retention_policies SET retention_days=1")
  const originalExpiry = f.sql.prepare("SELECT retention_expires_at FROM driver_application_documents WHERE id='national_id_front'").get().retention_expires_at
  assert.equal((await f.submit()).status, 200)
  f.clock.now += 86400000
  await f.purgeDriver()
  assert.equal(f.sql.prepare("SELECT retention_expires_at FROM driver_application_documents WHERE id='national_id_front'").get().retention_expires_at, originalExpiry)
  assert.ok(f.objects.has('national_id_front'))
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM driver_application_documents WHERE submission_version=2').get().n, 0)
})

test('stale application redaction cannot erase a replacement submission identity', async t => {
  const f = evidenceFixture(t)
  f.sql.prepare('UPDATE driver_applications SET retention_expires_at=?').run(f.clock.now)
  f.interceptSelection(q => q.includes('FROM driver_applications') && q.includes('ORDER BY retention_expires_at'), () => {
    f.sql.prepare("UPDATE driver_applications SET submission_version=2, national_id_number='new-encrypted-fixture', national_id_last4='NEW2', retention_expires_at=?").run(f.clock.now + 86400000)
  })
  await f.purgeDriver()
  assert.equal(f.sql.prepare('SELECT national_id_number FROM driver_applications').get().national_id_number, 'new-encrypted-fixture')
  assert.deepEqual(f.deleted, [])
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM marketplace_audit_events WHERE action='driver_identity_evidence_retention_expired'").get().n, 0)
})

test('document expiry is inclusive at its own deadline and null expiry fails closed', async t => {
  const f = evidenceFixture(t)
  f.sql.prepare("UPDATE driver_application_documents SET retention_expires_at=? WHERE id='national_id_front'").run(f.clock.now + 1)
  f.sql.exec("UPDATE driver_application_documents SET retention_expires_at=NULL WHERE id='national_id_back'")
  await f.purgeDriver()
  assert.ok(f.objects.has('national_id_front'))
  f.clock.now += 1
  await f.purgeDriver()
  assert.equal(f.objects.has('national_id_front'), false)
  assert.ok(f.objects.has('national_id_back'))
})

test('expired current vehicle proof pauses the listing once and never retires public photos', async t => {
  const f = evidenceFixture(t)
  f.sql.prepare("UPDATE vehicle_media SET retention_expires_at=? WHERE vehicle_id='car-1'").run(f.clock.now)
  await f.purgeVehicle()
  await f.purgeVehicle()
  assert.equal(f.sql.prepare("SELECT status FROM vehicles WHERE id='car-1'").get().status, 'needs_correction')
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM vehicle_media WHERE vehicle_id='car-1' AND media_kind='client_photo'").get().n, 2)
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM marketplace_audit_events WHERE action='vehicle_evidence_expiry_requires_review'").get().n, 1)
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM marketplace_audit_events WHERE action='vehicle_evidence_retention_expired'").get().n, 1)
})

test('a completion audit failure preserves the cleanup job after R2 deletion for safe retry', async t => {
  const f = evidenceFixture(t)
  f.sql.prepare("UPDATE driver_application_documents SET retention_expires_at=? WHERE id='national_id_front'").run(f.clock.now)
  f.sql.exec("CREATE TRIGGER reject_completion BEFORE INSERT ON marketplace_audit_events WHEN NEW.action='driver_document_retention_expired' BEGIN SELECT RAISE(ABORT, 'synthetic completion failure'); END")
  await f.purgeDriver()
  assert.equal(f.objects.has('national_id_front'), false)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM private_evidence_deletion_jobs').get().n, 1)
  f.sql.exec('DROP TRIGGER reject_completion')
  await f.purgeDriver()
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM private_evidence_deletion_jobs').get().n, 0)
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM marketplace_audit_events WHERE action='driver_document_retention_expired'").get().n, 1)
})

test('cleanup will not delete an object still referenced by another evidence row', async t => {
  const f = evidenceFixture(t)
  f.insert('private_evidence_deletion_jobs', { id: 'restored-job', target_type: 'driver_application_document', target_id: 'old-row', object_key: 'national_id_front', created_at: f.clock.now })
  await f.purgeDriver()
  assert.ok(f.objects.has('national_id_front'))
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM private_evidence_deletion_jobs').get().n, 1)
  assert.deepEqual(f.deleted, [])
})

test('persistent failures cannot starve later object deletions beyond one batch', async t => {
  const f = evidenceFixture(t)
  for (let n = 0; n < 101; n += 1) f.insert('private_evidence_deletion_jobs', {
    id: `job-${String(n).padStart(3, '0')}`, target_type: 'driver_application_document',
    target_id: `retired-${n}`, object_key: n === 100 ? 'later-success' : `fails-${n}`, created_at: f.clock.now + n,
  })
  f.objects.set('later-success', 'synthetic expired object')
  f.bucket.delete = async key => {
    if (key !== 'later-success') throw new Error('synthetic permanent per-key failure')
    f.objects.delete(key)
  }
  await f.purgeDriver()
  f.clock.now += 1
  await f.purgeDriver()
  assert.equal(f.objects.has('later-success'), false)
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM private_evidence_deletion_jobs WHERE object_key='later-success'").get().n, 0)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM private_evidence_deletion_jobs').get().n, 100)
})
