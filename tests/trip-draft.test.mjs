import test from 'node:test'
import assert from 'node:assert/strict'

import { createTripDraftStore, getBookingProgress, hasActiveDepositHold, hasTripDraftContent, restoreSelectedVehicleId } from '../src/lib/trip-draft.ts'

function createMemoryStorage(initial = null) {
  let value = initial
  return {
    async getItem() { return value },
    async setItem(_key, nextValue) { value = nextValue },
    async removeItem() { value = null },
    read() { return value },
  }
}

const draft = {
  pickup: 'Kampala Road',
  destination: 'Jinja',
  pickupPin: { latitude: 0.3136, longitude: 32.5811 },
  startDate: '2026-11-01',
  endDate: '2026-11-02',
  partySize: '2',
  luggageCount: '1',
  selectedVehicle: 'vehicle-1',
}

test('trip draft store restores the signed-in user draft and preserves map pin coordinates', async () => {
  const storage = createMemoryStorage()
  const tripDrafts = createTripDraftStore(storage)

  await tripDrafts.save('client-1', draft)

  assert.deepEqual(await tripDrafts.load('client-1'), draft)
})

test('trip draft store removes a draft owned by a different signed-in user', async () => {
  const storage = createMemoryStorage()
  const tripDrafts = createTripDraftStore(storage)
  await tripDrafts.save('client-1', draft)

  assert.equal(await tripDrafts.load('client-2'), null)
  assert.equal(storage.read(), null)
})

test('trip draft store discards malformed or unsupported saved data', async () => {
  const storage = createMemoryStorage('{not-json')
  const tripDrafts = createTripDraftStore(storage)

  assert.equal(await tripDrafts.load('client-1'), null)
  assert.equal(storage.read(), null)
})

test('trip draft store restores an earlier draft without a saved vehicle selection', async () => {
  const olderDraft = { ...draft }
  delete olderDraft.selectedVehicle
  const storage = createMemoryStorage(JSON.stringify({ version: 1, userId: 'client-1', draft: olderDraft }))
  const tripDrafts = createTripDraftStore(storage)

  assert.deepEqual(await tripDrafts.load('client-1'), { ...olderDraft, selectedVehicle: '' })
})

test('trip draft is meaningful only after the client enters trip information', () => {
  assert.equal(hasTripDraftContent({
    pickup: '', destination: '', pickupPin: null, startDate: '', endDate: '', partySize: '1', luggageCount: '0', selectedVehicle: '',
  }), false)
  assert.equal(hasTripDraftContent(draft), true)
})

test('booking progress marks earlier stages complete and the current stage clearly', () => {
  assert.deepEqual(getBookingProgress('driver'), [
    { id: 'trip', label: 'Trip details', state: 'complete' },
    { id: 'driver', label: 'Driver response', state: 'current' },
    { id: 'quote', label: 'Quote and terms', state: 'upcoming' },
    { id: 'deposit', label: 'Deposit', state: 'upcoming' },
  ])
})

test('trip draft restoration never silently substitutes an unavailable selected car', () => {
  assert.equal(restoreSelectedVehicleId('vehicle-1', ['vehicle-1', 'vehicle-2']), 'vehicle-1')
  assert.equal(restoreSelectedVehicleId('vehicle-1', ['vehicle-2']), '')
})

test('booking progress restores the deposit step while a pending deposit hold is active', () => {
  assert.equal(hasActiveDepositHold([
    { status: 'deposit_pending', holdExpiresAt: 2_000 },
  ], 1_000), true)
})

test('booking progress ignores expired and already settled deposit holds', () => {
  assert.equal(hasActiveDepositHold([
    { status: 'deposit_pending', holdExpiresAt: 999 },
    { status: 'confirmed', holdExpiresAt: 2_000 },
  ], 1_000), false)
})
