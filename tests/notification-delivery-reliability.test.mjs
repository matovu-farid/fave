import test from 'node:test'
import assert from 'node:assert/strict'
import { availabilityFixture } from './helpers/availability-fixture.mjs'

async function fixture(t, { ordinary = false } = {}) {
  const f = availabilityFixture(t)
  const { request } = await f.estimateAndRequest()
  await f.logCall(request.requestId)
  await f.staff('POST', `/${request.requestId}/${ordinary ? 'unavailable' : 'confirm'}`)
  const deliveryId = f.sql.prepare('SELECT delivery_id FROM notification_outbox').get().delivery_id
  f.insert('notification_push_tokens', { id: 'phone', user_id: 'client-1', token: 'ExpoPushToken[phone]', platform: 'ios', created_at: 1, last_registered_at: 1 })
  const delivery = f.loadWorkerModule('notification-delivery')
  const queued = []
  const env = { DB: f.DB, NOTIFICATION_QUEUE: { async send(body) { queued.push(JSON.parse(JSON.stringify(body))) } } }
  async function send(fetcher, body = { deliveryId }, queue = 'fave-notification-delivery') {
    const calls = { ack: 0, retries: [] }
    await delivery.handleNotificationQueue({ queue, messages: [{ body, ack() { calls.ack++ }, retry(options) { calls.retries.push(options) } }] }, env, fetcher, f.clock.now)
    return calls
  }
  async function operatorRetry() {
    const response = await f.loadWorkerModule('admin-notifications').default.request(`https://fave.test/${deliveryId}/retry`, {
      method: 'POST', headers: { 'x-test-user': 'staff' },
    }, env)
    assert.equal(response.status, 202)
  }
  return { ...f, ...delivery, env, queued, deliveryId, send, operatorRetry }
}
const accepted = (id = 'ticket-1') => Response.json({ data: { status: 'ok', id } })

test('overlapping consumers do not both send the same device push', async (t) => {
  const f = await fixture(t)
  let enter
  let release
  const entered = new Promise((resolve) => { enter = resolve })
  const held = new Promise((resolve) => { release = resolve })
  let sends = 0
  const first = f.send(async () => { sends++; enter(); await held; return accepted('ticket-first') })
  await entered
  try { await f.send(async () => { sends++; return accepted('ticket-duplicate') }) }
  finally { release(); await first }
  assert.equal(sends, 1)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM notification_deliveries').get().count, 1)
})

test('a delayed ordinary Queue message defers to 08:00 Kampala even when it was due earlier', async (t) => {
  const f = await fixture(t, { ordinary: true })
  f.clock.now = Date.parse('2099-01-01T18:00:00Z')
  let sends = 0
  const result = await f.send(async () => { sends++; return accepted() })
  assert.equal(sends, 0)
  assert.equal(result.ack, 1)
  const outbox = f.sql.prepare('SELECT status, not_before FROM notification_outbox').get()
  assert.equal(outbox.status, 'pending')
  assert.equal(outbox.not_before, Date.parse('2099-01-02T05:00:00Z'))
})

test('expiry crossed during a device request prevents sending to the remaining device', async (t) => {
  const f = await fixture(t)
  f.insert('notification_push_tokens', { id: 'second-phone', user_id: 'client-1', token: 'ExpoPushToken[second]', platform: 'ios', created_at: 1, last_registered_at: 0 })
  f.sql.prepare('UPDATE notification_events SET expires_at=?').run(f.clock.now + 1000)
  f.sql.prepare('UPDATE notification_outbox SET expires_at=?').run(f.clock.now + 1000)
  const expiry = f.sql.prepare('SELECT expires_at FROM notification_events').get().expires_at
  let sends = 0
  await f.send(async () => { sends++; f.clock.now = expiry + 1; return accepted(`ticket-${sends}`) })
  assert.equal(sends, 1)
  assert.equal(f.sql.prepare('SELECT status FROM notification_outbox').get().status, 'expired')
  assert.equal(f.sql.prepare('SELECT expo_ticket_id FROM notification_deliveries').get().expo_ticket_id, 'ticket-1')
})

test('expiry is included in the upstream payload so offline devices do not receive stale offers later', async (t) => {
  const f = await fixture(t)
  const expiry = f.sql.prepare('SELECT expires_at FROM notification_events').get().expires_at
  let payload
  await f.send(async (_url, options) => { payload = JSON.parse(options.body); return accepted() })
  assert.equal(payload.expiration, Math.floor(expiry / 1000))
})

test('a stale DLQ message cannot overwrite a completed delivery', async (t) => {
  const f = await fixture(t)
  await f.send(async () => accepted())
  await f.send(async () => { throw new Error('DLQ must never send') }, undefined, 'fave-notification-dlq')
  assert.equal(f.sql.prepare('SELECT status FROM notification_outbox').get().status, 'complete')
})

test('a previous attempt’s DLQ message cannot cancel a newer operator retry', async (t) => {
  const f = await fixture(t)
  await f.dispatchDueNotificationDeliveries(f.env, f.clock.now)
  const old = f.queued[0]
  f.sql.exec("UPDATE notification_outbox SET status='failed'")
  f.clock.now++
  await f.operatorRetry()
  const current = f.queued[1]
  await f.send(async () => { throw new Error('DLQ must never send') }, old, 'fave-notification-dlq')
  assert.equal(f.sql.prepare('SELECT status FROM notification_outbox').get().status, 'queued')
  let sends = 0
  await f.send(async () => { sends++; return accepted() }, current)
  assert.equal(sends, 1)
})

