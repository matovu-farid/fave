import test from 'node:test'
import assert from 'node:assert/strict'
import { availabilityFixture, tripInput, disclosureTypes } from './helpers/availability-fixture.mjs'

function setup(t) {
  const f = availabilityFixture(t)
  const worker = f.loadWorkerModule('index').default
  f.api = async (method, path, {user='client-1', body, headers={}}={}) => {
    const response = await worker.fetch(new Request(`https://fave.test${path}`, {
      method, headers: {'content-type':'application/json', origin:'https://fave.test', ...(user ? {'x-test-user':user} : {}), ...headers},
      ...(body === undefined ? {} : {body:JSON.stringify(body)}),
    }), {DB:f.DB, BETTER_AUTH_URL:'https://fave.test'}, {})
    return {status:response.status, headers:response.headers, body:response.headers.get('content-type')?.includes('json') ? await response.json() : await response.text()}
  }
  f.close = (user='client-1') => f.api('POST','/api/account/deletion-request',{user,body:{confirmed:true}})
  return f
}
const receipt = '/api/account/deletion-request'
const confirmation = (quoteId) => ({quoteId, accepted:true, contactSharingConsent:true, acceptedDisclosureIds:disclosureTypes})
async function quote(f) {
  const {request}=await f.estimateAndRequest()
  await f.logCall(request.requestId)
  const result=await f.staff('POST',`/${request.requestId}/confirm`)
  assert.equal(result.status,200,JSON.stringify(result))
  return {request, quoteId:result.body.quoteId}
}

test('own request is authenticated, explicitly confirmed, session-owned and durable/idempotent with one audit',async t=>{
  const f=setup(t)
  assert.equal((await f.api('GET',receipt,{user:null})).status,401)
  assert.equal((await f.api('POST',receipt,{body:{}})).status,400)
  assert.equal((await f.api('POST',receipt,{body:{confirmed:true},headers:{origin:'https://evil.test'}})).status,403)
  assert.equal((await f.api('POST',receipt,{body:{confirmed:true},headers:{'content-type':'text/plain'}})).status,415)
  const before=await f.api('GET',receipt)
  assert.equal(before.body.request,null)
  assert.equal(before.body.canStartNewWork,true)
  const saved=await f.api('POST',receipt,{body:{confirmed:true,userId:'client-2'}})
  assert.equal(saved.status,200)
  assert.equal(saved.body.request.status,'requested')
  assert.equal(saved.body.canStartNewWork,false)
  assert.equal(saved.body.existingTripAccess,true)
  assert.match(saved.headers.get('cache-control'),/no-store/)
  f.clock.now+=10000
  assert.deepEqual((await f.close()).body,saved.body)
  assert.deepEqual((await f.api('GET',receipt)).body,saved.body)
  assert.equal((await f.api('GET',receipt,{user:'client-2'})).body.request,null)
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM marketplace_audit_events WHERE action='account_deletion_requested'").get().n,1)
  assert.throws(()=>f.sql.exec('DELETE FROM user WHERE id=\'client-1\''),/FOREIGN KEY|deletion request/)
  assert.throws(()=>f.sql.exec('UPDATE account_deletion_requests SET requested_at=0'),/immutable/)
})

test('a failed receipt audit rolls back the request and never reports success',async t=>{
  const f=setup(t)
  f.sql.exec("CREATE TRIGGER fail_receipt_audit BEFORE INSERT ON marketplace_audit_events WHEN NEW.action='account_deletion_requested' BEGIN SELECT RAISE(ABORT,'synthetic audit outage'); END")
  assert.equal((await f.close()).status,503)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM account_deletion_requests').get().n,0)
  f.sql.exec('DROP TRIGGER fail_receipt_audit')
  assert.equal((await f.close()).status,200)
})

