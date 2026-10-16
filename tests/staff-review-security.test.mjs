import test from 'node:test'
import assert from 'node:assert/strict'
import { availabilityFixture } from './helpers/availability-fixture.mjs'

test('operations membership alone cannot approve identity evidence', async (t) => {
  const f = availabilityFixture(t)
  f.sql.exec("UPDATE driver_applications SET status = 'pending_verification'; UPDATE driver_application_documents SET review_status = 'pending'")
  const result = await f.reviewDriver('POST', '/driver-app/documents/national_id_front/decision', { body: { decision: 'approve', reason: 'Checklist checked' } })
  assert.equal(result.status, 403)
  assert.equal(f.sql.prepare("SELECT review_status FROM driver_application_documents WHERE id='national_id_front'").get().review_status, 'pending')
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM marketplace_audit_events').get().count, 0)
})

for (const method of ['passkey', 'totp']) {
  test(`${method} proof unlocks only its live owner session`, async (t) => {
    const f = availabilityFixture(t)
    f.grantReview('staff', method)
    f.sql.exec("UPDATE driver_applications SET status='pending_verification'; UPDATE driver_application_documents SET review_status='pending'")
    const result = await f.reviewDriver('POST', '/driver-app/documents/national_id_front/decision', { body: { decision: 'approve', reason: 'Checklist checked' } })
    assert.equal(result.status, 200, JSON.stringify(result))
  })
}

for (const [label, change, expected] of [
  ['expiry', f => { f.clock.now += 600000 }, 428],
  ['member revocation', f => f.sql.exec('UPDATE review_memberships SET active=0'), 403],
  ['session revocation', f => f.sql.exec("DELETE FROM session WHERE userId='staff'"), 401],
  ['credential revocation', f => { f.insert('twoFactor',{id:'backup',userId:'staff',secret:'synthetic',backupCodes:'[]',verified:1}); f.sql.exec("UPDATE user SET twoFactorEnabled=1 WHERE id='staff'; DELETE FROM passkey") }, 428],
  ['wrong session', f => f.sql.exec("UPDATE review_session_proofs SET session_id='client-1-session'"), 428],
  ['wrong user', f => f.sql.exec("UPDATE review_session_proofs SET user_id='client-1'"), 428],
  ['wrong origin', f => f.sql.exec("UPDATE review_session_proofs SET origin='https://other.test'"), 428],
  ['new membership grant', f => f.sql.prepare('UPDATE review_memberships SET granted_at=?').run(f.clock.now+1), 428],
]) {
  test(`${label} denies private evidence before lookup or audit`, async (t) => {
    const f = availabilityFixture(t)
    f.grantReview()
    change(f)
    const result = await f.reviewDriver('POST', '/driver-app/identity-review', { body: { reason: 'Check application identity' } })
    assert.equal(result.status, expected, JSON.stringify(result))
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM marketplace_audit_events').get().count, 0)
  })
}

test('removing or disabling the enrolled authenticator invalidates its proof', async (t) => {
  const f = availabilityFixture(t)
  f.grantReview('staff', 'totp')
  f.insert('passkey',{id:'backup',userId:'staff',publicKey:'synthetic',credentialID:'backup',counter:0,deviceType:'multiDevice',backedUp:1})
  f.sql.exec('UPDATE user SET twoFactorEnabled=0')
  const result = await f.reviewDriver('POST', '/driver-app/identity-review', { body: { reason: 'Check application identity' } })
  assert.equal(result.status, 428)
})
