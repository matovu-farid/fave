import test from 'node:test'
import assert from 'node:assert/strict'
import { availabilityFixture, disclosureTypes, tripInput } from './helpers/availability-fixture.mjs'

async function deliveryFixture(t) {
  const f = availabilityFixture(t)
  const { request } = await f.estimateAndRequest()
  await f.logCall(request.requestId)
  assert.equal((await f.staff('POST', `/${request.requestId}/confirm`)).status, 200)
  const deliveryId = f.sql.prepare('SELECT delivery_id FROM notification_outbox').get().delivery_id
  const delivery = f.loadWorkerModule('notification-delivery')
  function token(id, user = 'client-1', registeredAt = f.clock.now) {
    f.insert('notification_push_tokens', { id, user_id: user, token: `ExpoPushToken[${id}]`, platform: 'ios', created_at: 1, last_registered_at: registeredAt })
  }
  async function send(fetcher) {
    const calls = { ack: 0, retry: 0 }
    await delivery.handleNotificationQueue({ queue: 'fave-notification-delivery', messages: [{
      body: { deliveryId }, ack() { calls.ack++ }, retry() { calls.retry++ },
    }] }, { DB: f.DB }, fetcher, f.clock.now)
    return calls
  }
  return { ...f, ...delivery, deliveryId, token, send }
}

const accepted = (id = 'ticket-1') => Response.json({ data: { status: 'ok', id } })

test('a real persisted availability event reaches its client’s registered device', async (t) => {
  const f = await deliveryFixture(t)
  f.token('phone')
  const sent = []
  assert.deepEqual(await f.send(async (_url, options) => { sent.push(JSON.parse(options.body)); return accepted() }), { ack: 1, retry: 0 })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].to, 'ExpoPushToken[phone]')
  assert.equal(f.sql.prepare('SELECT status FROM notification_deliveries').get().status, 'expo_accepted')
})

test('delivery suppresses a recipient who does not own the referenced availability request', async (t) => {
  const f = await deliveryFixture(t)
  f.sql.exec("UPDATE notifications SET recipient_user_id='client-2'; UPDATE notification_outbox SET recipient_user_id='client-2'")
  f.token('other-account', 'client-2')
  let sends = 0
  const calls = await f.send(async () => { sends++; return accepted() })
  assert.equal(sends, 0)
  assert.deepEqual(calls, { ack: 1, retry: 0 })
  assert.equal(f.sql.prepare('SELECT status FROM notification_outbox').get().status, 'suppressed')
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM notifications').get().count, 1, 'push suppression must not delete the inbox')
})

for (const change of ['switch account', 'disable push']) test(`a device cannot receive an old alert after ${change} while another device is sending`, async (t) => {
  const f = await deliveryFixture(t)
  f.token('first-phone', 'client-1', f.clock.now + 1)
  f.token('second-phone')
  const sent = []
  await f.send(async (_url, options) => {
    sent.push(JSON.parse(options.body).to)
    if (sent.length === 1) {
      if (change === 'switch account') f.sql.exec("UPDATE notification_push_tokens SET user_id='client-2' WHERE id='second-phone'")
      else f.sql.exec("DELETE FROM notification_push_tokens WHERE id='second-phone'")
    }
    return accepted(`ticket-${sent.length}`)
  })
  assert.deepEqual(sent, ['ExpoPushToken[first-phone]'])
})

test('sign-out during an in-flight push keeps its accepted ticket without attaching it to a removed token', async (t) => {
  const f = await deliveryFixture(t)
  f.token('phone')
  const calls = await f.send(async () => {
    f.sql.exec("DELETE FROM notification_push_tokens WHERE id='phone'")
    return accepted()
  })
  assert.deepEqual(calls, { ack: 1, retry: 0 })
  const attempt = f.sql.prepare('SELECT status, expo_ticket_id, push_token_id FROM notification_deliveries').get()
  assert.equal(attempt.status, 'expo_accepted')
  assert.equal(attempt.expo_ticket_id, 'ticket-1')
  assert.equal(attempt.push_token_id, null)
})

