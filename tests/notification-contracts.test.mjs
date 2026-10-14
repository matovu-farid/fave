import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getNotificationContract,
  validateNotificationEvent,
} from '../fave-worker/src/notification-contracts.ts'

const expectedEventTypes = [
  'booking.quote_requested',
  'booking.driver_offer_created',
  'booking.driver_offer_accepted',
  'booking.driver_offer_declined',
  'booking.driver_offer_expired',
  'booking.hold_created',
  'booking.withdrawn',
  'booking.quote_status_changed',
  'booking.deposit_status_changed',
  'booking.cancelled',
  'booking.expired',
  'driver.assignment_changed',
  'driver.assignment_reassigned',
  'trip.progress_changed',
  'trip.check_in_required',
  'payment.balance_due',
  'payment.balance_paid',
  'safety.incident_updated',
  'support.update',
]

test('notification V1 catalog defines every booking, payment, trip, and safety contract', () => {
  for (const eventType of expectedEventTypes) {
    const contract = getNotificationContract(eventType)
    assert.ok(contract, `missing ${eventType}`)
    assert.equal(contract.eventVersion, 1)
    assert.ok(contract.allowedRecipientRoles.length > 0)
    assert.ok(contract.templateKey)
    assert.ok(contract.routeKey)
    assert.ok(['ordinary', 'urgent', 'time_sensitive'].includes(contract.priority))
  }
})

test('driver offer contract is driver-only, time-sensitive, and expires with the offer', () => {
  const contract = getNotificationContract('booking.driver_offer_created')
  assert.deepEqual(contract.allowedRecipientRoles, ['driver'])
  assert.equal(contract.priority, 'time_sensitive')
  assert.equal(contract.expiryPolicy, 'domain')
  assert.equal(contract.routeKey, 'driver_offers')
})

test('safety and payment contracts bypass quiet hours only when marked urgent', () => {
  assert.equal(getNotificationContract('safety.incident_updated').priority, 'urgent')
  assert.equal(getNotificationContract('payment.balance_paid').priority, 'urgent')
  assert.equal(getNotificationContract('trip.progress_changed').priority, 'ordinary')
})

test('event validation rejects unknown, wrong-domain, wrong-role, duplicate-recipient, and expired inputs', () => {
  const valid = {
    id: 'event-1',
    eventType: 'booking.driver_offer_created',
    eventVersion: 1,
    domainType: 'trip_offer',
    domainId: 'offer-1',
    occurredAt: 100,
    expiresAt: 200,
    recipients: [{ userId: 'driver-1', role: 'driver' }],
  }

  assert.doesNotThrow(() => validateNotificationEvent(valid))
  assert.throws(() => validateNotificationEvent({ ...valid, eventType: 'arbitrary.event' }), /Unknown notification event/u)
  assert.throws(() => validateNotificationEvent({ ...valid, domainType: 'payment' }), /does not support domain/u)
  assert.throws(() => validateNotificationEvent({ ...valid, recipients: [{ userId: 'client-1', role: 'client' }] }), /recipient role/u)
  assert.throws(() => validateNotificationEvent({
    ...valid,
    recipients: [{ userId: 'driver-1', role: 'driver' }, { userId: 'driver-1', role: 'driver' }],
  }), /duplicate recipient/u)
  assert.throws(() => validateNotificationEvent({ ...valid, expiresAt: 100 }), /expiry/u)
  assert.throws(() => validateNotificationEvent({ ...valid, route: 'https://attacker.test' }), /unexpected field/u)
})
