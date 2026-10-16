import test from 'node:test'
import assert from 'node:assert/strict'
import { availabilityFixture, disclosureTypes, tripInput } from './helpers/availability-fixture.mjs'

async function confirmAvailability(f) {
  const { request } = await f.estimateAndRequest()
  await f.logCall(request.requestId)
  const confirmed = await f.staff('POST', `/${request.requestId}/confirm`)
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed))
  return confirmed.body
}

test('drivers see date-only quote holds after staff confirmation, but no hold for a pending request', async (t) => {
  const f = availabilityFixture(t)
  const { request } = await f.estimateAndRequest()
  const availability = () => f.vehicle('GET', '/car-1/availability', { user: 'driver' })
  assert.deepEqual((await availability()).body.holdsAndBookings, [])
  await f.logCall(request.requestId)
  const confirmed = await f.staff('POST', `/${request.requestId}/confirm`)
  assert.equal(confirmed.status, 200)
  const result = await availability()
  assert.equal(result.status, 200)
  assert.deepEqual(result.body.holdsAndBookings, [{
    start_date: tripInput.startDate,
    end_date: tripInput.endDate,
    status: 'quote_hold',
    hold_expires_at: confirmed.body.holdExpiresAt,
  }])
})

test('expired quote holds disappear from driver availability without waiting for cron', async (t) => {
  const f = availabilityFixture(t)
  const confirmed = await confirmAvailability(f)
  f.clock.now = confirmed.holdExpiresAt
  const result = await f.vehicle('GET', '/car-1/availability', { user: 'driver' })
  assert.deepEqual(result.body.holdsAndBookings, [])
})

test('booking conversion replaces a quote hold with one deposit hold in driver availability', async (t) => {
  const f = availabilityFixture(t)
  const confirmed = await confirmAvailability(f)
  const booking = await f.trip('POST', '/confirm', { body: {
    quoteId: confirmed.quoteId, accepted: true, contactSharingConsent: true, acceptedDisclosureIds: disclosureTypes,
  } })
  assert.equal(booking.status, 201)
  const result = await f.vehicle('GET', '/car-1/availability', { user: 'driver' })
  assert.equal(result.body.holdsAndBookings.length, 1)
  assert.equal(result.body.holdsAndBookings[0].status, 'deposit_pending')
})

test('quote holds remain private to the vehicle owner and do not appear on a different car', async (t) => {
  const f = availabilityFixture(t)
  await confirmAvailability(f)
  for (const user of ['client-1', 'client-2', 'staff', null]) {
    const result = await f.vehicle('GET', '/car-1/availability', { user })
    assert.equal(result.status, user ? 404 : 401)
    assert.equal(result.body.holdsAndBookings, undefined)
  }
  assert.deepEqual((await f.vehicle('GET', '/car-2/availability', { user: 'driver' })).body.holdsAndBookings, [])
})
