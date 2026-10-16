import test from 'node:test'
import assert from 'node:assert/strict'
import { availabilityFixture, disclosureTypes } from './helpers/availability-fixture.mjs'

async function depositHold(f) {
  const { request } = await f.estimateAndRequest()
  assert.equal((await f.logCall(request.requestId)).status, 201)
  const confirmed = await f.staff('POST', `/${request.requestId}/confirm`)
  assert.equal(confirmed.status, 200)
  const booking = await f.trip('POST', '/confirm', { body: {
    quoteId: confirmed.body.quoteId, accepted: true, contactSharingConsent: true,
    acceptedDisclosureIds: disclosureTypes,
  } })
  assert.equal(booking.status, 201)
  return booking.body
}

function snapshot(f) {
  return Object.fromEntries([
    'bookings', 'availability_requests', 'trip_quotes', 'booking_contact_consents',
    'policy_acceptances', 'marketplace_audit_events',
    'notification_events', 'notifications', 'notification_outbox',
  ].map((table) => [table, f.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
}

function expiryRows(f, bookingId) {
  const eventId = `booking.expired:${bookingId}`
  return {
    events: f.sql.prepare('SELECT * FROM notification_events WHERE id = ?').all(eventId),
    inbox: f.sql.prepare('SELECT * FROM notifications WHERE event_id = ?').all(eventId),
    outbox: f.sql.prepare('SELECT * FROM notification_outbox WHERE event_id = ?').all(eventId),
    audit: f.sql.prepare("SELECT * FROM marketplace_audit_events WHERE action = 'booking_hold_expired' AND target_id = ?").all(bookingId),
  }
}

function assertExpired(f, booking) {
  const row = f.sql.prepare('SELECT status, updated_at FROM bookings WHERE id = ?').get(booking.bookingId)
  assert.equal(row.status, 'expired')
  assert.equal(row.updated_at, f.clock.now)
  const { events, inbox, outbox, audit } = expiryRows(f, booking.bookingId)
  assert.equal(events.length, 1)
  assert.equal(inbox.length, 1)
  assert.equal(outbox.length, 1)
  assert.equal(audit.length, 1)
  const event = events[0]
  assert.deepEqual({ ...event }, {
    id: `booking.expired:${booking.bookingId}`, event_type: 'booking.expired', event_version: 1,
    domain_type: 'booking', domain_id: booking.bookingId, occurred_at: f.clock.now,
    expires_at: null, payload_json: '{}', created_at: f.clock.now,
  })
  assert.equal(inbox[0].recipient_user_id, 'client-1')
  assert.equal(inbox[0].template_key, 'booking_expired')
  assert.equal(inbox[0].route_key, 'booking')
  assert.equal(inbox[0].priority, 'ordinary')
  assert.equal(inbox[0].read_at, null)
  assert.equal(inbox[0].created_at, f.clock.now)
  assert.equal(outbox[0].notification_id, inbox[0].id)
  assert.equal(outbox[0].recipient_user_id, 'client-1')
  assert.equal(outbox[0].status, 'pending')
  assert.equal(outbox[0].expires_at, null)
  assert.equal(outbox[0].attempt_count, 0)
  assert.equal(outbox[0].created_at, f.clock.now)
  assert.equal(outbox[0].not_before, f.clock.now, 'fixture expiry occurs during Kampala daytime')
  assert.equal(audit[0].actor_user_id, null)
  assert.equal(audit[0].actor_type, 'system')
  assert.equal(audit[0].target_type, 'booking')
  assert.equal(audit[0].prior_state, 'deposit_pending')
  assert.equal(audit[0].new_state, 'expired')
  assert.equal(audit[0].created_at, f.clock.now)
}

test('deposit expiry waits until the exact hold deadline and persists one generic client notice', async (t) => {
  const f = availabilityFixture(t)
  const booking = await depositHold(f)
  const expire = () => f.loadWorkerModule('bookings').expireDepositPendingBookings({ DB: f.DB })
  const before = snapshot(f)
  f.clock.now = booking.holdExpiresAt - 1
  assert.equal(await expire(), 0)
  assert.deepEqual(snapshot(f), before, 'an unexpired hold has no state, audit or notification changes')

  f.clock.now = booking.holdExpiresAt
  assert.equal(await expire(), 1)
  assertExpired(f, booking)
  for (const table of ['notification_events', 'notifications', 'notification_outbox', 'marketplace_audit_events']) {
    assert.equal(snapshot(f)[table].length, before[table].length + 1, table)
  }
  const after = snapshot(f)
  f.clock.now += 60000
  assert.equal(await expire(), 0)
  assert.deepEqual(snapshot(f), after, 'a repeated scheduled sweep must not change or duplicate expiry artifacts')
})

test('competing deposit sweeps count and notify the expiry only once', async (t) => {
  const f = availabilityFixture(t)
  const booking = await depositHold(f)
  f.clock.now = booking.holdExpiresAt + 1
  const { expireDepositPendingBookings } = f.loadWorkerModule('bookings')
  const results = await Promise.all([
    expireDepositPendingBookings({ DB: f.DB }), expireDepositPendingBookings({ DB: f.DB }),
  ])
  assert.deepEqual(results.sort(), [0, 1])
  assertExpired(f, booking)
})

for (const failure of ['outbox', 'audit']) {
  test(`deposit expiry rolls back every write after ${failure} persistence fails and retries safely`, async (t) => {
    const f = availabilityFixture(t)
    const booking = await depositHold(f)
    f.clock.now = booking.holdExpiresAt
    const expire = () => f.loadWorkerModule('bookings').expireDepositPendingBookings({ DB: f.DB })
    const before = snapshot(f)
    const table = failure === 'outbox' ? 'notification_outbox' : 'marketplace_audit_events'
    f.sql.exec(`CREATE TRIGGER reject_test_deposit_expiry BEFORE INSERT ON ${table}
      BEGIN SELECT RAISE(ABORT, 'injected deposit expiry failure'); END`)
    await assert.rejects(expire, /injected deposit expiry failure/u)
    assert.deepEqual(snapshot(f), before, 'booking, audit, event, inbox and outbox must all roll back')
    assert.deepEqual(expiryRows(f, booking.bookingId), { events: [], inbox: [], outbox: [], audit: [] })

    f.sql.exec('DROP TRIGGER reject_test_deposit_expiry')
    assert.equal(await expire(), 1)
    assertExpired(f, booking)
    const after = snapshot(f)
    assert.equal(await expire(), 0)
    assert.deepEqual(snapshot(f), after)
  })
}

for (const competingWrite of ['confirmation', 'hold extension']) {
  test(`a competing ${competingWrite} wins after the deposit sweep reads its candidate`, async (t) => {
    const f = availabilityFixture(t)
    const booking = await depositHold(f)
    f.clock.now = booking.holdExpiresAt
    const before = snapshot(f)
    const batch = f.DB.batch.bind(f.DB)
    let competingState
    let batches = 0
    f.DB.batch = async (statements) => {
      batches += 1
      if (competingWrite === 'confirmation') {
        f.sql.prepare("UPDATE bookings SET status = 'confirmed', updated_at = ? WHERE id = ?")
          .run(f.clock.now, booking.bookingId)
      } else {
        f.sql.prepare('UPDATE bookings SET hold_expires_at = ?, updated_at = ? WHERE id = ?')
          .run(f.clock.now + 1800000, f.clock.now, booking.bookingId)
      }
      competingState = snapshot(f)
      return batch(statements)
    }
    const { expireDepositPendingBookings } = f.loadWorkerModule('bookings')
    assert.equal(await expireDepositPendingBookings({ DB: f.DB }), 0)
    assert.equal(batches, 1, 'the competing write must occur after the candidate was selected')
    assert.deepEqual(snapshot(f), competingState, 'the losing expiry must not overwrite the winning write')
    assert.deepEqual(expiryRows(f, booking.bookingId), { events: [], inbox: [], outbox: [], audit: [] })
    for (const table of ['marketplace_audit_events', 'notification_events', 'notifications', 'notification_outbox']) {
      assert.deepEqual(snapshot(f)[table], before[table], table)
    }
  })
}