for(const user of ['client-1','driver']) {
  test(`${user} deletion blocks saved-estimate intent and new estimates without deleting records`,async t=>{
    const f=setup(t)
    const estimate=await f.trip('POST','/estimates',{body:tripInput})
    assert.equal(estimate.status,201)
    assert.equal((await f.close(user)).status,200)
    const intent=await f.api('POST',`/api/trips/estimates/${estimate.body.estimateId}/availability-request`)
    assert.equal(intent.status,409,JSON.stringify(intent.body))
    const fresh=await f.api('POST','/api/trips/estimates',{body:tripInput})
    assert.equal(fresh.status,409,JSON.stringify(fresh.body))
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM availability_requests').get().n,0)
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM trip_estimates').get().n,1)
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM session').get().n,4)
  })
  test(`${user} deletion prevents staff confirmation and flags the retained request for intervention`,async t=>{
    const f=setup(t)
    const {request}=await f.estimateAndRequest()
    await f.logCall(request.requestId)
    await f.close(user)
    const queue=await f.staff('GET','/')
    assert.equal(queue.body.pendingRequests[0].needsReview,true)
    assert.equal((await f.staff('POST',`/${request.requestId}/confirm`)).status,409)
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM trip_quotes').get().n,0)
    assert.equal((await f.trip('POST',`/availability-requests/${request.requestId}/withdraw`)).status,200)
  })
  test(`${user} deletion between booking eligibility read and commit aborts the whole transaction`,async t=>{
    const f=setup(t)
    const {quoteId}=await quote(f)
    const batch=f.DB.batch.bind(f.DB)
    let injected=false
    f.DB.batch=async statements=>{
      if(!injected && statements.some(s=>s.query.includes('INSERT INTO bookings'))) {
        injected=true
        // Separate committed transaction, after eligibility reads and before business writes.
        f.insert('account_deletion_requests',{id:'race-receipt',user_id:user,status:'requested',requested_at:f.clock.now})
      }
      return batch(statements)
    }
    const result=await f.api('POST','/api/trips/confirm',{body:confirmation(quoteId)})
    assert.equal(injected,true)
    assert.equal(result.status,409)
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM bookings').get().n,0)
    assert.equal(f.sql.prepare('SELECT status FROM availability_requests').get().status,'confirmed')
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM booking_contact_consents').get().n,0)
  })
  test(`${user} deletion after booking preserves existing trip reads and payment/status resolution`,async t=>{
    const f=setup(t)
    const {quoteId}=await quote(f)
    const booking=await f.trip('POST','/confirm',{body:confirmation(quoteId)})
    assert.equal(booking.status,201,JSON.stringify(booking))
    await f.close(user)
    const trips=await f.api('GET','/api/trips/mine')
    assert.equal(trips.status,200)
    assert.equal(trips.body.bookings.length,1)
    if(user==='driver') {
      const calendar=await f.api('GET','/api/vehicles/car-1/availability',{user:'driver'})
      assert.equal(calendar.status,200)
      assert.equal(calendar.body.holdsAndBookings.length,1)
      assert.throws(()=>f.sql.exec("UPDATE bookings SET vehicle_id='car-2'"),/account deletion blocks new work/)
      assert.equal((await f.api('GET','/api/vehicles/car-1/availability',{user:'client-2'})).status,404)
    }
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM booking_contact_consents').get().n,1)
    f.sql.exec("UPDATE bookings SET status='confirmed'")
    assert.equal(f.sql.prepare('SELECT status FROM bookings').get().status,'confirmed')
  })
}

test('owner queue exposes opaque receipts; contact details require fresh proof and an audit',async t=>{
  const f=setup(t)
  const saved=await f.close()
  const queuePath='/api/admin/account-requests/pending'
  const detailPath=`/api/admin/account-requests/${saved.body.request.id}/detail`
  assert.equal((await f.api('GET',queuePath,{user:'staff'})).status,403)
  f.grantReview()
  f.sql.exec('DELETE FROM review_session_proofs')
  const queue=await f.api('GET',queuePath,{user:'staff'})
  assert.equal(queue.status,200)
  assert.deepEqual(Object.keys(queue.body.requests[0]).sort(),['id','requestedAt','status'])
  assert.equal((await f.api('POST',detailPath,{user:'staff'})).status,428)
  f.sql.exec(`INSERT INTO review_session_proofs (session_id,source_session_id,user_id,origin,method,credential_id,verified_at,expires_at)
    VALUES ('staff-session','staff-session','staff','https://fave.test','passkey','staff-key',${f.clock.now},${f.clock.now+600000})`)
  const detail=await f.api('POST',detailPath,{user:'staff'})
  assert.equal(detail.status,200)
  assert.equal(detail.body.request.email,'client-1@example.test')
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM marketplace_audit_events WHERE action='account_deletion_request_viewed'").get().n,1)
  f.sql.exec("UPDATE review_memberships SET active=0")
  assert.equal((await f.api('POST',detailPath,{user:'staff'})).status,403)
})

