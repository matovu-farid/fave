import test from 'node:test'
import assert from 'node:assert/strict'
import { availabilityFixture } from './helpers/availability-fixture.mjs'

function setup(t) {
 const f=availabilityFixture(t);f.grantReview()
 f.insert('account_deletion_requests',{id:'deletion',user_id:'client-1',status:'requested',requested_at:1})
 f.insert('account_export_requests',{id:'export',user_id:'client-1',request_key:'synthetic',status:'requested',requested_at:1,updated_at:1})
 const worker=f.loadWorkerModule('index').default
 f.request=(path,body={},extra={})=>worker.fetch(new Request(`https://fave.test${path}`,{method:'POST',headers:{origin:'https://fave.test','content-type':'application/json','x-test-user':'staff'},body:JSON.stringify(body)}),{DB:f.DB,BETTER_AUTH_URL:'https://fave.test',...extra},{waitUntil(){}})
 return f
}
const replacements=[
 ['new proof',f=>f.sql.exec('UPDATE review_session_proofs SET verified_at=verified_at+1,expires_at=expires_at+1')],
 ['lock and identical unlock',f=>f.insert('review_session_locks',{session_id:'staff-session',user_id:'staff',generation:1,locked_at:f.clock.now})],
]
for(const path of ['/api/admin/account-requests/deletion/detail','/api/admin/account-exports/export/detail','/api/admin/account-exports/export/decision']) {
 for(const [name,replace] of replacements)test(`${path} cannot borrow a ${name} after authorization`,async t=>{
  const f=setup(t),batch=f.DB.batch.bind(f.DB)
  let intercepted=false
  f.DB.batch=async statements=>{if(!intercepted){intercepted=true;replace(f)}return batch(statements)}
  const response=await f.request(path,{message:'Synthetic owner follow-up'})
  assert.equal(intercepted,true)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM marketplace_audit_events').get().n,0)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM account_export_responses').get().n,0)
  assert.equal(response.status,428)
  assert.doesNotMatch(await response.text(),/client-1@example.test|Synthetic owner follow-up/)
 })
}

test('locking after an authorized commit preserves the committed decision and asks to refresh its status',async t=>{
 const f=setup(t),batch=f.DB.batch.bind(f.DB)
 f.sql.exec("UPDATE driver_applications SET status='pending_verification';UPDATE driver_application_documents SET review_status='pending'")
 f.DB.batch=async statements=>{const results=await batch(statements);f.sql.exec('DELETE FROM review_session_proofs');return results}
 const response=await f.request('/api/admin/drivers/driver-app/documents/national_id_front/decision',{decision:'approve',reason:'Synthetic authorized decision'})
 assert.equal(response.status,428)
 assert.equal(f.sql.prepare("SELECT review_status FROM driver_application_documents WHERE id='national_id_front'").get().review_status,'approved')
 assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM marketplace_audit_events WHERE action='driver_document_reviewed'").get().n,1)
 assert.match((await response.json()).error.message,/refresh.*status/i)
})

for(const kind of ['driver','vehicle'])test(`${kind} private file is denied when a lock completes during its storage lookup`,async t=>{
 const f=setup(t)
 const media=f.sql.prepare("SELECT id FROM vehicle_media WHERE vehicle_id='car-1' AND media_kind='registration_document'").get()
 const path=kind==='driver'?'/api/admin/drivers/driver-app/documents/national_id_front/access':`/api/admin/vehicles/car-1/media/${media.id}/access`
 const response=await f.request(path,{reason:'Synthetic evidence purpose'},{DRIVER_FILES:{async get(){
  f.sql.exec('DELETE FROM review_session_proofs')
  return {body:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('SYNTHETIC-PRIVATE-FILE'));c.close()}}),writeHttpMetadata(h){h.set('Content-Type','image/png')}}
 }}})
 assert.equal(response.status,428)
 assert.doesNotMatch(await response.text(),/SYNTHETIC-PRIVATE-FILE/)
 // This audit records the authorized server access attempt before storage;
 // it is not evidence that the revoked client received those bytes.
 assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM marketplace_audit_events').get().n,1)
})