test('a delayed invalid-token receipt cannot remove a registration that now belongs to another account', async (t) => {
  const f = await deliveryFixture(t)
  f.token('phone')
  await f.send(async () => accepted())
  f.sql.exec("UPDATE notification_push_tokens SET user_id='client-2' WHERE id='phone'")
  f.clock.now += 20 * 60000
  await f.sweepExpoReceipts({ DB: f.DB }, async () => Response.json({ data: {
    'ticket-1': { status: 'error', details: { error: 'DeviceNotRegistered' } },
  } }), f.clock.now)
  assert.equal(f.sql.prepare("SELECT user_id FROM notification_push_tokens WHERE id='phone'").get()?.user_id, 'client-2')
  assert.equal(f.sql.prepare('SELECT status FROM notification_deliveries').get().status, 'device_unregistered')
})

test('operator retry rechecks the domain owner before enqueuing a failed delivery', async (t) => {
  const f = await deliveryFixture(t)
  f.sql.exec("UPDATE notifications SET recipient_user_id='client-2'; UPDATE notification_outbox SET recipient_user_id='client-2', status='failed'")
  f.token('other-account', 'client-2')
  const app = f.loadWorkerModule('admin-notifications').default
  f.insert('notification_deliveries', { id: 'failed-attempt', delivery_id: f.deliveryId, push_token_id: 'other-account', platform: 'ios', status: 'failed', attempt_count: 1, created_at: f.clock.now, updated_at: f.clock.now })
  let enqueued = 0
  const response = await app.request(`https://fave.test/${f.deliveryId}/retry`, {
    method: 'POST', headers: { 'x-test-user': 'staff' },
  }, { DB: f.DB, NOTIFICATION_QUEUE: { async send() { enqueued++ } } })
  assert.equal(response.status, 200, 'a completed suppression check is a result the operations UI can render')
  assert.deepEqual(await response.json(), { result: 'suppressed' })
  assert.equal(enqueued, 0)
  assert.equal(f.sql.prepare('SELECT status FROM notification_outbox').get().status, 'suppressed')
  assert.equal(f.sql.prepare('SELECT result FROM notification_retry_audit').get().result, 'suppressed')
  const health = await app.request('https://fave.test/health', { headers: { 'x-test-user': 'staff' } }, { DB: f.DB })
  assert.equal((await health.json()).failures.length, 0, 'a suppressed delivery must not keep offering a retry')
})

test('recipient access is checked again between device sends', async (t) => {
  const f = await deliveryFixture(t)
  f.token('first-phone', 'client-1', f.clock.now + 1)
  f.token('second-phone')
  let sends = 0
  const calls = await f.send(async () => {
    sends++
    f.sql.exec("UPDATE availability_requests SET client_user_id='client-2'")
    return accepted()
  })
  assert.equal(sends, 1)
  assert.deepEqual(calls, { ack: 1, retry: 0 })
  assert.equal(f.sql.prepare('SELECT status FROM notification_outbox').get().status, 'suppressed')
})

test('an invalid-token response cannot delete a token that switches accounts during the request', async (t) => {
  const f = await deliveryFixture(t)
  f.token('phone')
  await f.send(async () => {
    f.sql.exec("UPDATE notification_push_tokens SET user_id='client-2' WHERE id='phone'")
    return Response.json({ data: { status: 'error', details: { error: 'DeviceNotRegistered' } } })
  })
  assert.equal(f.sql.prepare('SELECT user_id FROM notification_push_tokens').get().user_id, 'client-2')
  assert.equal(f.sql.prepare('SELECT push_token_id FROM notification_deliveries').get().push_token_id, null)
})

test('completed delivery replay does not send an old notification to a newly registered phone', async (t) => {
  const f = await deliveryFixture(t)
  f.token('phone')
  let sends = 0
  const fetcher = async () => { sends++; return accepted() }
  await f.send(fetcher)
  f.token('new-phone')
  await f.send(fetcher)
  assert.equal(sends, 1)
})

