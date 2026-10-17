import test from 'node:test'
import assert from 'node:assert/strict'
import { availabilityFixture, disclosureTypes, tripInput } from './helpers/availability-fixture.mjs'

function fixture(t) {
  const f = availabilityFixture(t), worker = f.loadWorkerModule('index').default
  f.grantReview()
  f.api = async (method, path, body, user = 'staff') => {
    const response = await worker.fetch(new Request(`https://fave.test/api/admin/${path}`, {
      method, headers: { origin: 'https://fave.test', 'content-type': 'application/json', ...(user ? { 'x-test-user': user } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }), { DB: f.DB, BETTER_AUTH_URL: 'https://fave.test' }, { waitUntil() {} })
    return { status: response.status, body: response.headers.get('content-type')?.includes('json') ? await response.json() : await response.text() }
  }
  f.operation = (decision, expectedVersion = 0, extra = {}) => f.api('POST', 'driver-operations/driver-app/decision', {
    decision, expectedVersion, reason: 'Internal synthetic review reason', applicantMessage: 'Please contact Fave support for the next steps.', confirmed: true, ...extra,
  })
  f.booking = async () => {
    const { request } = await f.estimateAndRequest(); await f.logCall(request.requestId)
    const quote = await f.staff('POST', `/${request.requestId}/confirm`)
    const booked = await f.trip('POST', '/confirm', { body: { quoteId: quote.body.quoteId, accepted: true, contactSharingConsent: true, acceptedDisclosureIds: disclosureTypes } })
    assert.equal(booked.status, 201)
    return f.sql.prepare('SELECT * FROM bookings').get()
  }
  f.clone = (base, id, overrides = {}) => {
    const quote = f.sql.prepare('SELECT * FROM trip_quotes WHERE id=?').get(base.quote_id)
    f.insert('trip_quotes', { ...quote, id: `quote-${id}` })
    f.insert('bookings', { ...base, id, quote_id: `quote-${id}`, ...overrides })
  }
  return f
}

test('suspension atomically flags active bookings, preserving price, consent, status and client access', async t => {
  const f = fixture(t), booking = await f.booking()
  f.clone(booking, 'confirmed-old', { status: 'confirmed', start_date: '2000-01-01', end_date: '2000-01-02' })
  for (const status of ['cancelled', 'expired']) f.clone(booking, status, { status })
  f.clone(booking, 'old-hold', { hold_expires_at: f.clock.now - 1 })
  const result = await f.operation('suspend')
  assert.equal(result.status, 200, JSON.stringify(result))
  assert.equal(result.body.version, 1)
  assert.deepEqual(f.sql.prepare('SELECT booking_id FROM booking_review_flags ORDER BY booking_id').all().map(x => x.booking_id), [booking.id, 'confirmed-old'].sort())
  assert.deepEqual(f.sql.prepare('SELECT * FROM bookings WHERE id=?').get(booking.id), booking)
  assert.equal((await f.trip('GET', `/${booking.id}`)).status, 200)
  assert.equal((await f.trip('POST', '/estimates', { body: { ...tripInput, vehicleId: 'car-2', startDate: '2099-02-01', endDate: '2099-02-02' } })).body.error.code, 'VEHICLE_UNAVAILABLE')
  const own = await f.loadWorkerModule('drivers').driversApp.request('https://fave.test/application', { headers: { 'x-test-user': 'driver' } }, { DB: f.DB })
  const ownBody = await own.json()
  assert.match(JSON.stringify(ownBody), /Please contact Fave support/)
  assert.doesNotMatch(JSON.stringify(ownBody), /Internal synthetic review reason/)
  assert.equal((await f.operation('suspend')).status, 409)
  assert.equal(f.sql.prepare('SELECT count(*) n FROM driver_operation_events').get().n, 1)
})

test('suspension requires target version, confirmation and a separate driver message, including older API', async t => {
  const f = fixture(t)
  for (const extra of [{ applicantMessage: '' }, { expectedVersion: undefined }, { confirmed: false }]) assert.equal((await f.operation('suspend', 0, extra)).status, 400)
  assert.equal((await f.api('POST', 'drivers/driver-app/decision', { decision: 'suspend', reason: 'Valid internal reason' })).status, 400)
  const booking = await f.booking()
  assert.equal((await f.api('POST', 'drivers/driver-app/decision', { decision: 'suspend', expectedVersion: 0, confirmed: true, reason: 'Legacy client reason', applicantMessage: 'Call Fave support.' })).status, 200)
  assert.equal(f.sql.prepare('SELECT booking_id FROM booking_review_flags').get().booking_id, booking.id)
})

test('restore checks all current prerequisites and does not close booking flags', async t => {
  const f = fixture(t); await f.booking(); await f.operation('suspend')
  f.sql.prepare("UPDATE driver_application_documents SET retention_expires_at=? WHERE id='national_id_front'").run(f.clock.now - 1)
  assert.equal((await f.operation('restore', 1)).status, 409)
  f.sql.prepare("UPDATE driver_application_documents SET retention_expires_at=? WHERE id='national_id_front'").run(f.clock.now + 86400000)
  assert.equal((await f.operation('restore', 1)).status, 200)
  assert.equal(f.sql.prepare('SELECT status FROM booking_review_flags').get().status, 'open')
  assert.equal((await f.operation('suspend', 2)).status, 200)
  assert.equal(f.sql.prepare('SELECT count(*) n FROM booking_review_flags').get().n, 2)
})

for (const change of [
  "UPDATE driver_applications SET citizenship_attested_at=NULL",
  "UPDATE driver_applications SET retention_expires_at=NULL",
  "UPDATE retention_policies SET active=0",
  "UPDATE driver_verification_requirements SET version='new'",
  "DELETE FROM policy_acceptances WHERE document_id='driver_terms'",
  "INSERT INTO account_deletion_requests(id,user_id,status,requested_at) VALUES('closing','driver','requested',1)",
]) test(`restore fails closed for ${change}`, async t => {
  const f = fixture(t); await f.operation('suspend'); f.sql.exec(change)
  assert.equal((await f.operation('restore', 1)).status, 409)
  assert.equal(f.sql.prepare('SELECT status FROM driver_applications').get().status, 'suspended')
})

test('corrections is an explicit suspended recovery path and keeps flags open', async t => {
  const f = fixture(t); await f.booking(); await f.operation('suspend')
  assert.equal((await f.operation('request_corrections', 1)).status, 200)
  assert.equal(f.sql.prepare('SELECT status FROM driver_applications').get().status, 'needs_correction')
  assert.equal(f.sql.prepare('SELECT status FROM booking_review_flags').get().status, 'open')
  assert.equal((await f.operation('restore', 2)).status, 409)
})

test('booking flags follow saved driver and clearly mark conservative legacy fallback', async t => {
  const f = fixture(t), booking = await f.booking()
  f.clone(booking, 'other-driver', { quote_snapshot_json: JSON.stringify({ driverApplicationId: 'another-driver' }) })
  f.clone(booking, 'legacy', { quote_snapshot_json: '{}' })
  await f.operation('suspend')
  const flags = f.sql.prepare('SELECT booking_id,association FROM booking_review_flags ORDER BY booking_id').all()
  assert.equal(flags.some(x => x.booking_id === 'other-driver'), false)
  assert.equal(flags.find(x => x.booking_id === booking.id).association, 'saved_driver')
  assert.equal(flags.find(x => x.booking_id === 'legacy').association, 'legacy_vehicle')
})

test('audit failure rolls back suspension and all booking flags', async t => {
  const f = fixture(t); await f.booking()
  f.sql.exec("CREATE TRIGGER fail_operations_audit BEFORE INSERT ON marketplace_audit_events WHEN NEW.action='driver_operation' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END")
  assert.equal((await f.operation('suspend')).status, 500)
  assert.equal(f.sql.prepare('SELECT status FROM driver_applications').get().status, 'approved')
  assert.equal(f.sql.prepare('SELECT count(*) n FROM driver_operation_events').get().n, 0)
  assert.equal(f.sql.prepare('SELECT count(*) n FROM booking_review_flags').get().n, 0)
})

test('only owner reviewers can list and only unlocked owner can disclose or mutate', async t => {
  const f = fixture(t)
  for (const [user, status] of [[null, 401], ['client-1', 403], ['driver', 403]]) {
    assert.equal((await f.api('GET', 'driver-operations/pending', null, user)).status, status)
    assert.equal((await f.api('GET', 'booking-reviews/pending', null, user)).status, status)
  }
  f.sql.exec('DELETE FROM review_session_proofs')
  assert.equal((await f.api('GET', 'driver-operations/pending')).status, 200)
  assert.equal((await f.api('GET', 'driver-operations/driver-app')).status, 428)
  assert.equal((await f.operation('suspend')).status, 428)
  assert.equal((await f.api('GET', 'driver-operations/pending?cursor=bad')).status, 400)
})

test('Mark reviewed requires an explicit note, keeps booking intact and preserves history', async t => {
  const f = fixture(t), booking = await f.booking(); await f.operation('suspend')
  const queue = await f.api('GET', 'booking-reviews/pending')
  assert.equal(queue.status, 200)
  assert.doesNotMatch(JSON.stringify(queue.body), /Private pickup|Internal synthetic|phone|outcomeNote/)
  const id = queue.body.items[0].id
  const detail = await f.api('GET', `booking-reviews/${id}`)
  assert.match(JSON.stringify(detail.body), /Internal synthetic/)
  assert.equal((await f.api('POST', `booking-reviews/${id}/reviewed`, { note: '', confirmed: true })).status, 400)
  assert.equal((await f.api('POST', `booking-reviews/${id}/reviewed`, { note: 'Called driver; owner will arrange next steps.', confirmed: true })).status, 200)
  assert.equal((await f.api('POST', `booking-reviews/${id}/reviewed`, { note: 'Repeated review note', confirmed: true })).status, 409)
  assert.equal((await f.api('GET', 'booking-reviews/pending')).body.items.length, 0)
  assert.equal((await f.api('GET', 'booking-reviews/pending?status=reviewed')).body.items.length, 1)
  assert.deepEqual(f.sql.prepare('SELECT * FROM bookings').get(), booking)
})

for (const decision of ['suspend', 'restore']) test(`${decision} cannot borrow a later same-millisecond unlock at the transaction`, async t => {
  const f=fixture(t)
  if(decision==='restore')await f.operation('suspend')
  const before=f.sql.prepare('SELECT * FROM driver_applications').get(), batch=f.DB.batch.bind(f.DB)
  f.DB.batch=async statements=>{
    f.insert('review_session_locks',{session_id:'staff-session',user_id:'staff',generation:1,locked_at:f.clock.now})
    // Keep the proof fields identical; the original generation must still lose.
    return batch(statements)
  }
  assert.equal((await f.operation(decision,decision==='restore'?1:0)).status,428)
  assert.deepEqual(f.sql.prepare('SELECT * FROM driver_applications').get(),before)
  assert.equal(f.sql.prepare('SELECT count(*) n FROM driver_operation_events').get().n,decision==='restore'?1:0)
})

test('suspension wins before a booking batch and no new booking slips through',async t=>{
  const f=fixture(t), {request}=await f.estimateAndRequest();await f.logCall(request.requestId)
  const quote=await f.staff('POST',`/${request.requestId}/confirm`),batch=f.DB.batch.bind(f.DB)
  let injected=false
  f.DB.batch=async statements=>{
    if(!injected&&statements.some(s=>s.query.includes('INSERT INTO bookings'))){injected=true;assert.equal((await f.operation('suspend')).status,200)}
    return batch(statements)
  }
  const result=await f.trip('POST','/confirm',{body:{quoteId:quote.body.quoteId,accepted:true,contactSharingConsent:true,acceptedDisclosureIds:disclosureTypes}})
  assert.equal(injected,true);assert.equal(result.status,409)
  assert.equal(f.sql.prepare('SELECT count(*) n FROM bookings').get().n,0)
})

test('a booking committed just before suspension is included in its flags',async t=>{
  const f=fixture(t),base=await f.booking(),batch=f.DB.batch.bind(f.DB);let injected=false
  f.DB.batch=async statements=>{
    if(!injected&&statements.some(s=>s.query.includes('INSERT INTO driver_operation_events'))){injected=true;f.clone(base,'last-moment-booking')}
    return batch(statements)
  }
  assert.equal((await f.operation('suspend')).status,200)
  assert.equal(f.sql.prepare("SELECT count(*) n FROM booking_review_flags WHERE booking_id='last-moment-booking'").get().n,1)
})

test('saved driver identity remains authoritative when a car relationship changes',async t=>{
  const f=fixture(t),base=await f.booking()
  f.insert('driver_applications',{...f.sql.prepare('SELECT * FROM driver_applications').get(),id:'other-app',user_id:'client-2'})
  f.sql.exec("UPDATE vehicles SET driver_application_id='other-app' WHERE id='car-1'")
  await f.operation('suspend')
  assert.equal(f.sql.prepare('SELECT booking_id FROM booking_review_flags').get().booking_id,base.id)
})

test('owner queues paginate without leaking reasons and bind cursors to their filter',async t=>{
  const f=fixture(t),base=f.sql.prepare('SELECT * FROM driver_applications').get()
  for(let i=0;i<30;i++){
    const id=`roster-${String(i).padStart(2,'0')}`
    f.insert('user',{id,name:id,email:`${id}@example.test`,emailVerified:1,createdAt:1,updatedAt:1})
    f.insert('driver_applications',{...base,id,user_id:id,reviewer_reason:'Very private reason'})
  }
  const first=await f.api('GET','driver-operations/pending')
  assert.equal(first.body.items.length,25);assert.ok(first.body.nextCursor)
  assert.doesNotMatch(JSON.stringify(first.body),/Very private|phone|national|TEST-ONLY/)
  const next=await f.api('GET',`driver-operations/pending?cursor=${encodeURIComponent(first.body.nextCursor)}`)
  assert.equal(next.body.items.length,6);assert.equal(next.body.nextCursor,null)
  assert.equal(new Set([...first.body.items,...next.body.items].map(x=>x.id)).size,31)
  assert.equal((await f.api('GET',`driver-operations/pending?status=suspended&cursor=${encodeURIComponent(first.body.nextCursor)}`)).status,400)
})

test('Mark reviewed rolls back on audit failure and cannot write after proof revocation',async t=>{
  const f=fixture(t);await f.booking();await f.operation('suspend')
  const id=f.sql.prepare('SELECT id FROM booking_review_flags').get().id
  f.sql.exec("CREATE TRIGGER fail_review_audit BEFORE INSERT ON marketplace_audit_events WHEN NEW.action='booking_flag_reviewed' BEGIN SELECT RAISE(ABORT,'synthetic review audit failure'); END")
  const body={note:'Owner reviewed driver availability.',confirmed:true}
  assert.equal((await f.api('POST',`booking-reviews/${id}/reviewed`,body)).status,500)
  assert.equal(f.sql.prepare('SELECT status FROM booking_review_flags').get().status,'open')
  f.sql.exec('DROP TRIGGER fail_review_audit')
  const batch=f.DB.batch.bind(f.DB)
  f.DB.batch=async statements=>{f.sql.exec('DELETE FROM review_session_proofs');return batch(statements)}
  assert.equal((await f.api('POST',`booking-reviews/${id}/reviewed`,body)).status,428)
  assert.equal(f.sql.prepare('SELECT status FROM booking_review_flags').get().status,'open')
})

test('older application approval cannot overwrite a later suspend/corrections cycle with the same status',async t=>{
  const f=fixture(t);f.sql.exec("UPDATE driver_applications SET status='needs_correction'")
  const batch=f.DB.batch.bind(f.DB);let injected=false
  f.DB.batch=async statements=>{
    if(!injected&&statements.some(s=>s.query.includes('UPDATE driver_applications'))){
      injected=true
      f.sql.exec("UPDATE driver_applications SET status='approved'; UPDATE driver_applications SET status='suspended'; UPDATE driver_applications SET status='needs_correction',applicant_message='New correction request',reviewer_reason='New private reason';")
    }
    return batch(statements)
  }
  assert.equal((await f.api('POST','drivers/driver-app/decision',{decision:'approve',reason:'Older approval reason'})).status,409)
  assert.equal(f.sql.prepare('SELECT status,applicant_message FROM driver_applications').get().applicant_message,'New correction request')
  assert.equal(f.sql.prepare('SELECT count(*) n FROM marketplace_audit_events').get().n,0)
})

test('reviewed booking history is unavailable while locked even through its queue route',async t=>{
  const f=fixture(t);f.sql.exec('DELETE FROM review_session_proofs')
  assert.equal((await f.api('GET','booking-reviews/pending')).status,200)
  assert.equal((await f.api('GET','booking-reviews/pending?status=reviewed')).status,428)
})

test('restore rechecks evidence expiry at database execution time after a queued request',async t=>{
  const f=fixture(t);await f.operation('suspend')
  f.clock.now=Date.now()
  f.sql.prepare("UPDATE driver_application_documents SET retention_expires_at=? WHERE id='national_id_front'").run(f.clock.now+150)
  const batch=f.DB.batch.bind(f.DB)
  f.DB.batch=async statements=>{await new Promise(resolve=>setTimeout(resolve,250));return batch(statements)}
  assert.equal((await f.operation('restore',1)).status,409)
  assert.equal(f.sql.prepare('SELECT status FROM driver_applications').get().status,'suspended')
})

test('suspension excludes a deposit hold that expires while its transaction is queued',async t=>{
  const f=fixture(t);await f.booking();f.clock.now=Date.now()
  f.sql.prepare('UPDATE bookings SET hold_expires_at=?').run(f.clock.now+150)
  const batch=f.DB.batch.bind(f.DB)
  f.DB.batch=async statements=>{await new Promise(resolve=>setTimeout(resolve,250));return batch(statements)}
  assert.equal((await f.operation('suspend')).status,200)
  assert.equal(f.sql.prepare('SELECT count(*) n FROM booking_review_flags').get().n,0)
})

test('malformed legacy decisions cannot bypass operational suspension and booking flags',async t=>{
  const f=fixture(t);await f.booking()
  for(const decision of [['suspend'],['approve'],['reject'],{decision:'suspend'}]){
    assert.equal((await f.api('POST','driver-operations/driver-app/decision',{decision,expectedVersion:0,confirmed:true,reason:'Valid reason',applicantMessage:'Call support.'})).status,400)
    assert.equal((await f.api('POST','drivers/driver-app/decision',{decision,reason:'Malformed decision attempt'})).status,400)
    assert.equal(f.sql.prepare('SELECT status FROM driver_applications').get().status,'approved')
  }
  assert.equal(f.sql.prepare('SELECT count(*) n FROM driver_operation_events').get().n,0)
})
