import test from 'node:test'
import assert from 'node:assert/strict'
import { availabilityFixture } from './helpers/availability-fixture.mjs'

const actions = [
  { target: 'document', decision: 'approve' },
  { target: 'document', decision: 'reject' },
  { target: 'application', decision: 'approve' },
  { target: 'application', decision: 'reject' },
  { target: 'application', decision: 'suspend' },
]

const revocations = [
  { name: 'original proof deletion', revoke: f => f.sql.exec('DELETE FROM review_session_proofs') },
  { name: 'proof expiry', revoke: f => f.sql.prepare('UPDATE review_session_proofs SET expires_at = ?').run(f.clock.now) },
  { name: 'session deletion', revoke: f => f.sql.exec("DELETE FROM session WHERE id = 'staff-session'") },
  { name: 'session expiry', revoke: f => f.sql.prepare("UPDATE session SET expiresAt = ? WHERE id = 'staff-session'").run(f.clock.now) },
  { name: 'reviewer revocation', revoke: f => f.sql.exec("UPDATE review_memberships SET active = 0 WHERE user_id = 'staff'") },
  { name: 'passkey removal', revoke: f => f.sql.exec("DELETE FROM passkey WHERE id = 'staff-key'") },
  { name: 'authenticator removal', method: 'totp', revoke: f => f.sql.exec("DELETE FROM twoFactor WHERE id = 'staff-key'") },
  { name: 'authenticator disablement', method: 'totp', revoke: f => f.sql.exec("UPDATE user SET twoFactorEnabled = 0 WHERE id = 'staff'") },
  { name: 'authenticator verification removal', method: 'totp', revoke: f => f.sql.exec("UPDATE twoFactor SET verified = 0 WHERE id = 'staff-key'") },
  { name: 'proof origin change', revoke: f => f.sql.exec("UPDATE review_session_proofs SET origin = 'https://other.test'") },
  { name: 'replacement proof', revoke: f => f.sql.exec('UPDATE review_session_proofs SET verified_at = verified_at + 1, expires_at = expires_at + 1') },
  {
    name: 'lock followed by a later unlock',
    revoke(f) {
      f.insert('review_session_locks', { session_id: 'staff-session', user_id: 'staff', generation: 1, locked_at: f.clock.now })
      f.sql.exec('DELETE FROM review_session_proofs')
      // Even a same-millisecond fresh proof cannot revive the original action.
      f.insert('review_session_proofs', {
        session_id: 'staff-session', source_session_id: 'staff-session', user_id: 'staff',
        origin: 'https://fave.test', method: 'passkey', credential_id: 'staff-key',
        verified_at: f.clock.now, expires_at: f.clock.now + 600000,
      })
    },
  },
]

function decisionFixture(t, action, method = 'passkey') {
  const f = availabilityFixture(t)
  f.grantReview('staff', method)
  // Credential removal is permitted only while another usable method remains.
  f.insert('passkey', { id: 'staff-backup-key', userId: 'staff', publicKey: 'synthetic-backup', credentialID: 'staff-backup-credential', counter: 0, deviceType: 'multiDevice', backedUp: 1 })
  if (action.decision !== 'suspend') f.sql.exec("UPDATE driver_applications SET status = 'pending_verification'")
  if (action.target === 'document') f.sql.exec("UPDATE driver_application_documents SET review_status = 'pending'")
  return f
}

function reviewState(f) {
  return {
    applications: f.sql.prepare('SELECT * FROM driver_applications ORDER BY id').all(),
    documents: f.sql.prepare('SELECT * FROM driver_application_documents ORDER BY id').all(),
    audits: f.sql.prepare('SELECT * FROM marketplace_audit_events ORDER BY id').all(),
  }
}

function decide(f, action) {
  const path = action.target === 'document'
    ? '/driver-app/documents/national_id_front/decision'
    : '/driver-app/decision'
  return f.reviewDriver('POST', path, {
    body: { expectedVersion: 0, confirmed: true, decision: action.decision, reason: 'Synthetic review reason', applicantMessage: 'Please provide a clearer document.' },
  })
}

