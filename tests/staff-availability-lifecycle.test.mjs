import test from 'node:test'
import assert from 'node:assert/strict'
import { availabilityFixture, disclosureTypes, tripInput } from './helpers/availability-fixture.mjs'

test('saved estimate stays fixed through staff confirmation and booking, even after rates change', async (t) => {
  const f = availabilityFixture(t)
  const { estimate, request } = await f.estimateAndRequest()
  assert.equal(estimate.quote.totalAmount, 484000)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM driver_trip_offers').get().count, 0)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM bookings').get().count, 0)
  assert.equal(f.sql.prepare('SELECT hold_expires_at FROM availability_requests').get().hold_expires_at, null)
  await f.logCall(request.requestId)
  f.sql.exec("UPDATE vehicles SET benchmark_amount_ugx = 800000; UPDATE driver_applications SET lodging_rate_ugx = 90000; UPDATE fare_policies SET active = 0")
  f.sql.exec(`INSERT INTO fare_policies (id, version, currency, rules_json, quote_ttl_seconds, hold_ttl_seconds, active, approved_at, effective_at)
    VALUES ('fare-v2', 'v2', 'UGX', '{}', 7200, 2400, 1, 2, 2)`)
  const confirmed = await f.staff('POST', `/${request.requestId}/confirm`)
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed))
  assert.equal(confirmed.body.holdExpiresAt, f.clock.now + 7200000, 'the active policy configures the window without repricing the estimate')
  const current = await f.trip('GET', '/availability-requests/current')
  assert.deepEqual(current.body.request.quote, estimate.quote)
  const booking = await f.trip('POST', '/confirm', { body: { quoteId: confirmed.body.quoteId, accepted: true, contactSharingConsent: true, acceptedDisclosureIds: disclosureTypes } })
  assert.equal(booking.status, 201, JSON.stringify(booking))
  assert.deepEqual(booking.body.quote, estimate.quote)
  assert.equal(f.sql.prepare('SELECT status FROM availability_requests').get().status, 'converted_to_booking')
  assert.equal(f.sql.prepare('SELECT status FROM bookings').get().status, 'deposit_pending')
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM booking_contact_consents').get().count, 1)
  const converted = f.sql.prepare("SELECT actor_user_id, prior_state, new_state FROM marketplace_audit_events WHERE action = 'availability_converted_to_booking'").get()
  assert.deepEqual({ ...converted }, { actor_user_id: 'client-1', prior_state: 'confirmed', new_state: 'converted_to_booking' })
})

test('confirmed staff holds remove both the car and its driver’s other cars from search until expiry', async (t) => {
  const f = availabilityFixture(t)
  const { request } = await f.estimateAndRequest()
  const search = `/catalog?startDate=${tripInput.startDate}&endDate=${tripInput.endDate}&partySize=2&luggageCount=1`
  assert.equal((await f.vehicle('GET', search)).body.vehicles.length, 2, 'pending requests must not hold dates')
  await f.logCall(request.requestId)
  assert.equal((await f.staff('POST', `/${request.requestId}/confirm`)).status, 200)
  assert.equal((await f.vehicle('GET', search)).body.vehicles.length, 0, 'staff confirmation must hold the driver and car')
  f.clock.now += 3600001
  assert.equal((await f.vehicle('GET', search)).body.vehicles.length, 2)
  const current = await f.trip('GET', '/availability-requests/current')
  assert.equal(current.body.request.status, 'expired')
  assert.equal(current.body.request.quote, undefined, 'expired quotes cannot be offered for payment')
})

test('the first staff confirmation wins and a repeat or withdrawal race leaves no orphan quote', async (t) => {
  const f = availabilityFixture(t)
  const first = await f.estimateAndRequest()
  const second = await f.estimateAndRequest({ user: 'client-2' })
  await f.logCall(first.request.requestId)
  await f.logCall(second.request.requestId)
  assert.equal((await f.staff('POST', `/${first.request.requestId}/confirm`)).status, 200)
  assert.equal((await f.staff('POST', `/${second.request.requestId}/confirm`)).status, 409)
  assert.equal((await f.staff('POST', `/${first.request.requestId}/confirm`)).status, 409)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM trip_quotes').get().count, 1)
  assert.equal((await f.trip('POST', `/availability-requests/${second.request.requestId}/withdraw`, { user: 'client-2' })).status, 200)
  assert.equal((await f.staff('POST', `/${second.request.requestId}/confirm`)).status, 409)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM trip_quotes').get().count, 1)
})

