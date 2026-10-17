/** Explicit projections of the stored V1 shapes in bookings.ts and vehicle-fares.ts.
 * Unknown fields never cross the export boundary, even inside owned records. */
type ObjectValue = Record<string, unknown>
export function objectValue(value: unknown): ObjectValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : null
}
function scalar(value: unknown): boolean {
  return value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)
}
export function selectFields(value: ObjectValue, keys: string): ObjectValue {
  return Object.fromEntries(keys.split(' ').filter((key) => key in value && scalar(value[key])).map((key) => [key, value[key]]))
}
function record(value: unknown, required: string, optional = ''): ObjectValue | null {
  const obj = objectValue(value)
  if (!obj || ['schemaVersion', 'snapshotVersion'].some((key) => key in obj && obj[key] !== 1 && obj[key] !== 'v1')) return null
  if (!required.split(' ').filter(Boolean).every((key) => key in obj && scalar(obj[key]) && obj[key] !== null)) return null
  return selectFields(obj, `${required} ${optional}`.trim())
}
function point(value: unknown) { return record(value, 'label latitude longitude') }
export function projectBenchmarkBasis(value: unknown): ObjectValue | null {
  const obj = objectValue(value)
  const result = record(value, 'routeId routeVersion roundTripDistanceMeters rounding')
  const origin = point(obj?.origin), destination = point(obj?.destination)
  return result && origin && destination ? { ...result, origin, destination } : null
}
function benchmark(value: unknown): ObjectValue | null {
  const obj = objectValue(value), result = record(value, 'amountUgx currency derivationVersion')
  const basis = projectBenchmarkBasis(obj?.basis)
  return result && result.derivationVersion === 1 && basis ? { ...result, basis } : null
}
export function projectLocation(value: unknown): ObjectValue | null {
  const obj = objectValue(value)
  if (!obj) return null
  const result = record(value, '', 'address formattedAddress broadArea latitude longitude')
  if (!result) return null
  if (obj.input !== undefined) {
    const input = objectValue(obj.input)
    const parsed = input && typeof input.address === 'string' ? record(input, 'address') : record(input, 'latitude longitude')
    if (!parsed) return null
    result.input = parsed
  }
  return Object.keys(result).length ? result : null
}
export function projectQuote(value: unknown, driverOnly = false): ObjectValue | null {
  const obj = objectValue(value)
  if (obj?.version !== undefined && obj.version !== 1 && obj.version !== 'v1') return null
  const result = record(value, 'currency totalAmount depositAmount depositBasisPoints farePolicyVersion distanceMeters durationSeconds nights', 'driverLodgingRate')
  if (!obj || !result || !Array.isArray(obj.components)) return null
  const components = obj.components.map((item) => record(item, 'key label unit unitRate quantity amount'))
  if (components.some((item) => !item)) return null
  result.components = components
  // Work/rate facts are relevant to a driver; no counterparty ID is exported.
  for (const key of ['outboundRoute', 'returnRoute']) {
    if (obj[key] !== undefined) {
      const route = record(obj[key], 'distanceMeters durationSeconds')
      if (!route) return null
      result[key] = route
    }
  }
  if (obj.vehicleFareBenchmark !== undefined) {
    const parsed = benchmark(obj.vehicleFareBenchmark)
    if (!parsed) return null
    result.vehicleFareBenchmark = parsed
  }
  if (!driverOnly) Object.assign(result, selectFields(obj, 'vehicleId'))
  return result
}
export function projectTerms(value: unknown): unknown[] | null {
  if (!Array.isArray(value)) return null
  const terms = value.map((item) => record(item, 'id type version language'))
  return terms.every(Boolean) ? terms : null
}
export function projectFareRules(value: unknown): ObjectValue | null {
  const obj = objectValue(value), result = record(value, 'depositBasisPoints')
  if (!obj || !result || !Array.isArray(obj.components)) return null
  const components = obj.components.map((item) => record(item, 'key label amount unit'))
  if (!components.every(Boolean)) return null
  result.components = components
  if (obj.vehicleBenchmark !== undefined) {
    const basis = projectBenchmarkBasis(obj.vehicleBenchmark)
    if (!basis) return null
    result.vehicleBenchmark = basis
  }
  return result
}
export function parseStoredProjection(raw: unknown, project: (value: unknown) => unknown): unknown {
  try { return typeof raw === 'string' ? project(JSON.parse(raw)) : null } catch { return null }
}
