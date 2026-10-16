import test from 'node:test'
import assert from 'node:assert/strict'
import { availabilityFixture, disclosureTypes, tripInput } from './helpers/availability-fixture.mjs'

function legacyOffer(f, { expiresAt = f.clock.now, status = 'pending' } = {}) {
  f.insert('driver_trip_offers', {
    id: 'legacy-offer', client_user_id: 'client-1', driver_application_id: 'driver-app',
    vehicle_id: 'car-1', origin_json: '{}', destination_json: '{}',
    start_date: tripInput.startDate, end_date: tripInput.endDate, party_size: 2,
    luggage_count: 1, status, expires_at: expiresAt, created_at: f.clock.now - 900000,
  })
}

function notices(f) {
  return f.sql.prepare(`SELECT event.event_type, event.domain_id, event.expires_at,
      event.payload_json, inbox.recipient_user_id, outbox.delivery_id
    FROM notification_events AS event
    JOIN notifications AS inbox ON inbox.event_id = event.id
    JOIN notification_outbox AS outbox ON outbox.notification_id = inbox.id
    ORDER BY event.created_at, event.id`).all()
}

test('a late driver response expires the legacy offer with exactly one durable client notification', async (t) => {
  const f = availabilityFixture(t)
  legacyOffer(f)
  const respond = () => f.trip('POST', '/driver-offers/legacy-offer/respond', { user: 'driver', body: { decision: 'accept' } })
  assert.equal((await respond()).status, 409)
  assert.equal(f.sql.prepare('SELECT status FROM driver_trip_offers').get().status, 'expired')
  assert.equal(notices(f).length, 1)
  const notice = notices(f)[0]
  assert.equal(notice.event_type, 'booking.driver_offer_expired')
  assert.equal(notice.domain_id, 'legacy-offer')
  assert.equal(notice.recipient_user_id, 'client-1')
  assert.equal(notice.expires_at, null)
  assert.equal(notice.payload_json, '{}')
  assert.equal((await respond()).status, 409)
  await f.trip('GET', '/driver-offers', { user: 'driver' })
  assert.equal(notices(f).length, 1, 'response retries and the expiry sweep must not duplicate the notice')
})

test('staff confirmation and deposit hold each persist one private client notice', async (t) => {
  const f = availabilityFixture(t)
  const { request } = await f.estimateAndRequest()
  await f.logCall(request.requestId)
  const confirmed = await f.staff('POST', `/${request.requestId}/confirm`)
  assert.equal(confirmed.status, 200)
  assert.equal(notices(f).length, 1)
  assert.equal(notices(f)[0].event_type, 'booking.availability_confirmed')
  assert.equal(notices(f)[0].expires_at, confirmed.body.holdExpiresAt)
  const body = { quoteId: confirmed.body.quoteId, accepted: true, contactSharingConsent: true, acceptedDisclosureIds: disclosureTypes }
  const booking = await f.trip('POST', '/confirm', { body })
  assert.equal(booking.status, 201)
  const hold = notices(f).find((notice) => notice.event_type === 'booking.hold_created')
  assert.ok(hold)
  assert.equal(hold.domain_id, booking.body.bookingId)
  assert.equal(hold.expires_at, booking.body.holdExpiresAt)
  assert.equal((await f.trip('POST', '/confirm', { body })).status, 409)
  assert.equal(notices(f).length, 2)
  assert.ok(notices(f).every((notice) => notice.recipient_user_id === 'client-1' && notice.payload_json === '{}'))
})

test('late expiry rolls back on outbox failure and a later response can retry it safely', async (t) => {
  const f = availabilityFixture(t)
  legacyOffer(f)
  f.sql.exec(`CREATE TRIGGER reject_test_expiry_notice BEFORE INSERT ON notification_outbox
    BEGIN SELECT RAISE(ABORT, 'injected expiry outbox failure'); END`)
  const respond = () => f.trip('POST', '/driver-offers/legacy-offer/respond', { user: 'driver', body: { decision: 'accept' } })
  await assert.rejects(respond, /injected expiry outbox failure/u)
  assert.equal(f.sql.prepare('SELECT status FROM driver_trip_offers').get().status, 'pending')
  for (const table of ['notification_events', 'notifications', 'notification_outbox']) {
    assert.equal(f.sql.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, table)
  }
  f.sql.exec('DROP TRIGGER reject_test_expiry_notice')
  assert.equal((await respond()).status, 409)
  assert.equal(f.sql.prepare('SELECT status FROM driver_trip_offers').get().status, 'expired')
  assert.equal(notices(f).length, 1)
})