test('expired vehicle evidence prevents staff confirmation without sending a quote', async (t) => {
  const f = availabilityFixture(t)
  const { request } = await f.estimateAndRequest()
  await f.logCall(request.requestId)
  f.sql.exec("UPDATE vehicle_media SET retention_expires_at = 1 WHERE media_kind = 'registration_document'")
  assert.equal((await f.staff('POST', `/${request.requestId}/confirm`)).status, 409)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM trip_quotes').get().count, 0)
})

test('a withdrawal after the staff read wins over confirmation and cannot leave an orphan quote', async (t) => {
  const f = availabilityFixture(t)
  const { request } = await f.estimateAndRequest()
  await f.logCall(request.requestId)
  const batch = f.DB.batch.bind(f.DB)
  f.DB.batch = async (statements) => {
    f.sql.prepare("UPDATE availability_requests SET status = 'withdrawn' WHERE id = ?").run(request.requestId)
    return batch(statements)
  }
  assert.equal((await f.staff('POST', `/${request.requestId}/confirm`)).status, 409)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM trip_quotes').get().count, 0)
})

test('an estimate for past dates cannot become an availability promise', async (t) => {
  const f = availabilityFixture(t)
  const { request } = await f.estimateAndRequest()
  await f.logCall(request.requestId)
  f.clock.now += 8 * 86400000
  assert.equal((await f.staff('POST', `/${request.requestId}/confirm`)).status, 409)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM trip_quotes').get().count, 0)
})

test('a staff member must record the driver call before either availability decision', async (t) => {
  const f = availabilityFixture(t)
  const { request } = await f.estimateAndRequest()
  assert.equal((await f.staff('POST', `/${request.requestId}/confirm`)).status, 409)
  assert.equal((await f.staff('POST', `/${request.requestId}/unavailable`)).status, 409)
  assert.equal(f.sql.prepare('SELECT status FROM availability_requests').get().status, 'requested')
})

test('an unanswered call leaves the request awaiting follow-up and cannot unlock a quote', async (t) => {
  const f = availabilityFixture(t)
  const { request } = await f.estimateAndRequest()
  await f.logCall(request.requestId, 'no_answer')
  const result = await f.staff('POST', `/${request.requestId}/confirm`)
  assert.equal(result.status, 409)
  assert.equal(result.body.error.code, 'DRIVER_NOT_REACHED')
  assert.equal(f.sql.prepare('SELECT status FROM availability_requests').get().status, 'requested')
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM trip_quotes').get().count, 0)
})

for (const outcome of ['no_answer', 'busy', 'voicemail', 'other']) {
  test(`a ${outcome} call cannot mark the client’s selected car unavailable`, async (t) => {
    const f = availabilityFixture(t)
    const { request } = await f.estimateAndRequest()
    await f.logCall(request.requestId, outcome)
    const result = await f.staff('POST', `/${request.requestId}/unavailable`)
    assert.equal(result.status, 409, JSON.stringify(result))
    assert.equal(f.sql.prepare('SELECT status FROM availability_requests').get().status, 'requested')
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS count FROM marketplace_audit_events WHERE action = 'availability_marked_unavailable'").get().count, 0)
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM notification_events').get().count, 0)
    await f.logCall(request.requestId, 'reached')
    assert.equal((await f.staff('POST', `/${request.requestId}/unavailable`)).status, 200)
    assert.equal(f.sql.prepare('SELECT status FROM availability_requests').get().status, 'unavailable')
  })
}

