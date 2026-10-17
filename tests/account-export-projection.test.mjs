import assert from 'node:assert/strict'
import test from 'node:test'
import { Buffer } from 'node:buffer'
import { availabilityFixture } from './helpers/availability-fixture.mjs'

async function collect(f, userId, overrides = {}) {
  const prepared = f.loadWorkerModule('account-export-projection').prepareAccountExport({ DB: f.DB, ...overrides }, userId, f.clock.now)
  const files = new Map()
  for await (const entry of prepared.entries) files.set(entry.name, await new Response(entry.stream).text())
  return { files, coverage: prepared.coverage, text: [...files.values()].join('\n') }
}

test('complete pages, retained own original versions, both roles, credentials and other owners stay private', async (t) => {
  const f = availabilityFixture(t)
  const { encryptPrivateField } = f.loadWorkerModule('private-fields')
  f.grantReview('client-1')
  f.insert('marketplace_audit_events', { id: 'own-security-audit', actor_user_id: 'client-1', action: 'review_locked', target_type: 'review_session', target_id: 'client-1-session', created_at: 1 })
  f.sql.prepare('UPDATE passkey SET publicKey=?, credentialID=? WHERE userId=?').run('PUBLIC-KEY-CANARY', 'CREDENTIAL-CANARY', 'client-1')
  f.insert('twoFactor', { id: 'totp-own', userId: 'client-1', secret: 'TOTP-CANARY', backupCodes: 'BACKUP-CANARY', verified: 1 })
  f.insert('verification', { id: 'otp-own', identifier: 'client-1@example.test', value: 'OTP-CANARY', expiresAt: f.clock.now + 60000, createdAt: 1, updatedAt: 1 })
  f.insert('review_webauthn_challenges', { challenge: 'CHALLENGE-CANARY', session_id: 'client-1-session', generation: 0, origin: 'https://fave.test', ceremony: 'authentication', expires_at: f.clock.now + 60000 })
  const key = Buffer.alloc(32, 7).toString('base64')
  const encrypted = await encryptPrivateField(key, 'OWN-NATIONAL-ID')
  f.sql.prepare('UPDATE driver_applications SET user_id=?, national_id_number=? WHERE id=?').run('client-1', encrypted, 'driver-app')
  f.insert('account', { id: 'own-provider', accountId: 'own-provider-id', providerId: 'google', userId: 'client-1', accessToken: 'OAUTH-CANARY', refreshToken: 'REFRESH-CANARY', idToken: 'IDTOKEN-CANARY', password: 'PASSWORD-CANARY', createdAt: 1, updatedAt: 1 })
  f.insert('notification_push_tokens', { id: 'own-device', user_id: 'client-1', token: 'PUSH-CANARY', platform: 'ios', created_at: 1, last_registered_at: 2 })
  for (let i = 0; i < 130; i++) f.insert('policy_acceptances', { id: `accept-${String(i).padStart(4, '0')}`, user_id: 'client-1', document_id: 'client_terms', onboarding_context: 'client_onboarding', accepted_at: i })
  f.insert('driver_application_documents', { id: '../historical', application_id: 'driver-app', document_type: 'national_id_front', object_key: 'HISTORICAL-KEY-CANARY', content_type: 'image/png', byte_size: 3, review_status: 'rejected', created_at: 1, submission_version: 1 })
  for (let i = 0; i < 35; i++) f.insert('driver_application_documents', { id: `archive-doc-${String(i).padStart(3, '0')}`, application_id: 'driver-app', document_type: 'national_id_front', object_key: `OWN-ORIGINAL-KEY-${i}`, content_type: 'image/png', byte_size: 3, review_status: 'rejected', created_at: 1, submission_version: 1 })
  f.sql.prepare('UPDATE driver_applications SET submission_version=2 WHERE id=?').run('driver-app')
  f.insert('driver_applications', { id: 'other-app', user_id: 'driver', legal_name: 'OTHER-PERSON-CANARY', phone_e164: '+256700111111', national_id_number: 'OTHER-NID-CANARY', national_id_last4: '1111', status: 'draft', created_at: 1, updated_at: 1 })
  f.insert('driver_application_documents', { id: 'other-file', application_id: 'other-app', document_type: 'national_id_front', object_key: 'OTHER-KEY-CANARY', content_type: 'image/jpeg', byte_size: 3, created_at: 1 })
  const fetched = []
  const { files, coverage, text } = await collect(f, 'client-1', { DRIVER_ID_ENCRYPTION_KEY: key, DRIVER_FILES: { async get(k) { fetched.push(k); return { body: new Response(k === 'HISTORICAL-KEY-CANARY' ? 'OLD' : 'OWN').body } } } })
  assert.equal(JSON.parse(files.get('data/policy_acceptances.json')).length, 130)
  assert.equal(JSON.parse(files.get('data/driver_applications.json'))[0].national_id_number, 'OWN-NATIONAL-ID')
  assert.equal(JSON.parse(files.get('data/client_profiles.json')).length, 1)
  assert.ok([...files].some(([name, content]) => name.startsWith('originals/') && content === 'OLD'))
  assert.ok([...files.keys()].every((name) => !name.includes('..')))
  assert.equal(fetched.includes('OTHER-KEY-CANARY'), false)
  for (const secret of ['client-1-session', 'PUBLIC-KEY-CANARY', 'CREDENTIAL-CANARY', 'TOTP-CANARY', 'BACKUP-CANARY', 'OTP-CANARY', 'CHALLENGE-CANARY', 'OAUTH-CANARY', 'REFRESH-CANARY', 'IDTOKEN-CANARY', 'PASSWORD-CANARY', 'PUSH-CANARY', 'OTHER-PERSON-CANARY', 'OTHER-NID-CANARY', 'OTHER-KEY-CANARY', 'HISTORICAL-KEY-CANARY', 'client-1-test-token', encrypted]) assert.equal(text.includes(secret), false, secret)
  const manifest = JSON.parse(files.get('manifest.json'))
  assert.equal(manifest.counts.policy_acceptances, 130)
  assert.equal(manifest.counts.originals, fetched.length)
  assert.equal(manifest.counts.originals, 45)
  assert.equal(manifest.exceptions.some((item) => item.category === 'schema'), false)
  assert.deepEqual(manifest.exceptions, JSON.parse(JSON.stringify(coverage.exceptions)))
})

