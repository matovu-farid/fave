import test from 'node:test'
import assert from 'node:assert/strict'

const dateRules = await import('../fave-worker/src/trip-dates.ts').catch(() => ({}))

test('measures the trip span in whole calendar days', () => {
  assert.equal(typeof dateRules.daysBetween, 'function', 'trip date rules should be available')
  const { daysBetween } = dateRules
  assert.equal(daysBetween('2026-10-11', '2026-10-18'), 7)
  assert.equal(daysBetween('2026-10-11', '2026-10-19'), 8)
})

test('uses the Kampala calendar date across the UTC midnight boundary', () => {
  assert.equal(typeof dateRules.kampalaToday, 'function', 'Kampala date helper should be available')
  const { kampalaToday } = dateRules
  assert.equal(kampalaToday(new Date('2026-10-11T20:59:59.999Z')), '2026-10-11')
  assert.equal(kampalaToday(new Date('2026-10-11T21:00:00.000Z')), '2026-10-12')
})

test('accepts future trip ranges up to seven days and rejects longer or invalid dates', () => {
  assert.equal(typeof dateRules.parseTripDateRange, 'function', 'server trip date validation should be available')
  const { parseTripDateRange } = dateRules
  const now = new Date('2026-10-11T20:59:59.999Z')

  assert.deepEqual(parseTripDateRange('2026-10-11', '2026-10-18', now), {
    startDate: '2026-10-11',
    endDate: '2026-10-18',
  })
  assert.equal(parseTripDateRange('2026-10-11', '2026-10-19', now), null)
  assert.equal(parseTripDateRange('2026-10-12', '2026-10-11', now), null)
  assert.equal(parseTripDateRange('2026-02-30', '2026-03-01', now), null)
})

test('rejects trip starts before Kampala today, including after the UTC date rolls over', () => {
  assert.equal(typeof dateRules.parseTripDateRange, 'function', 'server trip date validation should be available')
  const { parseTripDateRange } = dateRules
  const afterUtcMidnight = new Date('2026-10-11T21:00:00.000Z')

  assert.equal(parseTripDateRange('2026-10-11', '2026-10-18', afterUtcMidnight), null)
  assert.deepEqual(parseTripDateRange('2026-10-12', '2026-10-19', afterUtcMidnight), {
    startDate: '2026-10-12',
    endDate: '2026-10-19',
  })
})