test('staff decisions and client records stay restricted to their owners and roles', async (t) => {
  const f = availabilityFixture(t)
  const { estimate, request } = await f.estimateAndRequest()
  assert.equal((await f.trip('GET', `/estimates/${estimate.estimateId}`, { user: 'client-2' })).status, 404)
  assert.equal((await f.trip('POST', `/estimates/${estimate.estimateId}/availability-request`, { user: 'client-2' })).status, 409)
  assert.equal((await f.trip('POST', `/availability-requests/${request.requestId}/withdraw`, { user: 'client-2' })).status, 409)
  assert.equal((await f.staff('POST', `/${request.requestId}/confirm`, { user: 'client-1' })).status, 403)
  assert.equal((await f.staff('POST', `/${request.requestId}/unavailable`, { user: 'client-1' })).status, 403)
  assert.equal((await f.trip('GET', '/availability-requests/current', { user: 'client-2' })).body.request, null)
  assert.equal((await f.trip('GET', `/estimates/${estimate.estimateId}`, { user: null })).status, 401)
})

test('staff availability decisions and quote expiry notify only the client without private trip data', async (t) => {
  const f = availabilityFixture(t)
  const { request } = await f.estimateAndRequest()
  await f.logCall(request.requestId)
  await f.staff('POST', `/${request.requestId}/confirm`)
  let notices = f.sql.prepare('SELECT event_type, payload_json, recipient_user_id FROM notification_events JOIN notifications ON event_id = notification_events.id').all()
  assert.deepEqual(notices.map((notice) => notice.event_type), ['booking.availability_confirmed'])
  assert.equal(notices[0].recipient_user_id, 'client-1')
  assert.equal(notices[0].payload_json, '{}')
  f.clock.now += 3600001
  await f.trip('GET', '/availability-requests/current')
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS count FROM notification_events WHERE event_type = 'booking.availability_expired'").get().count, 1)
  const second = await f.estimateAndRequest()
  await f.logCall(second.request.requestId)
  await f.staff('POST', `/${second.request.requestId}/unavailable`)
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS count FROM notification_events WHERE event_type = 'booking.availability_unavailable'").get().count, 1)
})

test('old app quote creation cannot bypass staff confirmation by creating a new driver offer', async (t) => {
  const f = availabilityFixture(t)
  const result = await f.trip('POST', '/quote', { body: tripInput })
  assert.equal(result.status, 410)
  assert.equal(result.body.error.code, 'BOOKING_FLOW_UPDATED')
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM driver_trip_offers').get().count, 0)
})

test('an unresolved active fare policy gate prevents a new final quote', async (t) => {
  const f = availabilityFixture(t)
  const { request } = await f.estimateAndRequest()
  await f.logCall(request.requestId)
  f.sql.exec('UPDATE fare_policies SET active = 0')
  assert.equal((await f.staff('POST', `/${request.requestId}/confirm`)).status, 409)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM trip_quotes').get().count, 0)
})

test('an availability alert opens its own request and never another client’s request', async (t) => {
  const f = availabilityFixture(t)
  const first = await f.estimateAndRequest()
  const result = await f.trip('GET', `/availability-requests/${first.request.requestId}`)
  assert.equal(result.status, 200)
  assert.equal(result.body.request.requestId, first.request.requestId)
  assert.equal((await f.trip('GET', `/availability-requests/${first.request.requestId}`, { user: 'client-2' })).status, 404)
})

test('later driver availability changes surface the held request for staff review and stop client payment', async (t) => {
  const f = availabilityFixture(t)
  const { request } = await f.estimateAndRequest()
  await f.logCall(request.requestId)
  const confirmed = await f.staff('POST', `/${request.requestId}/confirm`)
  const blocked = await f.vehicle('POST', '/car-1/unavailability', { user: 'driver', body: { startDate: tripInput.startDate, endDate: tripInput.endDate } })
  assert.equal(blocked.status, 201)
  const current = (await f.trip('GET', '/availability-requests/current')).body.request
  assert.equal(current.needsReview, true)
  const queue = await f.staff('GET', '/')
  assert.equal(queue.body.confirmedRequests[0].needsReview, true)
  const booking = await f.trip('POST', '/confirm', { body: { quoteId: confirmed.body.quoteId, accepted: true, contactSharingConsent: true, acceptedDisclosureIds: disclosureTypes } })
  assert.equal(booking.status, 409)
  assert.equal((await f.staff('POST', `/${request.requestId}/unavailable`)).status, 200, 'staff must be able to resolve the affected hold')
  assert.equal(f.sql.prepare('SELECT status FROM availability_requests').get().status, 'unavailable')
})

