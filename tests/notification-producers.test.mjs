import test from 'node:test'
import assert from 'node:assert/strict'
import { availabilityFixture, disclosureTypes, tripInput } from './helpers/availability-fixture.mjs'

function legacyOffer(f, { expiresAt = f.clock.now, status = 'pending' } = {}) {
  f.insert('driver_trip_offers', {
    id: 'legacy-offer', client_user_id: 'client-1', driver_application_id: 'driver-app',
    vehicle_id: 'car-1',
    origin_json: JSON.stringify({ input: tripInput.origin, address: tripInput.origin.address, latitude: 0.3, longitude: 32.5 }),
    destination_json: JSON.stringify({ input: tripInput.destination, address: tripInput.destination.address, latitude: 0.44, longitude: 33.2 }),
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


test('legacy driver acceptance durably notifies only its client before making one private quote ready', async (t) => {
  const f = availabilityFixture(t)
  legacyOffer(f, { expiresAt: f.clock.now + 900000 })
  const respond = () => f.trip('POST', '/driver-offers/legacy-offer/respond', { user: 'driver', body: { decision: 'accept' } })
  const accepted = await respond()
  assert.equal(accepted.status, 200)
  assert.equal(accepted.body.status, 'quoted')
  const quote = f.sql.prepare('SELECT * FROM trip_quotes').get()
  assert.equal(quote.id, accepted.body.quoteId)
  const storedOffer = f.sql.prepare('SELECT status, quote_id FROM driver_trip_offers').get()
  assert.equal(storedOffer.status, 'quoted')
  assert.equal(storedOffer.quote_id, quote.id)
  const notificationRows = notices(f)
  assert.equal(notificationRows.length, 2)
  const acceptance = notificationRows.find(row => row.event_type === 'booking.driver_offer_accepted')
  const ready = notificationRows.find(row => row.event_type === 'booking.quote_status_changed')
  assert.ok(acceptance)
  assert.equal(acceptance.expires_at, null)
  assert.ok(ready)
  assert.equal(ready.expires_at, quote.expires_at)
  for (const row of notificationRows) {
    assert.equal(row.domain_id, 'legacy-offer')
    assert.equal(row.recipient_user_id, 'client-1')
    assert.equal(row.payload_json, '{}')
  }
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM bookings').get().count, 0)
  assert.equal((await respond()).status, 409)
  assert.equal((await f.trip('GET', '/quote-requests/current')).body.offer.quote.quoteId, quote.id)
  assert.equal((await f.trip('GET', '/quote-requests/legacy-offer')).body.quoteId, quote.id)
  assert.equal(notices(f).length, 2, 'response retries and recovery reads cannot duplicate the notices')
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM trip_quotes').get().count, 1)
})


test('an acceptance outbox failure leaves the legacy offer pending and retry creates one quote', async (t) => {
  const f = availabilityFixture(t)
  legacyOffer(f, { expiresAt: f.clock.now + 900000 })
  f.sql.exec(`CREATE TRIGGER reject_legacy_acceptance BEFORE INSERT ON notification_outbox
    BEGIN SELECT RAISE(ABORT, 'injected acceptance outbox failure'); END`)
  const respond = () => f.trip('POST', '/driver-offers/legacy-offer/respond', { user: 'driver', body: { decision: 'accept' } })
  await assert.rejects(respond, /injected acceptance outbox failure/u)
  const offer = f.sql.prepare('SELECT status, responded_at, quote_id FROM driver_trip_offers').get()
  assert.equal(offer.status, 'pending')
  assert.equal(offer.responded_at, null)
  assert.equal(offer.quote_id, null)
  for (const table of ['trip_quotes', 'notification_events', 'notifications', 'notification_outbox']) {
    assert.equal(f.sql.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, table)
  }
  f.sql.exec('DROP TRIGGER reject_legacy_acceptance')
  assert.equal((await respond()).status, 200)
  assert.equal(notices(f).length, 2)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM trip_quotes').get().count, 1)
})

test('a quote-ready outbox failure rolls back the quote and preserves the earlier acceptance event', async (t) => {
  const f = availabilityFixture(t)
  legacyOffer(f, { expiresAt: f.clock.now + 900000 })
  f.sql.exec(`CREATE TRIGGER reject_legacy_quote_ready BEFORE INSERT ON notification_outbox
    WHEN (SELECT event.event_type FROM notifications AS inbox JOIN notification_events AS event ON event.id = inbox.event_id WHERE inbox.id = NEW.notification_id) = 'booking.quote_status_changed'
    BEGIN SELECT RAISE(ABORT, 'injected quote outbox failure'); END`)
  const respond = () => f.trip('POST', '/driver-offers/legacy-offer/respond', { user: 'driver', body: { decision: 'accept' } })
  await assert.rejects(respond, /injected quote outbox failure/u)
  const offer = f.sql.prepare('SELECT status, quote_id FROM driver_trip_offers').get()
  assert.equal(offer.status, 'quoting')
  assert.equal(offer.quote_id, null)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM trip_quotes').get().count, 0)
  assert.equal(notices(f).length, 1)
  assert.equal(notices(f)[0].event_type, 'booking.driver_offer_accepted')
  assert.equal(notices(f)[0].recipient_user_id, 'client-1')
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS count FROM notification_events WHERE event_type = 'booking.quote_status_changed'").get().count, 0)
  assert.equal((await respond()).status, 409, 'an accepted offer cannot be claimed twice')
  f.clock.now += 900000
  const recovered = await f.trip('GET', '/quote-requests/current')
  assert.equal(recovered.body.offer.status, 'quote_failed')
  assert.equal(notices(f).length, 1, 'timeout recovery must not advertise a nonexistent quote')
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM trip_quotes').get().count, 0)
})

test('legacy routing failure does not publish a quote-ready event or create a booking', async (t) => {
  for (const kind of ['provider_error', 'no_route']) await t.test(kind, async (t) => {
    const f = availabilityFixture(t)
    legacyOffer(f, { expiresAt: f.clock.now + 900000 })
    f.maps.computeDrivingRoute = async () => ({ kind })
    const response = await f.trip('POST', '/driver-offers/legacy-offer/respond', { user: 'driver', body: { decision: 'accept' } })
    assert.equal(response.status, kind === 'provider_error' ? 503 : 422)
    assert.equal(response.body.status, 'quote_failed')
    assert.equal(f.sql.prepare('SELECT status FROM driver_trip_offers').get().status, 'quote_failed')
    assert.equal(notices(f).length, 1)
    assert.equal(notices(f)[0].event_type, 'booking.driver_offer_accepted')
    for (const table of ['trip_quotes', 'bookings']) {
      assert.equal(f.sql.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, table)
    }
  })
})
