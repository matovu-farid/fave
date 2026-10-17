import test from 'node:test'
import assert from 'node:assert/strict'
import { availabilityFixture } from './helpers/availability-fixture.mjs'

for (const path of ['/api/admin/availability-requests', '/api/admin/trip-offers']) {
  for (const [user, expected] of [[null, 401], ['client-1', 403], ['staff', 200]]) {
    test(`${path} prevents caching for ${user ?? 'signed-out'} responses`, async t => {
      const f = availabilityFixture(t), worker = f.loadWorkerModule('index').default
      const response = await worker.fetch(new Request(`https://fave.test${path}`, {
        headers: { origin: 'https://fave.test', ...(user ? { 'x-test-user': user } : {}) },
      }), { DB: f.DB, BETTER_AUTH_URL: 'https://fave.test' }, { waitUntil() {} })
      assert.equal(response.status, expected)
      assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
      assert.equal(response.headers.get('Pragma'), 'no-cache')
      await response.body?.cancel()
    })
  }
}

test('unknown staff API responses cannot become a cacheable alternate path', async t => {
  const f = availabilityFixture(t), worker = f.loadWorkerModule('index').default
  const response = await worker.fetch(new Request('https://fave.test/api/admin/not-a-route'), { DB: f.DB }, { waitUntil() {} })
  assert.equal(response.status, 404)
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
})
