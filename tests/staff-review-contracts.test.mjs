import test from 'node:test'
import assert from 'node:assert/strict'
import { availabilityFixture } from './helpers/availability-fixture.mjs'

for (const kind of ['driver','vehicle']) {
  test(`${kind} queue contains only safe facts; detail requires verified proof`,async(t)=>{
    const f=availabilityFixture(t)
    f.grantReview()
    f.sql.exec("UPDATE driver_applications SET status='pending_verification'; UPDATE vehicles SET status='pending_review'")
    const request=kind==='driver'?f.reviewDriver:f.reviewVehicle
    const queue=await request('GET','/pending')
    assert.equal(queue.status,200)
    const encoded=JSON.stringify(queue.body)
    assert.doesNotMatch(encoded,/phone|registration_number|national_id|object_key|reviewer_reason|reason/i)
    const id=kind==='driver'?'driver-app':'car-1'
    const detail=await request('GET',`/${id}/review`)
    assert.equal(detail.status,200,JSON.stringify(detail))
    assert.ok(detail.body.checklist)
    f.sql.exec('DELETE FROM review_session_proofs')
    assert.equal((await request('GET',`/${id}/review`)).status,428)
    assert.equal((await request('GET','/pending')).status,200)
  })
}

test('security status reveals available methods but no credential secret, and lock clears proof',async(t)=>{
  const f=availabilityFixture(t)
  f.grantReview()
  const status=await f.reviewSecurity('GET','/')
  assert.equal(status.status,200)
  assert.equal(status.body.unlocked,true)
  assert.doesNotMatch(JSON.stringify(status.body),/publicKey|credentialID|secret|backupCodes|token/)
  assert.equal((await f.reviewSecurity('POST','/lock', {body:{}})).status,200)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM review_session_proofs').get().count,0)
})
