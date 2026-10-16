import test from 'node:test'
import assert from 'node:assert/strict'
import {availabilityFixture} from './helpers/availability-fixture.mjs'

for(const concurrent of ['media_reviewed','vehicle_approved','vehicle_rejected','vehicle_suspended'])test(`a vehicle rejection has no side effects after ${concurrent}`,async t=>{
 const f=availabilityFixture(t);f.grantReview()
 f.sql.exec("UPDATE vehicles SET status='pending_review'; UPDATE vehicle_media SET review_status='pending'")
 const media=f.sql.prepare("SELECT id FROM vehicle_media WHERE vehicle_id='car-1' AND media_kind='registration_document'").get()
 const batch=f.DB.batch.bind(f.DB)
 f.DB.batch=async statements=>{
  if(concurrent==='media_reviewed')f.sql.prepare("UPDATE vehicle_media SET review_status='approved' WHERE id=?").run(media.id)
  else f.sql.prepare("UPDATE vehicles SET status=? WHERE id='car-1'").run(concurrent.replace('vehicle_',''))
  return batch(statements)
 }
 const result=await f.reviewVehicle('POST',`/car-1/media/${media.id}/decision`,{body:{decision:'reject',reason:'Synthetic review conflict',applicantMessage:'Upload a clear copy.'}})
 assert.equal(result.status,409,JSON.stringify(result))
 assert.equal(f.sql.prepare("SELECT status FROM vehicles WHERE id='car-1'").get().status,concurrent==='media_reviewed'?'pending_review':concurrent.replace('vehicle_',''))
 assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM marketplace_audit_events').get().count,0)
})

for(const decision of ['approve','reject'])test(`current vehicle evidence can be ${decision}d with the right audit`,async t=>{
 const f=availabilityFixture(t);f.grantReview()
 f.sql.exec("UPDATE vehicles SET status='pending_review'; UPDATE vehicle_media SET review_status='pending'")
 const media=f.sql.prepare("SELECT id FROM vehicle_media WHERE vehicle_id='car-1' AND media_kind='registration_document'").get()
 const result=await f.reviewVehicle('POST',`/car-1/media/${media.id}/decision`,{body:{decision,reason:'Synthetic evidence checked',...(decision==='reject'?{applicantMessage:'Upload a clearer copy.'}:{})}})
 assert.equal(result.status,200,JSON.stringify(result))
 assert.equal(f.sql.prepare('SELECT review_status FROM vehicle_media WHERE id=?').get(media.id).review_status,decision==='approve'?'approved':'rejected')
 assert.equal(f.sql.prepare("SELECT status FROM vehicles WHERE id='car-1'").get().status,decision==='reject'?'needs_correction':'pending_review')
 assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM marketplace_audit_events').get().count,decision==='reject'?2:1)
})
