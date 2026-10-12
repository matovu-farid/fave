import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const sourcePath = fileURLToPath(new URL('../fave-worker/src/trip-extensions.ts', import.meta.url))

function loadExtensionQuoteBuilder() {
  const exports = {}
  const code = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  vm.runInNewContext(code, { exports, Number, Math, JSON })
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