for (const outcome of ['queued', 'suppressed']) test(`a stale operator ${outcome} decision cannot change a newer attempt or write its audit`, async (t) => {
  const f = await fixture(t)
  f.sql.exec("UPDATE notification_outbox SET status='failed'")
  if (outcome === 'suppressed') f.sql.exec("UPDATE availability_requests SET client_user_id='client-2'")
  const batch = f.DB.batch.bind(f.DB)
  f.DB.batch = async (statements) => {
    f.sql.exec("UPDATE notification_outbox SET status='queued', queue_generation='newer-attempt'")
    return batch(statements)
  }
  const response = await f.loadWorkerModule('admin-notifications').default.request(`https://fave.test/${f.deliveryId}/retry`, {
    method: 'POST', headers: { 'x-test-user': 'staff' },
  }, f.env)
  assert.equal(response.status, 404)
  assert.equal(f.sql.prepare('SELECT status FROM notification_outbox').get().status, 'queued')
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM notification_retry_audit').get().count, 0)
  assert.equal(f.queued.length, 0)
})

test('quiet hours crossed during a send defer only the remaining devices until morning', async (t) => {
  const f = await fixture(t, { ordinary: true })
  f.insert('notification_push_tokens', { id: 'second-phone', user_id: 'client-1', token: 'ExpoPushToken[second]', platform: 'ios', created_at: 1, last_registered_at: 0 })
  f.clock.now = Date.parse('2099-01-01T17:59:59Z')
  let sends = 0
  await f.send(async () => { sends++; f.clock.now += 2000; return accepted() })
  assert.equal(sends, 1)
  assert.equal(f.sql.prepare('SELECT status FROM notification_outbox').get().status, 'pending')
  f.clock.now = Date.parse('2099-01-02T05:00:00Z')
  await f.send(async () => { sends++; return accepted('ticket-second') })
  assert.equal(sends, 2, 'the previously accepted phone must be skipped')
  assert.equal(f.sql.prepare('SELECT status FROM notification_outbox').get().status, 'complete')
})

test('an expired abandoned lease is recovered without allowing its old holder to finish the new send', async (t) => {
  const f = await fixture(t)
  const state = f.loadWorkerModule('notification-send-state')
  const abandoned = await state.acquireNotificationSend(f.DB, f.deliveryId, null, f.clock.now)
  let sends = 0
  const fetcher = async () => { sends++; return accepted() }
  const busy = await f.send(fetcher)
  assert.equal(sends, 0)
  assert.equal(busy.retries[0].delaySeconds, 121)
  f.clock.now += state.SEND_LEASE_MS + 1
  await f.send(fetcher)
  assert.equal(sends, 1)
  assert.equal(await state.finishNotificationSend(f.DB, abandoned, 'queued', f.clock.now), false)
  assert.equal(f.sql.prepare('SELECT status FROM notification_outbox').get().status, 'complete')
})

test('a sender resuming after lease takeover cannot overwrite the replacement ticket', async (t) => {
  const f = await fixture(t)
  let enter
  let release
  const entered = new Promise((resolve) => { enter = resolve })
  const held = new Promise((resolve) => { release = resolve })
  const stale = f.send(async () => { enter(); await held; return accepted('stale-ticket') })
  await entered
  try {
    f.clock.now += 120001
    await f.send(async () => accepted('replacement-ticket'))
  } finally { release(); await stale }
  assert.equal(f.sql.prepare('SELECT expo_ticket_id FROM notification_deliveries').get().expo_ticket_id, 'replacement-ticket')
  const outbox = f.sql.prepare('SELECT status,send_lease_token FROM notification_outbox').get()
  assert.equal(outbox.status, 'complete')
  assert.equal(outbox.send_lease_token, null)
})

test('a fast consumer completion is not overwritten by the dispatcher post-enqueue write', async (t) => {
  const f = await fixture(t)
  f.env.NOTIFICATION_QUEUE.send = async (body) => {
    await f.send(async () => accepted(), body)
  }
  await f.dispatchDueNotificationDeliveries(f.env, f.clock.now)
  assert.equal(f.sql.prepare('SELECT status FROM notification_outbox').get().status, 'complete')
})

test('one-ID legacy replay is refused after the dispatcher assigns a fresh generation', async (t) => {
  const f = await fixture(t)
  await f.dispatchDueNotificationDeliveries(f.env, f.clock.now)
  let sends = 0
  const fetcher = async () => { sends++; return accepted() }
  await f.send(fetcher)
  assert.equal(sends, 0)
  await f.send(fetcher, f.queued[0])
  assert.equal(sends, 1)
  assert.equal(Object.keys(f.queued[0]).sort().join(','), 'deliveryId,generation')
})

test('a transient failure retries only the failed device after the normal sixty-second delay', async (t) => {
  const f = await fixture(t)
  f.insert('notification_push_tokens', { id: 'second-phone', user_id: 'client-1', token: 'ExpoPushToken[second]', platform: 'ios', created_at: 1, last_registered_at: 0 })
  let sends = 0
  const first = await f.send(async (_url, options) => {
    sends++
    assert.ok(options.signal instanceof AbortSignal)
    return sends === 1 ? accepted() : Response.json({ errors: [] }, { status: 503 })
  })
  assert.equal(first.retries[0].delaySeconds, 60)
  f.clock.now += 60000
  await f.send(async () => { sends++; return accepted('second-device-ticket') })
  assert.equal(sends, 3)
  assert.equal(f.sql.prepare('SELECT status FROM notification_outbox').get().status, 'complete')
})
