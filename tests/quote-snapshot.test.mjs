import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const bookingsSource = fileURLToPath(new URL('../fave-worker/src/bookings.ts', import.meta.url))

function loadBookings() {
  const exports = {}
  const code = ts.transpileModule(readFileSync(bookingsSource, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText

  vm.runInNewContext(code, {
    exports,
    require: name => {
      if (name === 'hono') return { Hono: class { post() { return this } get() { return this } } }
      if (name === './marketplace-auth') return { apiError() {}, getSignedInUser() {}, writeMarketplaceAudit() {} }
      if (name === './google-maps') return { computeDrivingRoute() {}, classifyLocation() {}, parseLocationInput() {} }
      if (name === './marketplace-policies') return { getCurrentPolicies() {} }
      if (name === './trip-dates') return { daysBetween() {}, parseTripDateRange() {} }
      if (name === './vehicles') return { approvedVehicleEvidencePredicate() {} }
      throw new Error(`Unexpected module: ${name}`)
    },
    JSON,
    Number,
    Math,
  })

  return exports
}

test('quote snapshots retain unit rates and quantities for later trip extensions', () => {
  const { buildQuoteSnapshot } = loadBookings()
  assert.equal(typeof buildQuoteSnapshot, 'function', 'quote snapshot builder is available for focused testing')

  const snapshot = buildQuoteSnapshot({
    id: 'fare-v1',
    version: '1',
    currency: 'UGX',
    rules_json: JSON.stringify({
      components: [
        { key: 'car', label: 'Car hire', amount: 100_000, unit: 'per_night' },
        { key: 'cleaning', label: 'Cleaning fee', amount: 25_000, unit: 'fixed' },
        { key: 'distance', label: 'Distance', amount: 1_500, unit: 'per_kilometer' },
        { key: 'passengers', label: 'Passengers', amount: 2_000, unit: 'per_passenger' },
      ],
      depositBasisPoints: 5_000,
    }),
  }, { distanceMeters: 10_200, durationSeconds: 7_200 }, 2, 3)

  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.components)), [
    { key: 'car', label: 'Car hire', unit: 'per_night', unitRate: 100_000, quantity: 2, amount: 200_000 },
    { key: 'cleaning', label: 'Cleaning fee', unit: 'fixed', unitRate: 25_000, quantity: 1, amount: 25_000 },
    { key: 'distance', label: 'Distance', unit: 'per_kilometer', unitRate: 1_500, quantity: 11, amount: 16_500 },
    { key: 'passengers', label: 'Passengers', unit: 'per_passenger', unitRate: 2_000, quantity: 3, amount: 6_000 },
  ])
  assert.equal(snapshot.totalAmount, 247_500)
  assert.equal(snapshot.depositAmount, 123_750)
})