test('locking a rotated proof source cannot revive document rejection through a same-millisecond unlock on the current session', async t => {
  const action = { target: 'document', decision: 'reject' }
  const f = decisionFixture(t, action)
  f.sql.exec("UPDATE review_session_proofs SET source_session_id = 'staff-original-session'")
  const proof = f.sql.prepare("SELECT * FROM review_session_proofs WHERE session_id = 'staff-session'").get()
  const before = reviewState(f)
  const batch = f.DB.batch.bind(f.DB)
  let crossedBoundary = false
  f.DB.batch = async statements => {
    crossedBoundary = true
    f.insert('review_session_locks', { session_id: 'staff-original-session', user_id: 'staff', generation: 1, locked_at: f.clock.now })
    f.sql.exec('DELETE FROM review_session_proofs')
    // A later unlock from the rotated session can match every timestamp and
    // credential while changing the source. It cannot authorize this old action.
    f.insert('review_session_proofs', { ...proof, source_session_id: 'staff-session' })
    return batch(statements)
  }
  const result = await decide(f, action)
  assert.equal(crossedBoundary, true)
  assert.deepEqual(reviewState(f), before, 'The rotated source lock must prevent document, correction and audit writes')
  assert.equal(result.status, 428, JSON.stringify(result))
  assert.equal(result.body.error.code, 'REVIEW_UNLOCK_REQUIRED')
})

for (const action of actions) {
  test(`authorized driver ${action.target} ${action.decision} still records its decision and audit`, async t => {
    const f = decisionFixture(t, action)
    const result = await decide(f, action)
    assert.equal(result.status, 200, JSON.stringify(result))
    assert.equal(result.body.status, action.decision === 'approve' ? 'approved' : action.decision === 'reject' ? 'rejected' : 'suspended')
    const application = f.sql.prepare("SELECT status, applicant_message FROM driver_applications WHERE id = 'driver-app'").get()
    if (action.target === 'application') assert.equal(application.status, result.body.status)
    else {
      assert.equal(f.sql.prepare("SELECT review_status FROM driver_application_documents WHERE id = 'national_id_front'").get().review_status, result.body.status)
      assert.equal(application.status, action.decision === 'reject' ? 'needs_correction' : 'pending_verification')
    }
    if (action.decision === 'reject') assert.equal(application.applicant_message, 'Please provide a clearer document.')
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM marketplace_audit_events').get().count,
      action.target === 'document' && action.decision === 'reject' ? 2 : 1)
  })

  for (const revocation of revocations) {
    test(`driver ${action.target} ${action.decision} cannot write after ${revocation.name} at the decision batch`, async t => {
      const f = decisionFixture(t, action, revocation.method)
      const before = reviewState(f)
      const batch = f.DB.batch.bind(f.DB)
      let crossedBoundary = false
      f.DB.batch = async statements => {
        crossedBoundary = true
        revocation.revoke(f)
        return batch(statements)
      }

      const result = await decide(f, action)
      assert.equal(crossedBoundary, true, 'The request must pass entry authorization and reach the decision transaction')
      // Check writes first: response middleware must not mask an unauthorized commit.
      assert.deepEqual(reviewState(f), before, 'Revoked review must preserve documents, application corrections and audits')
      assert.equal(result.status, 428, JSON.stringify(result))
      assert.equal(result.body.error.code, 'REVIEW_UNLOCK_REQUIRED')
    })
  }

  test(`driver ${action.target} ${action.decision} preserves a concurrent state change and reports conflict while authorized`, async t => {
    const f = decisionFixture(t, action)
    const batch = f.DB.batch.bind(f.DB)
    let concurrentState
    f.DB.batch = async statements => {
      f.sql.exec("UPDATE driver_applications SET status = 'draft'")
      concurrentState = reviewState(f)
      return batch(statements)
    }
    const result = await decide(f, action)
    assert.deepEqual(reviewState(f), concurrentState, 'A stale decision must not modify the concurrent state or write an audit')
    assert.equal(result.status, 409, JSON.stringify(result))
    assert.equal(result.body.error.code, action.target === 'document' ? 'INVALID_DOCUMENT_STATE' : action.decision === 'suspend' ? 'DRIVER_OPERATION_CONFLICT' : 'INVALID_APPLICATION_STATE')
  })

  test(`driver ${action.target} ${action.decision} cannot commit after its proof naturally expires while its batch is queued`, async t => {
    const f = decisionFixture(t, action)
    f.clock.now = Date.now()
    const expiresAt = f.clock.now + 500
    f.sql.prepare('UPDATE review_session_proofs SET verified_at = ?, expires_at = ?').run(f.clock.now, expiresAt)
    const before = reviewState(f)
    const batch = f.DB.batch.bind(f.DB)
    let crossedBoundary = false
    f.DB.batch = async statements => {
      crossedBoundary = true
      // Request-time bindings stay frozen; the database's execution clock must
      // reject the expired proof when this delayed transaction actually starts.
      await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt - Date.now() + 30)))
      return batch(statements)
    }
    const result = await decide(f, action)
    assert.equal(crossedBoundary, true, 'The proof must be valid at entry and expire only while the batch waits')
    assert.deepEqual(reviewState(f), before, 'Queued expiry must prevent decision, correction and audit writes')
    assert.equal(result.status, 428, JSON.stringify(result))
    assert.equal(result.body.error.code, 'REVIEW_UNLOCK_REQUIRED')
  })
}
