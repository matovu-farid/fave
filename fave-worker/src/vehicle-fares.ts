const MAX_AMOUNT_UGX = 1_000_000_000

export type VehicleBenchmarkBasis = {
  routeId: string
  routeVersion: string
  origin: { label: string; latitude: number; longitude: number }
  destination: { label: string; latitude: number; longitude: number }
  roundTripDistanceMeters: number
  rounding: 'nearest_per_leg' | 'ceiling_per_leg'
}

export type VehicleFareBenchmark = {
  amountUgx: number
  currency: 'UGX'
  basis: VehicleBenchmarkBasis
  derivationVersion: 1
}

function isValidPoint(value: unknown): value is VehicleBenchmarkBasis['origin'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const point = value as Record<string, unknown>
  return typeof point.label === 'string' && point.label.trim().length > 0 &&
    point.label.trim().length <= 120 &&
    typeof point.latitude === 'number' && Number.isFinite(point.latitude) &&
    point.latitude >= -90 && point.latitude <= 90 &&
    typeof point.longitude === 'number' && Number.isFinite(point.longitude) &&
    point.longitude >= -180 && point.longitude <= 180
}

function isValidBasis(value: unknown): value is VehicleBenchmarkBasis {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const basis = value as Record<string, unknown>
  return typeof basis.routeId === 'string' && /^[a-z0-9-]{1,80}$/u.test(basis.routeId) &&
    typeof basis.routeVersion === 'string' && basis.routeVersion.trim().length > 0 &&
    basis.routeVersion.trim().length <= 80 && isValidPoint(basis.origin) &&
    isValidPoint(basis.destination) &&
    Number.isSafeInteger(basis.roundTripDistanceMeters) &&
    Number(basis.roundTripDistanceMeters) > 0 &&
    (basis.rounding === 'nearest_per_leg' || basis.rounding === 'ceiling_per_leg')
}

export function parseVehicleFareBenchmarkBasis(rulesJson: string): VehicleBenchmarkBasis | null {
  let rules: unknown
  try {
    rules = JSON.parse(rulesJson)
  } catch {
    return null
  }
  if (typeof rules !== 'object' || rules === null || Array.isArray(rules)) return null
  const basis = (rules as Record<string, unknown>).vehicleBenchmark
  return isValidBasis(basis) ? basis : null
}

export function validateVehicleFareBenchmark(value: unknown): value is VehicleFareBenchmark {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const benchmark = value as Record<string, unknown>
  if (!Number.isSafeInteger(benchmark.amountUgx) || Number(benchmark.amountUgx) < 1 ||
      Number(benchmark.amountUgx) > MAX_AMOUNT_UGX || benchmark.currency !== 'UGX' ||
      benchmark.derivationVersion !== 1) return false
  return isValidBasis(benchmark.basis)
}

export function calculateVehicleFareLeg(
  benchmark: VehicleFareBenchmark,
  legDistanceMeters: number,
): { amountUgx: number; rateUgxPerKm: number } | null {
  if (!validateVehicleFareBenchmark(benchmark) || !Number.isSafeInteger(legDistanceMeters) || legDistanceMeters <= 0) {
    return null
  }

  const numerator = BigInt(benchmark.amountUgx) * BigInt(legDistanceMeters)
  const denominator = BigInt(benchmark.basis.roundTripDistanceMeters)
  // Preserve the saved rule for existing quotes; new approved policies select nearest_per_leg.
  const amount = benchmark.basis.rounding === 'nearest_per_leg'
    ? (numerator * 2n + denominator) / (denominator * 2n)
    : (numerator + denominator - 1n) / denominator
  if (amount < 1n || amount > BigInt(Number.MAX_SAFE_INTEGER)) return null

  const rateUgxPerKm = benchmark.amountUgx * 1000 / benchmark.basis.roundTripDistanceMeters
  if (!Number.isFinite(rateUgxPerKm)) return null
  return { amountUgx: Number(amount), rateUgxPerKm }
}
