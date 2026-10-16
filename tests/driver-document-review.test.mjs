import test from 'node:test'
import assert from 'node:assert/strict'
import { availabilityFixture } from './helpers/availability-fixture.mjs'

const path = '/driver-app/documents/national_id_front/decision'
const reason = 'Evidence matches the approved checklist'

function pendingReview(t) {
  const f = availabilityFixture(t)
  f.grantReview()
  f.sql.exec("UPDATE driver_applications SET status = 'pending_verification'; UPDATE driver_application_documents SET review_status = 'pending'")
  return f
}

for (const [label, message] of [['omitted', {}], ['null', { applicantMessage: null }]]) {
  test(`staff can approve a document when the rejection message is ${label}`, async (t) => {
    const f = pendingReview(t)
    const result = await f.reviewDriver('POST', path, { body: { decision: 'approve', reason, ...message } })
    assert.equal(result.status, 200, JSON.stringify(result))
    assert.equal(result.body.status, 'approved')
    const document = f.sql.prepare("SELECT review_status, reviewer_reason, reviewed_by, reviewed_at FROM driver_application_documents WHERE id = 'national_id_front'").get()
    assert.deepEqual({ ...document }, { review_status: 'approved', reviewer_reason: reason, reviewed_by: 'staff', reviewed_at: f.clock.now })
    assert.equal(f.sql.prepare("SELECT status FROM driver_applications WHERE id = 'driver-app'").get().status, 'pending_verification')
    const audit = f.sql.prepare('SELECT action, actor_user_id, prior_state, new_state FROM marketplace_audit_events').all()
    assert.deepEqual(audit.map((row) => ({ ...row })), [{ action: 'driver_document_reviewed', actor_user_id: 'staff', prior_state: 'pending', new_state: 'approved' }])
  })
}

test('rejecting a document requires a driver-facing correction message without mutating evidence', async (t) => {
  const f = pendingReview(t)
  const result = await f.reviewDriver('POST', path, { body: { decision: 'reject', reason } })
  assert.equal(result.status, 400)
  assert.equal(f.sql.prepare("SELECT review_status FROM driver_application_documents WHERE id = 'national_id_front'").get().review_status, 'pending')
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM marketplace_audit_events').get().count, 0)
})

test('rejecting a document records the correction message and both audit transitions', async (t) => {
  const f = pendingReview(t)
  const result = await f.reviewDriver('POST', path, { body: { decision: 'reject', reason: 'Image is too blurred', applicantMessage: ' Please upload a clear photo. ' } })
  assert.equal(result.status, 200, JSON.stringify(result))
  const application = f.sql.prepare("SELECT status, applicant_message FROM driver_applications WHERE id = 'driver-app'").get()
  assert.deepEqual({ ...application }, { status: 'needs_correction', applicant_message: 'Please upload a clear photo.' })
  assert.deepEqual(f.sql.prepare('SELECT action FROM marketplace_audit_events ORDER BY rowid').all().map((row) => row.action), ['driver_document_reviewed', 'driver_application_needs_correction'])
})

test('document approval remains restricted to staff and cannot review evidence twice', async (t) => {
  const f = pendingReview(t)
  for (const user of [null, 'client-1', 'driver']) {
    const result = await f.reviewDriver('POST', path, { user, body: { decision: 'approve', reason } })
    assert.equal(result.status, user ? 403 : 401)
  }
  assert.equal((await f.reviewDriver('POST', path, { body: { decision: 'approve', reason } })).status, 200)
  assert.equal((await f.reviewDriver('POST', path, { body: { decision: 'approve', reason } })).status, 409)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM marketplace_audit_events').get().count, 1)
})

for (const applicationStatus of ['approved', 'rejected', 'suspended', 'needs_correction']) {
  for (const decision of ['approve', 'reject']) {
    test(`${decision} conflicts without side effects if application becomes ${applicationStatus} before the write`, async (t) => {
      const f = pendingReview(t)
      const batch = f.DB.batch.bind(f.DB)
      f.DB.batch = async (statements) => {
        f.sql.prepare("UPDATE driver_applications SET status = ? WHERE id = 'driver-app'").run(applicationStatus)
        return batch(statements)
      }

      const result = await f.reviewDriver('POST', path, { body: { decision, reason, applicantMessage: 'Please upload a clear photo.' } })
      assert.equal(result.status, 409, JSON.stringify(result))
      assert.equal(f.sql.prepare("SELECT review_status FROM driver_application_documents WHERE id = 'national_id_front'").get().review_status, 'pending')
      assert.equal(f.sql.prepare("SELECT status FROM driver_applications WHERE id = 'driver-app'").get().status, applicationStatus)
      assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM marketplace_audit_events').get().count, 0)
    })
  }
}

test('a concurrent decision by the same staff member in the same millisecond cannot count as this write', async (t) => {
  const f = pendingReview(t)
  const batch = f.DB.batch.bind(f.DB)
  f.DB.batch = async (statements) => {
    f.sql.prepare("UPDATE driver_application_documents SET review_status = 'approved', reviewed_by = 'staff', reviewed_at = ?, reviewer_reason = 'First review' WHERE id = 'national_id_front'").run(f.clock.now)
    f.insert('marketplace_audit_events', { id: 'first-review', actor_user_id: 'staff', action: 'driver_document_reviewed', target_type: 'driver_application_document', target_id: 'national_id_front', reason: 'First review', prior_state: 'pending', new_state: 'approved', created_at: f.clock.now })
    return batch(statements)
  }
  const result = await f.reviewDriver('POST', path, { body: { decision: 'approve', reason } })
  assert.equal(result.status, 409, JSON.stringify(result))
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM marketplace_audit_events').get().count, 1)
  assert.equal(f.sql.prepare("SELECT reviewer_reason FROM driver_application_documents WHERE id = 'national_id_front'").get().reviewer_reason, 'First review')
})