test('the staff queue keeps unanswered requests past seven days and includes audited call history', async (t) => {
  const f = availabilityFixture(t)
  const { request } = await f.estimateAndRequest()
  await f.logCall(request.requestId, 'no_answer')
  f.clock.now += 8 * 86400000
  const queue = await f.staff('GET', '/')
  assert.equal(queue.body.pendingRequests.length, 1)
  assert.equal(queue.body.pendingRequests[0].calls[0].outcome, 'no_answer')
  assert.equal(queue.body.pendingRequests[0].calls[0].actorName, 'staff')
})

test('availability intent and withdrawal record their actor and state changes', async (t) => {
  const f = availabilityFixture(t)
  const { request } = await f.estimateAndRequest()
  await f.trip('POST', `/availability-requests/${request.requestId}/withdraw`)
  const audit = f.sql.prepare('SELECT action, actor_user_id, prior_state, new_state FROM marketplace_audit_events WHERE target_id = ? ORDER BY rowid').all(request.requestId)
  assert.deepEqual(audit.map((event) => [event.action, event.actor_user_id, event.prior_state, event.new_state]), [
    ['availability_requested', 'client-1', null, 'requested'],
    ['availability_withdrawn', 'client-1', 'requested', 'withdrawn'],
  ])
})

test('concurrent expiry reads produce one state-transition audit and one client notice', async (t) => {
  const f = availabilityFixture(t)
  const { request } = await f.estimateAndRequest()
  await f.logCall(request.requestId)
  await f.staff('POST', `/${request.requestId}/confirm`)
  f.clock.now += 3600001
  await Promise.all([f.trip('GET', '/availability-requests/current'), f.trip('GET', '/availability-requests/current')])
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS count FROM marketplace_audit_events WHERE action = 'availability_quote_expired'").get().count, 1)
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS count FROM notification_events WHERE event_type = 'booking.availability_expired'").get().count, 1)
})

test('staff queue lists broad route summaries and contact access is separately authorized and audited', async (t) => {
  const f = availabilityFixture(t)
  const { request } = await f.estimateAndRequest()
  const queue = await f.staff('GET', '/')
  assert.equal(queue.body.pendingRequests[0].route.pickupArea, 'Kampala')
  assert.doesNotMatch(JSON.stringify(queue.body), /Private pickup|Private destination|phone_e164|national_id|TEST-ONLY-ID|client_user_id/u)
  assert.equal((await f.staff('GET', '/', { user: 'client-1' })).status, 403)
  assert.equal((await f.staff('POST', `/${request.requestId}/driver-contact`, { user: 'client-1' })).status, 403)
  const contact = await f.staff('POST', `/${request.requestId}/driver-contact`)
  assert.equal(contact.body.driver.phone, '+256700000001')
  assert.equal(f.sql.prepare("SELECT actor_user_id FROM marketplace_audit_events WHERE action = 'availability_driver_contact_accessed'").get().actor_user_id, 'staff')
})

test('booking cannot silently replace the driver saved in the estimate', async (t) => {
  const f = availabilityFixture(t)
  const { request } = await f.estimateAndRequest()
  await f.logCall(request.requestId)
  const confirmed = await f.staff('POST', `/${request.requestId}/confirm`)
  const original = f.sql.prepare('SELECT * FROM driver_applications').get()
  f.insert('driver_applications', { ...original, id: 'other-driver', user_id: 'client-2' })
  for (const doc of f.sql.prepare('SELECT * FROM driver_application_documents').all()) f.insert('driver_application_documents', { ...doc, id: `other-${doc.id}`, application_id: 'other-driver', object_key: `other-${doc.object_key}` })
  for (const acceptance of f.sql.prepare("SELECT * FROM policy_acceptances WHERE user_id = 'driver'").all()) f.insert('policy_acceptances', { ...acceptance, id: `other-${acceptance.id}`, user_id: 'client-2' })
  f.sql.exec("UPDATE vehicles SET driver_application_id = 'other-driver' WHERE id = 'car-1'")
  const booking = await f.trip('POST', '/confirm', { body: { quoteId: confirmed.body.quoteId, accepted: true, contactSharingConsent: true, acceptedDisclosureIds: disclosureTypes } })
  assert.equal(booking.status, 409)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM bookings').get().count, 0)
})

