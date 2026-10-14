import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const sourcePath = fileURLToPath(new URL('../fave-worker/src/trip-extensions.ts', import.meta.url))
const vehicleFareSourcePath = fileURLToPath(new URL('../fave-worker/src/vehicle-fares.ts', import.meta.url))

function loadVehicleFareHelpers() {
  const exports = {}
  const code = ts.transpileModule(readFileSync(vehicleFareSourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  vm.runInNewContext(code, { exports, Number, BigInt })
  return exports
}

function loadExtensionQuoteBuilder() {
  const exports = {}
  const vehicleFareHelpers = loadVehicleFareHelpers()
  const code = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  vm.runInNewContext(code, {
    exports,
    Number,
    Math,
    JSON,
    BigInt,
    require: (id) => {
      if (id === './vehicle-fares') return vehicleFareHelpers
      throw new Error(`Unexpected module: ${id}`)
    },
  })
  return exports.buildAccommodationExtensionSnapshot
}

test('extension snapshot charges added nights at the accepted per-night rates only', () => {
  const buildAccommodationExtensionSnapshot = loadExtensionQuoteBuilder()
  const result = buildAccommodationExtensionSnapshot('quote-123', {
    currency: 'UGX',
    totalAmount: 247_500,
    nights: 2,
    farePolicyVersion: 'fare-v3',
    components: [
      { key: 'car', label: 'Vehicle', unit: 'per_night', unitRate: 100_000, quantity: 2, amount: 200_000 },
      { key: 'driver-stay', label: 'Driver accommodation', unit: 'per_night', unitRate: 8_000, quantity: 2, amount: 16_000 },
      { key: 'distance', label: 'Distance', unit: 'per_kilometer', unitRate: 1_500, quantity: 11, amount: 16_500 },
      { key: 'cleaning', label: 'Cleaning', unit: 'fixed', unitRate: 15_000, quantity: 1, amount: 15_000 },
    ],
  }, 2)

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    sourceQuoteId: 'quote-123',
    currency: 'UGX',
    farePolicyVersion: 'fare-v3',
    originalNights: 2,
    addedNights: 2,
    revisedNights: 4,
    originalTotalAmount: 247_500,
    extensionAmountDueNow: 216_000,
    revisedTotalAmount: 463_500,
    components: [
      { key: 'car', label: 'Vehicle', unitRate: 100_000, originalQuantity: 2, originalAmount: 200_000, addedQuantity: 2, addedAmount: 200_000 },
      { key: 'driver-stay', label: 'Driver accommodation', unitRate: 8_000, originalQuantity: 2, originalAmount: 16_000, addedQuantity: 2, addedAmount: 16_000 },
    ],
  })
})

test('extension snapshot rejects invalid or over-limit added nights', () => {
  const buildAccommodationExtensionSnapshot = loadExtensionQuoteBuilder()
  const quote = {
    currency: 'UGX', totalAmount: 300, nights: 6, farePolicyVersion: 'fare-v1',
    components: [{ key: 'stay', label: 'Stay', unit: 'per_night', unitRate: 50, quantity: 6, amount: 300 }],
  }

  assert.equal(buildAccommodationExtensionSnapshot('quote-123', quote, 0), null)
  assert.equal(buildAccommodationExtensionSnapshot('quote-123', quote, -1), null)
  assert.equal(buildAccommodationExtensionSnapshot('quote-123', quote, 2), null)
  assert.notEqual(buildAccommodationExtensionSnapshot('quote-123', quote, 1), null)
  assert.equal(buildAccommodationExtensionSnapshot('quote-123', { ...quote, nights: 2 }, 1), null, 'inconsistent quote nights are rejected')
})

test('extension preserves the accepted vehicle rate basis and adds only lodging nights', () => {
  const buildAccommodationExtensionSnapshot = loadExtensionQuoteBuilder()
  const vehicleFareBenchmark = {
    amountUgx: 400_000, currency: 'UGX', derivationVersion: 1,
    basis: {
      routeId: 'kampala-jinja', routeVersion: 'approved-1', roundTripDistanceMeters: 160_000,
      rounding: 'ceiling_per_leg',
      origin: { label: 'Kampala', latitude: 0.3476, longitude: 32.5825 },
      destination: { label: 'Jinja', latitude: 0.4479, longitude: 33.2026 },
    },
  }
  const outboundRoute = { distanceMeters: 80_001, durationSeconds: 7200 }
  const returnRoute = { distanceMeters: 82_999, durationSeconds: 7500 }
  const acceptedQuote = {
    currency: 'UGX', totalAmount: 536_001, nights: 2, farePolicyVersion: 'fare-v1',
    outboundRoute, returnRoute, vehicleFareBenchmark,
    vehicleId: 'vehicle-1', driverApplicationId: 'driver-app-1',
    components: [
      { key: 'driver_lodging', label: 'Driver lodging', unit: 'per_night', unitRate: 42_000, quantity: 2, amount: 84_000 },
      { key: 'outbound_transport', label: 'Outbound transport', unit: 'per_kilometer', unitRate: 2500, quantity: 80.001, amount: 200_003 },
      { key: 'return_transport', label: 'Return transport', unit: 'per_kilometer', unitRate: 2500, quantity: 82.999, amount: 207_498 },
      { key: 'base', label: 'Base fee', unit: 'fixed', unitRate: 44_500, quantity: 1, amount: 44_500 },
    ],
  }
  const result = buildAccommodationExtensionSnapshot('quote-vehicle', acceptedQuote, 1)
  assert.notEqual(result, null)
  assert.equal(result.extensionAmountDueNow, 42_000)
  assert.equal(result.revisedTotalAmount, 578_001)
  assert.deepEqual(JSON.parse(JSON.stringify(result.outboundRoute)), outboundRoute)
  assert.deepEqual(JSON.parse(JSON.stringify(result.returnRoute)), returnRoute)
  assert.deepEqual(JSON.parse(JSON.stringify(result.vehicleFareBenchmark)), vehicleFareBenchmark)
  assert.equal(result.vehicleId, 'vehicle-1')
  assert.equal(result.driverApplicationId, 'driver-app-1')
  assert.deepEqual(result.components.map((component) => component.key), ['driver_lodging'])

  const wrongOutboundAmount = {
    ...acceptedQuote,
    totalAmount: acceptedQuote.totalAmount + 1,
    components: acceptedQuote.components.map((component) => component.key === 'outbound_transport'
      ? { ...component, amount: component.amount + 1 }
      : component),
  }
  assert.equal(buildAccommodationExtensionSnapshot('quote-vehicle', wrongOutboundAmount, 1), null)

  const wrongRouteDistance = {
    ...acceptedQuote,
    outboundRoute: { ...outboundRoute, distanceMeters: outboundRoute.distanceMeters + 1 },
  }
  assert.equal(buildAccommodationExtensionSnapshot('quote-vehicle', wrongRouteDistance, 1), null)
})
