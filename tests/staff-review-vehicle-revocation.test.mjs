import test from 'node:test'
import assert from 'node:assert/strict'
import { availabilityFixture } from './helpers/availability-fixture.mjs'

const actions = [
  { target: 'media', decision: 'approve' },
  { target: 'media', decision: 'reject' },
  { target: 'listing', decision: 'approve' },
  { target: 'listing', decision: 'reject' },
]

function setup(t, target, method = 'passkey') {
  const f = availabilityFixture(t)
  f.grantReview('staff', method)
  f.insert('retention_policies', {
    id: 'vehicle-retention', record_type: 'vehicle_evidence', version: 'v1',
    retention_days: 365, active: 1, approved_at: 1,
  })
  f.sql.prepare("UPDATE vehicles SET status='pending_review' WHERE id='car-1'").run()
  const mediaId = f.sql.prepare("SELECT id FROM vehicle_media WHERE vehicle_id='car-1' AND media_kind='registration_document'").get().id
  if (target === 'media') f.sql.prepare("UPDATE vehicle_media SET review_status='pending' WHERE id=?").run(mediaId)
  f.decide = decision => f.reviewVehicle('POST', target === 'media' ? `/car-1/media/${mediaId}/decision` : '/car-1/decision', {
    body: { decision, reason: 'Synthetic review reason', ...(decision === 'reject' ? { applicantMessage: 'Please replace the synthetic evidence.' } : {}) },
  })
  f.snapshot = () => ({
    vehicle: f.sql.prepare("SELECT * FROM vehicles WHERE id='car-1'").get(),
    media: f.sql.prepare("SELECT * FROM vehicle_media WHERE vehicle_id='car-1' ORDER BY id").all(),
    audits: f.sql.prepare('SELECT * FROM marketplace_audit_events ORDER BY id').all(),
  })
  return f
}

const revocations = [
  ['proof deletion', f => f.sql.exec('DELETE FROM review_session_proofs')],
  ['reviewer membership revocation', f => f.sql.exec("UPDATE review_memberships SET active=0 WHERE user_id='staff'")],
  ['session revocation', f => f.sql.exec("DELETE FROM session WHERE id='staff-session'")],
  ['credential removal', f => {
    // Keep a backup method so removal follows the real migration's last-method rule.
    f.insert('passkey', { id: 'backup-key', userId: 'staff', publicKey: 'synthetic-backup', credentialID: 'backup-credential', counter: 0, deviceType: 'multiDevice', backedUp: 1 })
    f.sql.exec("DELETE FROM passkey WHERE id='staff-key'")
  }],
  ['proof expiry', f => f.sql.prepare("UPDATE review_session_proofs SET expires_at=? WHERE user_id='staff'").run(f.clock.now)],
  ['proof replacement by a later unlock', f => f.sql.exec("UPDATE review_session_proofs SET verified_at=verified_at+1, expires_at=expires_at+1 WHERE user_id='staff'")],
  ['origin replacement', f => f.sql.exec("UPDATE review_session_proofs SET origin='https://other.test' WHERE user_id='staff'")],
  ['lock followed by an otherwise identical unlock', f => {
    const proof = f.sql.prepare("SELECT * FROM review_session_proofs WHERE user_id='staff'").get()
    f.insert('review_session_locks', { session_id: 'staff-session', user_id: 'staff', generation: 1, locked_at: f.clock.now })
    f.sql.exec("DELETE FROM review_session_proofs WHERE user_id='staff'")
    // Same-millisecond unlocks can reproduce every proof field; generation must
    // still prevent an action that started before this lock from being revived.
    f.insert('review_session_proofs', proof)
  }],
]

for (const { target, decision } of actions) {
  test(`authorized vehicle ${target} ${decision} commits its decision`, async t => {
    const f = setup(t, target)
    const result = await f.decide(decision)
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.status, decision === 'approve' ? 'approved' : 'rejected')
    assert.ok(f.snapshot().audits.length > 0)
  })

  for (const [name, revoke] of revocations) {
    test(`vehicle ${target} ${decision} makes no writes after ${name} before its transaction`, async t => {
      const f = setup(t, target)
      const before = f.snapshot()
      const batch = f.DB.batch.bind(f.DB)
      let intercepted = false
      f.DB.batch = async statements => {
        if (!intercepted && statements[0].query.startsWith(target === 'media' ? 'UPDATE vehicle_media SET review_status' : 'UPDATE vehicles SET status')) {
          intercepted = true
          revoke(f)
        }
        return batch(statements)
      }
      const result = await f.decide(decision)
      assert.equal(intercepted, true, 'The race must occur at the decision transaction boundary.')
      assert.deepEqual(f.snapshot(), before, 'Revoked reviews must leave target, correction messages and audits unchanged.')
      assert.equal(result.status, 428)
      assert.equal(result.body.error.code, 'REVIEW_UNLOCK_REQUIRED')
    })
  }

  test(`vehicle ${target} ${decision} preserves the conflict response when its target changes with valid authorization`, async t => {
    const f = setup(t, target)
    const batch = f.DB.batch.bind(f.DB)
    let concurrentState
    f.DB.batch = async statements => {
      if (target === 'media') f.sql.exec("UPDATE vehicle_media SET review_status='approved' WHERE vehicle_id='car-1'")
      else f.sql.exec("UPDATE vehicles SET status='suspended' WHERE id='car-1'")
      concurrentState = f.snapshot()
      return batch(statements)
    }
    const result = await f.decide(decision)
    assert.equal(result.status, 409)
    assert.deepEqual(f.snapshot(), concurrentState)
  })

  test(`vehicle ${target} ${decision} makes no writes after authenticator verification is revoked before its transaction`, async t => {
    const f = setup(t, target, 'totp')
    const before = f.snapshot()
    const batch = f.DB.batch.bind(f.DB)
    f.DB.batch = async statements => {
      f.sql.exec("UPDATE twoFactor SET verified=0 WHERE userId='staff'")
      return batch(statements)
    }
    const result = await f.decide(decision)
    assert.deepEqual(f.snapshot(), before)
    assert.equal(result.status, 428)
    assert.equal(result.body.error.code, 'REVIEW_UNLOCK_REQUIRED')
  })
}