test('expired quote holds cannot create a booking or phone-sharing consent', async (t) => {
  const f = availabilityFixture(t)
  const { request } = await f.estimateAndRequest()
  await f.logCall(request.requestId)
  const confirmed = await f.staff('POST', `/${request.requestId}/confirm`)
  f.clock.now += 3600001
  const booking = await f.trip('POST', '/confirm', { body: { quoteId: confirmed.body.quoteId, accepted: true, contactSharingConsent: true, acceptedDisclosureIds: disclosureTypes } })
  assert.equal(booking.status, 409)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM bookings').get().count, 0)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM booking_contact_consents').get().count, 0)
})

test('adjacent requested dates do not overlap an existing quote hold', async (t) => {
  const f = availabilityFixture(t)
  const first = await f.estimateAndRequest()
  await f.logCall(first.request.requestId)
  await f.staff('POST', `/${first.request.requestId}/confirm`)
  const next = await f.estimateAndRequest({ user: 'client-2', body: { startDate: tripInput.endDate, endDate: '2099-01-09' } })
  await f.logCall(next.request.requestId)
  assert.equal((await f.staff('POST', `/${next.request.requestId}/confirm`)).status, 200)
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS count FROM availability_requests WHERE status = 'confirmed'").get().count, 2)
})

test('a deposit hold protects both its car and the same driver’s other car', async (t) => {
  const f = availabilityFixture(t)
  const first = await f.estimateAndRequest()
  const second = await f.estimateAndRequest({ user: 'client-2', body: { vehicleId: 'car-2' } })
  await f.logCall(first.request.requestId)
  await f.logCall(second.request.requestId)
  const confirmed = await f.staff('POST', `/${first.request.requestId}/confirm`)
  const body = { quoteId: confirmed.body.quoteId, accepted: true, contactSharingConsent: true, acceptedDisclosureIds: disclosureTypes }
  assert.equal((await f.trip('POST', '/confirm', { user: 'client-2', body })).status, 404)
  assert.equal((await f.trip('POST', '/confirm', { body })).status, 201)
  assert.equal((await f.trip('POST', '/confirm', { body })).status, 409)
  assert.equal((await f.staff('POST', `/${second.request.requestId}/confirm`)).status, 409)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM bookings').get().count, 1)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM trip_quotes').get().count, 1)
})

test('unavailable cars, rates, policies, dates, and either route leg cannot produce a saved estimate', async (t) => {
  const cases = [
    { name: 'unapproved car', setup: (f) => f.sql.exec("UPDATE vehicles SET status = 'suspended'"), status: 409 },
    { name: 'missing overnight rate', setup: (f) => f.sql.exec('UPDATE driver_applications SET lodging_rate_ugx = NULL'), status: 409 },
    { name: 'missing benchmark', setup: (f) => f.sql.exec('UPDATE vehicles SET benchmark_amount_ugx = NULL'), status: 409 },
    { name: 'missing active policy', setup: (f) => f.sql.exec('UPDATE fare_policies SET active = 0'), status: 409 },
    { name: 'past date', body: { startDate: '2098-12-30' }, status: 400 },
    { name: 'long trip', body: { endDate: '2099-01-15' }, status: 400 },
    { name: 'return route provider failure', setup: (f) => { f.maps.computeDrivingRoute = async (_env, origin) => origin.address.includes('destination') ? { kind: 'provider_error' } : { kind: 'route', distanceMeters: 80000, durationSeconds: 7200 } }, status: 503 },
    { name: 'no return route', setup: (f) => { f.maps.computeDrivingRoute = async (_env, origin) => origin.address.includes('destination') ? { kind: 'no_route' } : { kind: 'route', distanceMeters: 80000, durationSeconds: 7200 } }, status: 422 },
    { name: 'not signed in', user: null, status: 401 },
  ]
  for (const entry of cases) await t.test(entry.name, async (inner) => {
    const f = availabilityFixture(inner)
    entry.setup?.(f)
    const result = await f.trip('POST', '/estimates', { ...(entry.user === null ? { user: null } : {}), body: { ...tripInput, ...entry.body } })
    assert.equal(result.status, entry.status, JSON.stringify(result))
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM trip_estimates').get().count, 0)
  })
})