test('driver work redacts client locations and unknown/malformed snapshots become specific exceptions', async (t) => {
  const f = availabilityFixture(t)
  await f.estimateAndRequest()
  f.insert('trip_estimates', { id: 'unknown', client_user_id: 'driver', vehicle_id: 'car-1', driver_application_id: 'driver-app', policy_id: 'fare-v1', origin_json: JSON.stringify({ address: 'Own address', secret: 'NESTED-CANARY' }), destination_json: '{}', start_date: '2099-02-01', end_date: '2099-02-02', party_size: 1, luggage_count: 0, snapshot_json: JSON.stringify({ schemaVersion: 99, secret: 'SNAPSHOT-CANARY' }), created_at: 1 })
  const { text, files, coverage } = await collect(f, 'driver')
  assert.equal(text.includes('Private pickup, Kampala'), false)
  assert.equal(text.includes('NESTED-CANARY'), false)
  assert.equal(text.includes('SNAPSHOT-CANARY'), false)
  assert.equal(JSON.parse(files.get('data/trip_estimates.json')).length, 2)
  assert.ok(coverage.exceptions.some((item) => item.code === 'SNAPSHOT_REQUIRES_REVIEW'))
  assert.equal(coverage.complete, false)
})

test('unavailable retained originals, decryption failure and mixed-person notes remain follow-up', async (t) => {
  const f = availabilityFixture(t)
  f.sql.prepare('UPDATE driver_applications SET reviewer_reason=? WHERE id=?').run('MIXED-PERSON-CANARY', 'driver-app')
  const { text, coverage } = await collect(f, 'driver', { DRIVER_FILES: { async get() { return null } } })
  assert.equal(text.includes('MIXED-PERSON-CANARY'), false)
  assert.equal(text.includes('TEST-ONLY-ID'), false)
  assert.ok(coverage.exceptions.some((e) => e.category === 'driver_applications' && e.code === 'PRIVATE_FIELD_UNAVAILABLE'))
  assert.equal(coverage.exceptions.find((e) => e.category === 'driver_application_documents' && e.code === 'ORIGINAL_UNAVAILABLE').count, 3)
  assert.equal(coverage.exceptions.find((e) => e.category === 'vehicle_media' && e.code === 'ORIGINAL_UNAVAILABLE').count, 6)
  assert.ok(coverage.exceptions.some((e) => e.code === 'MIXED_PERSON_ACCESS_REVIEW'))
  assert.equal(coverage.complete, false)
})

test('audit ownership follows subject targets, never the staff actor, and newly introduced tables flag review', async (t) => {
  const f = availabilityFixture(t)
  for (const row of [
    { id: 'own-audit', actor_user_id: 'staff', target_id: 'client-1', reason: 'PRIVATE-AUDIT-NOTE' },
    { id: 'other-audit', actor_user_id: 'client-1', target_id: 'client-2', reason: 'OTHER-AUDIT-NOTE' },
  ]) f.insert('marketplace_audit_events', { ...row, action: 'profile_updated', target_type: 'user', created_at: 1 })
  f.sql.exec('CREATE TABLE future_private_records (id TEXT PRIMARY KEY, user_id TEXT, private_json TEXT)')
  f.insert('future_private_records', { id: 'future', user_id: 'client-1', private_json: 'NEW-SCHEMA-CANARY' })
  const { files, text, coverage } = await collect(f, 'client-1')
  assert.deepEqual(JSON.parse(files.get('data/marketplace_audit_events.json')).map((row) => row.id), ['own-audit'])
  for (const value of ['OTHER-AUDIT-NOTE', 'PRIVATE-AUDIT-NOTE', 'NEW-SCHEMA-CANARY']) assert.equal(text.includes(value), false)
  assert.ok(coverage.exceptions.some((e) => e.category === 'schema' && e.code === 'UNREVIEWED_SOURCE_TABLE'))
})