test('legacy decline and client withdrawal notify only the other participant and deduplicate retries', async (t) => {
  for (const action of ['decline', 'withdraw']) await t.test(action, async (t) => {
    const f = availabilityFixture(t)
    legacyOffer(f, { expiresAt: f.clock.now + 900000 })
    const respond = action === 'decline'
      ? () => f.trip('POST', '/driver-offers/legacy-offer/respond', { user: 'driver', body: { decision: 'decline' } })
      : () => f.trip('POST', '/quote-requests/legacy-offer/withdraw')
    assert.equal((await respond()).status, 200)
    assert.equal((await respond()).status, 409)
    assert.equal(notices(f).length, 1)
    assert.equal(notices(f)[0].event_type, action === 'decline' ? 'booking.driver_offer_declined' : 'booking.withdrawn')
    assert.equal(notices(f)[0].recipient_user_id, action === 'decline' ? 'client-1' : 'driver')
  })
})

test('late response cannot notify after a competing withdrawal wins the expiry transition', async (t) => {
  const f = availabilityFixture(t)
  legacyOffer(f)
  const batch = f.DB.batch.bind(f.DB)
  f.DB.batch = async (statements) => {
    f.sql.exec("UPDATE driver_trip_offers SET status = 'withdrawn' WHERE id = 'legacy-offer'")
    return batch(statements)
  }
  assert.equal((await f.trip('POST', '/driver-offers/legacy-offer/respond', { user: 'driver', body: { decision: 'accept' } })).status, 409)
  assert.equal(f.sql.prepare('SELECT status FROM driver_trip_offers').get().status, 'withdrawn')
  assert.equal(notices(f).length, 0)
})

test('an unrelated account cannot trigger a driver response or its notification', async (t) => {
  const f = availabilityFixture(t)
  legacyOffer(f)
  assert.equal((await f.trip('POST', '/driver-offers/legacy-offer/respond', { user: 'client-2', body: { decision: 'accept' } })).status, 404)
  assert.equal(f.sql.prepare('SELECT status FROM driver_trip_offers').get().status, 'pending')
  assert.equal(notices(f).length, 0)
})

test('failed notification outbox persistence rolls back the staff decision, hold, quote and audit', async (t) => {
  const f = availabilityFixture(t)
  const { request } = await f.estimateAndRequest()
  await f.logCall(request.requestId)
  f.sql.exec(`CREATE TRIGGER reject_test_outbox BEFORE INSERT ON notification_outbox
    BEGIN SELECT RAISE(ABORT, 'injected outbox failure'); END`)
  assert.equal((await f.staff('POST', `/${request.requestId}/confirm`)).status, 409)
  assert.equal(f.sql.prepare('SELECT status FROM availability_requests').get().status, 'requested')
  for (const table of ['trip_quotes', 'notification_events', 'notifications', 'notification_outbox']) {
    assert.equal(f.sql.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, table)
  }
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS count FROM marketplace_audit_events WHERE action = 'availability_confirmed'").get().count, 0)
  f.sql.exec('DROP TRIGGER reject_test_outbox')
  assert.equal((await f.staff('POST', `/${request.requestId}/confirm`)).status, 200)
  assert.equal(notices(f).length, 1)
})

test('failed hold notification rolls back booking conversion and the client’s acceptances', async (t) => {
  const f = availabilityFixture(t)
  const { request } = await f.estimateAndRequest()
  await f.logCall(request.requestId)
  const confirmed = await f.staff('POST', `/${request.requestId}/confirm`)
  f.sql.exec(`CREATE TRIGGER reject_test_hold_notice BEFORE INSERT ON notification_outbox
    BEGIN SELECT RAISE(ABORT, 'injected outbox failure'); END`)
  const result = await f.trip('POST', '/confirm', { body: {
    quoteId: confirmed.body.quoteId, accepted: true, contactSharingConsent: true, acceptedDisclosureIds: disclosureTypes,
  } })
  assert.equal(result.status, 409)
  assert.equal(f.sql.prepare('SELECT status FROM availability_requests').get().status, 'confirmed')
  for (const table of ['bookings', 'booking_contact_consents']) {
    assert.equal(f.sql.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, table)
  }
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS count FROM policy_acceptances WHERE user_id = 'client-1'").get().count, 0)
  assert.equal(f.sql.prepare('SELECT terms_snapshot_json FROM trip_quotes').get().terms_snapshot_json, null)
  assert.equal(notices(f).length, 1, 'only the earlier availability confirmation remains')
})