test('a nearest-rounding policy applies to new estimates for existing cars without rebasing or changing saved estimates', async (t) => {
  const f = availabilityFixture(t)
  f.sql.exec('UPDATE vehicles SET benchmark_amount_ugx = 400001')
  f.maps.computeDrivingRoute = async () => ({ kind: 'route', distanceMeters: 80001, durationSeconds: 7200 })
  const earlier = await f.estimateAndRequest()
  assert.equal(earlier.estimate.quote.totalAmount, 484008)
  const savedBasis = JSON.parse(f.sql.prepare("SELECT benchmark_basis_json FROM vehicles WHERE id='car-1'").get().benchmark_basis_json)
  f.sql.exec('UPDATE fare_policies SET active=0')
  f.insert('fare_policies', { id: 'fare-nearest', version: 'nearest-1', currency: 'UGX', active: 1, approved_at: 2, effective_at: 2, quote_ttl_seconds: 86400, hold_ttl_seconds: 1800, rules_json: JSON.stringify({
    vehicleBenchmark: { ...savedBasis, routeVersion: 'new-reference', roundTripDistanceMeters: 190000, rounding: 'nearest_per_leg' },
    components: [{ key: 'driver_lodging', label: 'Driver accommodation', amount: 1, unit: 'per_night' }], depositBasisPoints: 5000,
  }) })
  const next = await f.estimateAndRequest({ user: 'client-2' })
  assert.equal(next.estimate.quote.totalAmount, 484006)
  assert.equal(next.estimate.quote.vehicleFareBenchmark.basis.rounding, 'nearest_per_leg')
  assert.equal(next.estimate.quote.vehicleFareBenchmark.basis.roundTripDistanceMeters, 160000, 'new reference distance cannot silently change the existing car’s agreed benchmark ratio')
  assert.equal(next.estimate.quote.components.find((item) => item.key === 'outbound_transport').unitRate, 2500.00625)
  assert.equal(JSON.parse(f.sql.prepare("SELECT benchmark_basis_json FROM vehicles WHERE id='car-1'").get().benchmark_basis_json).rounding, 'ceiling_per_leg')
  const recovered = await f.trip('GET', `/estimates/${earlier.estimate.estimateId}`)
  assert.equal(recovered.status, 200)
  assert.equal(recovered.body.quote.totalAmount, 484008)
  assert.equal(recovered.body.quote.vehicleFareBenchmark.basis.rounding, 'ceiling_per_leg')
})

test('a malformed current rounding basis cannot silently fall back to an older car rule', async (t) => {
  const f = availabilityFixture(t)
  const basis = JSON.parse(f.sql.prepare("SELECT benchmark_basis_json FROM vehicles WHERE id='car-1'").get().benchmark_basis_json)
  const rules = JSON.parse(f.sql.prepare('SELECT rules_json FROM fare_policies WHERE active=1').get().rules_json)
  f.sql.prepare('UPDATE fare_policies SET rules_json=?').run(JSON.stringify({ ...rules, vehicleBenchmark: { ...basis, rounding: 'nearest_per_leg', roundTripDistanceMeters: 0 } }))
  const result = await f.trip('POST', '/estimates', { body: tripInput })
  assert.equal(result.status, 409)
  assert.equal(result.body.error.code, 'FARE_POLICY_UNAVAILABLE')
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM trip_estimates').get().count, 0)
})

test('a fresh estimate names the chosen car consistently before and after creating the staff request', async (t) => {
  const f = availabilityFixture(t)
  const estimated = await f.trip('POST', '/estimates', { body: { ...tripInput, vehicleId: 'car-2' } })
  assert.equal(estimated.status, 201)
  assert.equal(estimated.body.vehicleId, 'car-2')
  assert.deepEqual(estimated.body.vehicle, { make: 'Toyota', model: 'car-2', year: 2022 })
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM availability_requests').get().count, 0)
  const request = await f.trip('POST', `/estimates/${estimated.body.estimateId}/availability-request`)
  assert.equal(request.status, 201)
  const recovered = await f.trip('GET', '/availability-requests/current')
  assert.deepEqual(recovered.body.request.estimate.vehicle, estimated.body.vehicle)
  assert.equal(recovered.body.request.estimate.vehicleId, 'car-2')
})
