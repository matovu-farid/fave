import test from 'node:test'
import assert from 'node:assert/strict'

const latestRequestModule = await import('../src/lib/latest-request.ts').catch(() => ({}))

test('a newer vehicle search makes earlier responses stale', () => {
  assert.equal(typeof latestRequestModule.createLatestRequestGuard, 'function', 'latest request guard should exist')
  const guard = latestRequestModule.createLatestRequestGuard()
  const firstRequest = guard.begin()
  const secondRequest = guard.begin()

  assert.equal(guard.isCurrent(firstRequest), false)
  assert.equal(guard.isCurrent(secondRequest), true)
})

test('changing trip criteria invalidates an in-flight vehicle search', () => {
  assert.equal(typeof latestRequestModule.createLatestRequestGuard, 'function', 'latest request guard should exist')
  const guard = latestRequestModule.createLatestRequestGuard()
  const request = guard.begin()

  guard.invalidate()

  assert.equal(guard.isCurrent(request), false)
})