test('own saved route, fare calculation and historical accepted terms preserve their schema while nested extras never leak', async (t) => {
  const f = availabilityFixture(t)
  await f.estimateAndRequest()
  const estimate = f.sql.prepare('SELECT * FROM trip_estimates LIMIT 1').get()
  const snapshot = JSON.parse(estimate.snapshot_json)
  snapshot.secret = 'QUOTE-EXTRA-CANARY'
  snapshot.components[0].secret = 'COMPONENT-EXTRA-CANARY'
  snapshot.vehicleFareBenchmark.basis.origin.secret = 'POINT-EXTRA-CANARY'
  const origin = JSON.parse(estimate.origin_json)
  origin.secret = 'LOCATION-EXTRA-CANARY'
  origin.input.secret = 'INPUT-EXTRA-CANARY'
  f.insert('trip_quotes', { id: 'snapshot-test', client_user_id: 'client-1', vehicle_id: 'car-1', policy_id: 'fare-v1', origin_json: JSON.stringify(origin), destination_json: estimate.destination_json, start_date: estimate.start_date, end_date: estimate.end_date, party_size: 2, luggage_count: 1, route_distance_meters: 80000, route_duration_seconds: 7200, quote_json: JSON.stringify(snapshot), terms_snapshot_json: JSON.stringify([{ id: 'old-policy', type: 'client_terms', version: '2024-10-old', language: 'en', secret: 'TERMS-EXTRA-CANARY' }]), expires_at: f.clock.now + 60000, created_at: 1 })
  const { text, files } = await collect(f, 'client-1')
  const [quote] = JSON.parse(files.get('data/trip_quotes.json'))
  assert.equal(quote.origin.address, origin.address)
  assert.deepEqual(quote.origin.input, { address: origin.input.address })
  assert.equal(quote.quote.totalAmount, snapshot.totalAmount)
  assert.equal(quote.quote.vehicleFareBenchmark.basis.origin.label, snapshot.vehicleFareBenchmark.basis.origin.label)
  assert.equal(quote.terms_snapshot[0].version, '2024-10-old')
  for (const value of ['QUOTE-EXTRA-CANARY', 'COMPONENT-EXTRA-CANARY', 'POINT-EXTRA-CANARY', 'LOCATION-EXTRA-CANARY', 'INPUT-EXTRA-CANARY', 'TERMS-EXTRA-CANARY']) assert.equal(text.includes(value), false)
})

test('recipient inbox copy and owned domain references export without shared payloads or other recipients', async (t) => {
  const f = availabilityFixture(t)
  const own = await f.estimateAndRequest()
  const other = await f.estimateAndRequest({ user: 'client-2' })
  const insertEvent = (id, domain_id, domain_type = 'availability_request') => f.insert('notification_events', { id, event_type: 'booking.availability_confirmed', event_version: 1, domain_type, domain_id, occurred_at: 1, payload_json: JSON.stringify({ secret: 'SHARED-PAYLOAD-CANARY', clientName: 'OTHER-RECIPIENT-CANARY' }), created_at: 1 })
  insertEvent('own-inbox-event', own.request.requestId)
  insertEvent('staff-other-target', other.request.requestId)
  insertEvent('unknown-domain-event', 'UNKNOWN-DOMAIN-ID-CANARY', 'unreviewed_future_domain')
  insertEvent('only-other-recipient-event', other.request.requestId)
  for (const [id, event_id, recipient_user_id] of [
    ['own-inbox', 'own-inbox-event', 'client-1'], ['other-inbox', 'own-inbox-event', 'client-2'],
    ['staff-inbox', 'staff-other-target', 'client-1'], ['unknown-inbox', 'unknown-domain-event', 'client-1'],
    ['only-other-inbox', 'only-other-recipient-event', 'client-2'],
  ]) f.insert('notifications', { id, event_id, recipient_user_id, template_key: 'availability_confirmed', route_key: 'availability', priority: 'time_sensitive', created_at: 1 })
  const { text, files, coverage } = await collect(f, 'client-1')
  const notifications = JSON.parse(files.get('data/notifications.json'))
  const ownInbox = notifications.find((item) => item.id === 'own-inbox')
  const expectedCopy = f.loadWorkerModule('notification-delivery').safeNotificationCopy('availability_confirmed')
  assert.equal(ownInbox.title, expectedCopy.title)
  assert.equal(ownInbox.body, expectedCopy.body)
  assert.equal(ownInbox.domain_type, 'availability_request')
  assert.equal(ownInbox.targetId, own.request.requestId)
  assert.equal(notifications.find((item) => item.id === 'staff-inbox').targetId, undefined)
  assert.equal(notifications.some((item) => item.id === 'other-inbox' || item.id === 'only-other-inbox'), false)
  const events = JSON.parse(files.get('data/notification_events.json'))
  assert.equal(events.find((item) => item.id === 'own-inbox-event').domain_id, own.request.requestId)
  assert.equal(events.find((item) => item.id === 'staff-other-target').domain_id, undefined)
  assert.equal(events.some((item) => item.id === 'only-other-recipient-event'), false)
  assert.ok(coverage.exceptions.some((item) => item.category === 'notification_events' && item.code === 'DOMAIN_REFERENCE_ACCESS_REVIEW'))
  for (const value of ['SHARED-PAYLOAD-CANARY', 'OTHER-RECIPIENT-CANARY', 'UNKNOWN-DOMAIN-ID-CANARY']) assert.equal(text.includes(value), false)
})

