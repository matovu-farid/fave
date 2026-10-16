import test from 'node:test'
import assert from 'node:assert/strict'
import { getAvailabilityView, getRestorableLegacyQuote, isAwaitingAvailability, tripDraftFromEstimate } from '../src/lib/trip-availability.ts'

const estimate = {
  estimateId: 'estimate-1', vehicleId: 'car-1',
  pickup: { address: 'Pinned pickup', input: { latitude: 0.3, longitude: 32.5 } },
  destination: { address: 'Jinja', input: { address: 'Jinja' } },
  route: { distanceMeters: 80000, durationSeconds: 7200 },
  startDate: '2099-01-05', endDate: '2099-01-07', partySize: 3, luggageCount: 2,
  quote: { currency: 'UGX', totalAmount: 484000, components: [] },
}
const request = {
  requestId: 'request-1', estimateId: estimate.estimateId, estimate,
  status: 'requested', quoteId: 'quote-1', quote: estimate.quote,
  holdExpiresAt: 2000, expiresAt: 2000, needsReview: false,
}

test('a pending staff check never exposes a payment quote or a driver timeout', () => {
  const view = getAvailabilityView(request, 1000)
  assert.equal(view.phase, 'checking')
  assert.equal(view.quote, null)
})

test('a confirmed request uses the final quote ID and exact saved price', () => {
  const view = getAvailabilityView({ ...request, status: 'confirmed' }, 1000)
  assert.equal(view.phase, 'quote')
  assert.equal(view.quote.quoteId, 'quote-1')
  assert.deepEqual(view.quote.quote, estimate.quote)
  assert.deepEqual(view.quote.route, estimate.route)
})

test('expired and changed availability cannot keep a payment quote on screen', () => {
  assert.equal(getAvailabilityView({ ...request, status: 'confirmed' }, 2000).phase, 'expired')
  assert.equal(getAvailabilityView({ ...request, status: 'confirmed' }, 2000).quote, null)
  assert.equal(getAvailabilityView({ ...request, status: 'confirmed', needsReview: true }, 1000).phase, 'review')
  assert.equal(getAvailabilityView({ ...request, status: 'confirmed', needsReview: true }, 1000).quote, null)
  for (const status of ['withdrawn', 'unavailable', 'expired', 'converted_to_booking']) {
    assert.equal(getAvailabilityView({ ...request, status }, 1000).quote, null)
  }
})

test('reopening a saved request restores the original dates, party size, vehicle and map pin', () => {
  assert.deepEqual(tripDraftFromEstimate(estimate), {
    pickup: 'Pinned pickup', pickupPin: { latitude: 0.3, longitude: 32.5 }, destination: 'Jinja',
    startDate: '2099-01-05', endDate: '2099-01-07', partySize: '3', luggageCount: '2',
    selectedVehicle: 'car-1', estimateId: 'estimate-1',
  })
})

test('an existing accepted driver quote stays usable during the staff-flow transition', () => {
  const quote = getAvailabilityView({ ...request, status: 'confirmed' }, 1000).quote
  const legacy = { offerId: 'old-offer', status: 'quoted', quote }
  assert.deepEqual(getRestorableLegacyQuote(legacy, false, 1000), quote)
  assert.equal(getRestorableLegacyQuote(legacy, true, 1000), null, 'an active staff request takes precedence')
  assert.equal(getRestorableLegacyQuote(legacy, false, 2000), null, 'expired legacy quotes cannot be restored')
})

test('a quote that expires during a staff recheck leaves the waiting step so the client can start again', () => {
  assert.equal(isAwaitingAvailability({ ...request, status: 'confirmed', needsReview: true }), true)
  assert.equal(isAwaitingAvailability({ ...request, status: 'expired', needsReview: true }), false)
  assert.equal(isAwaitingAvailability({ ...request, status: 'unavailable', needsReview: true }), false)
  assert.equal(getAvailabilityView({ ...request, status: 'expired', needsReview: true }, 2000).phase, 'expired')
})