for (const user of ['client-1','driver']) test(`${user} closure protects every SQL new-work boundary and leaves decline and expiry available`, async t => {
  const f=setup(t)
  const {request,quoteId}=await quote(f)
  const booking=await f.trip('POST','/confirm',{body:confirmation(quoteId)})
  assert.equal(booking.status,201)
  const estimate=f.sql.prepare('SELECT * FROM trip_estimates').get()
  f.insert('driver_trip_offers',{id:'legacy',client_user_id:'client-1',driver_application_id:'driver-app',vehicle_id:'car-1',
    origin_json:estimate.origin_json,destination_json:estimate.destination_json,start_date:estimate.start_date,end_date:estimate.end_date,
    party_size:2,luggage_count:1,status:'pending',expires_at:f.clock.now+900000,created_at:f.clock.now})
  await f.close(user)
  for(const table of ['trip_estimates','availability_requests','trip_quotes','bookings','driver_trip_offers']) {
    const row=f.sql.prepare(`SELECT * FROM ${table} LIMIT 1`).get()
    assert.throws(()=>f.insert(table,{...row,id:`new-${table}`}),/account deletion blocks new work/,table)
  }
  assert.throws(()=>f.sql.exec("UPDATE driver_trip_offers SET status='quoting'"),/account deletion blocks new work/)
  const offers=await f.api('GET','/api/trips/driver-offers',{user:'driver'})
  assert.equal(offers.body.offers.length,1)
  assert.equal(offers.body.offers[0].canAccept,false)
  assert.equal((await f.api('POST','/api/trips/driver-offers/legacy/respond',{user:'driver',body:{decision:'decline'}})).status,200)
  f.clock.now+=3600001
  await f.loadWorkerModule('bookings').expireDepositPendingBookings({DB:f.DB},f.clock.now)
  assert.equal(f.sql.prepare('SELECT status FROM bookings').get().status,'expired')
  assert.equal(f.sql.prepare('SELECT id FROM availability_requests').get().id,request.requestId)
})

test('proof revoked while private request detail is in flight prevents disclosure and audit success',async t=>{
  const f=setup(t)
  const saved=await f.close()
  f.grantReview()
  const batch=f.DB.batch.bind(f.DB)
  f.DB.batch=async statements=>{
    f.sql.exec('DELETE FROM review_session_proofs')
    return batch(statements)
  }
  const response=await f.api('POST',`/api/admin/account-requests/${saved.body.request.id}/detail`,{user:'staff'})
  assert.equal(response.status,428)
  assert.equal(response.body.request,undefined)
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM marketplace_audit_events WHERE action='account_deletion_request_viewed'").get().n,0)
})

test('owner can reach every received request with stable keyset pages',async t=>{
  const f=setup(t)
  f.grantReview()
  for(let i=0;i<151;i++) {
    const id=`page-${String(i).padStart(3,'0')}`
    f.insert('user',{id,name:id,email:`${id}@example.test`,emailVerified:1,createdAt:1,updatedAt:1})
    f.insert('account_deletion_requests',{id,user_id:id,status:'requested',requested_at:1000+i})
  }
  const first=await f.api('GET','/api/admin/account-requests/pending',{user:'staff'})
  assert.equal(first.body.requests.length,150)
  assert.equal(first.body.nextCursor,'page-149')
  const last=await f.api('GET',`/api/admin/account-requests/pending?after=${first.body.nextCursor}`,{user:'staff'})
  assert.equal(last.body.requests.length,1)
  assert.equal(last.body.requests[0].id,'page-150')
  assert.equal(last.body.nextCursor,null)
  assert.equal((await f.api('GET','/api/admin/account-requests/pending?after=unknown',{user:'staff'})).status,400)
})

for(const user of ['client-1','driver']) test(`${user} deletion during staff confirmation prevents quote, hold and notices together`,async t=>{
  const f=setup(t)
  const {request}=await f.estimateAndRequest()
  await f.logCall(request.requestId)
  const noticeCount=f.sql.prepare('SELECT COUNT(*) AS n FROM notification_events').get().n
  const batch=f.DB.batch.bind(f.DB)
  let injected=false
  f.DB.batch=async statements=>{
    if(!injected && statements.some(s=>s.query.includes('INSERT INTO trip_quotes'))) {
      injected=true
      f.insert('account_deletion_requests',{id:'confirm-race',user_id:user,status:'requested',requested_at:f.clock.now})
    }
    return batch(statements)
  }
  const result=await f.staff('POST',`/${request.requestId}/confirm`)
  assert.equal(injected,true)
  assert.equal(result.status,409)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM trip_quotes').get().n,0)
  assert.equal(f.sql.prepare('SELECT status FROM availability_requests').get().status,'requested')
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM notification_events').get().n,noticeCount)
})