test('retained own review lock and unlock activity survives session deletion without exposing old session identifiers', async (t) => {
  const f = availabilityFixture(t)
  f.insert('session', { id: 'OLD-SESSION-ID-CANARY', userId: 'client-1', token: 'OLD-SESSION-TOKEN-CANARY', expiresAt: f.clock.now + 1000, createdAt: 1, updatedAt: 1 })
  for (const [id, actor_user_id, action] of [
    ['own-old-lock', 'client-1', 'review_locked'], ['own-old-passkey', 'client-1', 'review_unlocked_passkey'], ['own-old-totp', 'client-1', 'review_unlocked_totp'],
    ['unrelated-actor-work', 'client-1', 'unrelated_staff_work'], ['other-user-lock', 'client-2', 'review_locked'],
  ]) f.insert('marketplace_audit_events', { id, actor_user_id, action, target_type: 'review_session', target_id: 'OLD-SESSION-ID-CANARY', created_at: 1 })
  f.sql.prepare('DELETE FROM session WHERE id=?').run('OLD-SESSION-ID-CANARY')
  const { files, text } = await collect(f, 'client-1')
  const facts = JSON.parse(files.get('data/marketplace_audit_events.json'))
  assert.deepEqual(facts.map((item) => item.id).sort(), ['own-old-lock', 'own-old-passkey', 'own-old-totp'])
  assert.ok(facts.every((item) => item.target_id === undefined))
  assert.equal(text.includes('OLD-SESSION-ID-CANARY'), false)
  assert.equal(text.includes('OLD-SESSION-TOKEN-CANARY'), false)
})

test('operational records export only subject-owned metadata and flag private notes for assessment',async t=>{
  const f=availabilityFixture(t);f.grantReview()
  f.insert('driver_operation_events',{id:'own-operation',application_id:'driver-app',version:1,decision:'suspend',prior_state:'approved',new_state:'suspended',reason:'PRIVATE-REVIEW-NOTE-CANARY',applicant_message:'Contact Fave support.',actor_user_id:'staff',created_at:1})
  f.insert('driver_applications',{id:'other-driver',user_id:'client-2',legal_name:'Other driver',phone_e164:'+256700000000',national_id_number:'OTHER',national_id_last4:'THER',status:'draft',created_at:1,updated_at:1})
  f.insert('driver_operation_events',{id:'OTHER-OPERATION-CANARY',application_id:'other-driver',version:1,decision:'suspend',prior_state:'approved',new_state:'suspended',reason:'OTHER-PRIVATE-NOTE-CANARY',actor_user_id:'staff',created_at:1})
  const own=await collect(f,'driver'), staff=await collect(f,'staff')
  assert.equal(JSON.parse(own.files.get('data/driver_operation_events.json'))[0].id,'own-operation')
  assert.doesNotMatch(own.text,/PRIVATE-REVIEW-NOTE-CANARY|OTHER-OPERATION-CANARY|OTHER-PRIVATE-NOTE-CANARY/)
  assert.equal(own.coverage.exceptions.some(x=>x.category==='driver_operation_events'&&x.code==='MIXED_PERSON_ACCESS_REVIEW'),true)
  assert.equal(JSON.parse(staff.files.get('data/driver_operation_events.json')).length,0)
  assert.equal(own.coverage.exceptions.some(x=>x.code==='UNREVIEWED_SOURCE_TABLE'),false)
})
