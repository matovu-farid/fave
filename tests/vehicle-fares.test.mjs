import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateVehicleFareLeg, parseVehicleFareBenchmarkBasis, validateVehicleFareBenchmark } from '../fave-worker/src/vehicle-fares.ts'

const benchmark = {
  amountUgx: 400_000,
  currency: 'UGX',
  derivationVersion: 1,
  basis: {
    routeId: 'kampala-jinja',
    routeVersion: 'approved-1',
    origin: { label: 'Kampala', latitude: 0.3476, longitude: 32.5825 },
    destination: { label: 'Jinja', latitude: 0.4479, longitude: 33.2026 },
    roundTripDistanceMeters: 160_000,
    rounding: 'ceiling_per_leg',
  },
}

test('validates and calculates each direction against the full round-trip benchmark', () => {
  assert.equal(validateVehicleFareBenchmark(benchmark), true)
  assert.deepEqual(calculateVehicleFareLeg(benchmark, 80_000), {
    amountUgx: 200_000,
    rateUgxPerKm: 2_500,
  })
  assert.deepEqual(calculateVehicleFareLeg(benchmark, 83_001), {
    amountUgx: 207_503,
    rateUgxPerKm: 2_500,
  })
  assert.deepEqual(calculateVehicleFareLeg(benchmark, 76_999), {
    amountUgx: 192_498,
    rateUgxPerKm: 2_500,
  })
})

test('rejects invalid, unsafe, or unsupported benchmark inputs', () => {
  assert.equal(validateVehicleFareBenchmark({ ...benchmark, amountUgx: 0 }), false)
  assert.equal(validateVehicleFareBenchmark({ ...benchmark, amountUgx: 1.5 }), false)
  assert.equal(validateVehicleFareBenchmark({ ...benchmark, amountUgx: Number.MAX_SAFE_INTEGER + 1 }), false)
  assert.equal(validateVehicleFareBenchmark({ ...benchmark, basis: { ...benchmark.basis, roundTripDistanceMeters: 0 } }), false)
  assert.equal(validateVehicleFareBenchmark({ ...benchmark, basis: { ...benchmark.basis, rounding: 'unknown' } }), false)
  assert.equal(calculateVehicleFareLeg(benchmark, 0), null)
  assert.equal(calculateVehicleFareLeg(benchmark, Number.MAX_SAFE_INTEGER + 1), null)
})

test('rejects totals that cannot be represented as a safe whole UGX amount', () => {
  const large = {
    ...benchmark,
    amountUgx: 1_000_000_000,
    basis: { ...benchmark.basis, roundTripDistanceMeters: 1 },
  }
  assert.equal(calculateVehicleFareLeg(large, 10_000_000_000), null)
})

test('pricing basis is unavailable unless the approved fare policy supplies a valid versioned route', () => {
  assert.deepEqual(parseVehicleFareBenchmarkBasis(JSON.stringify({ vehicleBenchmark: benchmark.basis })), benchmark.basis)
  assert.equal(parseVehicleFareBenchmarkBasis(JSON.stringify({ components: [] })), null)
  assert.equal(parseVehicleFareBenchmarkBasis(JSON.stringify({ vehicleBenchmark: { ...benchmark.basis, routeVersion: '' } })), null)
  assert.equal(parseVehicleFareBenchmarkBasis(JSON.stringify({ vehicleBenchmark: { ...benchmark.basis, rounding: 'unknown' } })), null)
  assert.equal(parseVehicleFareBenchmarkBasis('{'), null)
})

const nearestBenchmark = { ...benchmark, basis: { ...benchmark.basis, rounding: 'nearest_per_leg' } }

test('nearest whole-shilling pricing retains the precise benchmark ratio until each leg is rounded', () => {
  assert.equal(validateVehicleFareBenchmark(nearestBenchmark), true)
  assert.deepEqual(parseVehicleFareBenchmarkBasis(JSON.stringify({ vehicleBenchmark: nearestBenchmark.basis })), nearestBenchmark.basis)
  const fractionalRate = { ...nearestBenchmark, amountUgx: 400001 }
  const leg = calculateVehicleFareLeg(fractionalRate, 80001)
  assert.equal(leg.amountUgx, 200003)
  assert.equal(leg.rateUgxPerKm, 2500.00625)
  assert.equal(calculateVehicleFareLeg({ ...nearestBenchmark, amountUgx: 100 }, 1666).amountUgx, 1)
})

test('nearest whole-shilling rounding resolves either side of a half shilling exactly', () => {
  const small = { ...nearestBenchmark, amountUgx: 1, basis: { ...nearestBenchmark.basis, roundTripDistanceMeters: 1000 } }
  assert.ok(calculateVehicleFareLeg(small, 1499))
  assert.equal(calculateVehicleFareLeg(small, 1499).amountUgx, 1)
  assert.equal(calculateVehicleFareLeg(small, 1500).amountUgx, 2)
  assert.equal(calculateVehicleFareLeg(small, 1501).amountUgx, 2)
  const huge = { ...small, amountUgx: 999999999 }
  assert.equal(calculateVehicleFareLeg(huge, 9007199255).amountUgx, 9007199245992801)
})