test('legacy offer audiences follow allowed contract roles and the approved driver record', async (t) => {
  const f = availabilityFixture(t)
  f.insert('driver_trip_offers', {
    id: 'offer', client_user_id: 'client-1', driver_application_id: 'driver-app', vehicle_id: 'car-1',
    origin_json: '{}', destination_json: '{}', start_date: tripInput.startDate, end_date: tripInput.endDate,
    party_size: 2, luggage_count: 1, status: 'pending', expires_at: f.clock.now + 900000, created_at: f.clock.now,
  })
  const { getNotificationContract } = f.loadWorkerModule('notification-contracts')
  const { isNotificationRecipientEligible } = f.loadWorkerModule('notification-audience')
  const check = (eventType, recipientUserId) => {
    const contract = getNotificationContract(eventType)
    return isNotificationRecipientEligible(f.DB, {
      ...contract, eventType, targetId: 'offer', recipientUserId,
    })
  }
  assert.equal(await check('booking.driver_offer_created', 'driver'), true)
  assert.equal(await check('booking.driver_offer_created', 'client-1'), false, 'client ownership is not a driver role')
  assert.equal(await check('booking.driver_offer_declined', 'client-1'), true)
  assert.equal(await check('booking.driver_offer_declined', 'client-2'), false)
  f.sql.exec("UPDATE driver_applications SET status='rejected'")
  assert.equal(await check('booking.driver_offer_created', 'driver'), false)
  assert.equal(await check('booking.driver_offer_declined', 'client-1'), true, 'client history remains available after driver revocation')
})

test('booking audiences use the saved driver rather than a later car owner and honor admin revocation', async (t) => {
  const f = availabilityFixture(t)
  const { request } = await f.estimateAndRequest()
  await f.logCall(request.requestId)
  const quote = await f.staff('POST', `/${request.requestId}/confirm`)
  const booking = await f.trip('POST', '/confirm', { body: {
    quoteId: quote.body.quoteId, accepted: true, contactSharingConsent: true, acceptedDisclosureIds: disclosureTypes,
  } })
  assert.equal(booking.status, 201)
  const { getNotificationContract } = f.loadWorkerModule('notification-contracts')
  const { isNotificationRecipientEligible } = f.loadWorkerModule('notification-audience')
  const check = (recipientUserId, eventType = 'booking.cancelled') => isNotificationRecipientEligible(f.DB, {
    ...getNotificationContract(eventType), eventType, targetId: booking.body.bookingId, recipientUserId,
  })
  assert.equal(await check('client-1'), true)
  assert.equal(await check('driver'), true)
  assert.equal(await check('staff'), true)
  assert.equal(await check('client-2'), false)
  assert.equal(await check('driver', 'booking.expired'), false, 'client-only contracts cannot target the driver')
  f.insert('driver_applications', { id: 'other-driver', user_id: 'client-2', legal_name: 'Other', phone_e164: '+256700000002', national_id_number: 'TEST-ONLY-OTHER', national_id_last4: '0002', status: 'approved', created_at: 1, updated_at: 1 })
  f.sql.exec("UPDATE vehicles SET driver_application_id='other-driver'; UPDATE admin_memberships SET active=0")
  assert.equal(await check('driver'), true)
  assert.equal(await check('client-2'), false, 'car reassignment alone cannot grant access to a saved booking')
  assert.equal(await check('staff'), false)
})

test('unknown event contracts, inconsistent templates and future domains without an audience lookup fail closed', async (t) => {
  const f = await deliveryFixture(t)
  const { getNotificationContract } = f.loadWorkerModule('notification-contracts')
  const { loadNotificationDelivery, isNotificationRecipientEligible } = f.loadWorkerModule('notification-audience')
  const original = await loadNotificationDelivery(f.DB, f.deliveryId)
  for (const patch of [{ eventType: 'constructor' }, { eventVersion: 99 }, { templateKey: 'safety_incident_updated' }, { routeKey: 'https://example.test' }, { priority: 'urgent' }]) {
    assert.equal(await isNotificationRecipientEligible(f.DB, { ...original, ...patch }), false)
  }
  assert.equal(await isNotificationRecipientEligible(f.DB, {
    ...getNotificationContract('payment.balance_paid'), eventType: 'payment.balance_paid',
    targetId: 'future-payment', recipientUserId: 'client-1',
  }), false)
})
