export type AcceptedQuoteComponent = {
  key: string
  label: string
  unit: 'fixed' | 'per_kilometer' | 'per_night' | 'per_passenger'
  unitRate: number
  quantity: number
  amount: number
}

import { calculateVehicleFareLeg, validateVehicleFareBenchmark } from './vehicle-fares'

export type AcceptedQuoteSnapshot = {
  currency: string
  components: AcceptedQuoteComponent[]
  totalAmount: number
  farePolicyVersion: string
  nights: number
  outboundRoute?: { distanceMeters: number; durationSeconds: number }
  returnRoute?: { distanceMeters: number; durationSeconds: number }
  vehicleFareBenchmark?: {
    amountUgx: number
    currency: 'UGX'
    derivationVersion: 1
    basis: {
      routeId: string
      routeVersion: string
      roundTripDistanceMeters: number
      rounding: string
      origin: { label: string; latitude: number; longitude: number }
      destination: { label: string; latitude: number; longitude: number }
    }
  }
  vehicleId?: string
  driverApplicationId?: string
}

export type AccommodationExtensionSnapshot = {
  sourceQuoteId: string
  currency: string
  farePolicyVersion: string
  originalNights: number
  addedNights: number
  revisedNights: number
  originalTotalAmount: number
  extensionAmountDueNow: number
  revisedTotalAmount: number
  outboundRoute?: AcceptedQuoteSnapshot['outboundRoute']
  returnRoute?: AcceptedQuoteSnapshot['returnRoute']
  vehicleFareBenchmark?: AcceptedQuoteSnapshot['vehicleFareBenchmark']
  vehicleId?: string
  driverApplicationId?: string
  components: Array<{
    key: string
    label: string
    unitRate: number
    originalQuantity: number
    originalAmount: number
    addedQuantity: number
    addedAmount: number
  }>
}

const MAX_TRIP_NIGHTS = 7
const MAX_TOTAL_AMOUNT = 10_000_000_000

function isSafeAmount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= MAX_TOTAL_AMOUNT
}

function isSafeRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_TOTAL_AMOUNT
}

function hasValidVehicleFareSnapshot(quote: AcceptedQuoteSnapshot): boolean {
  const validComponentObjects = quote.components.filter((component) => component && typeof component === 'object')
  const outbound = validComponentObjects.filter((component) => component.key === 'outbound_transport')
  const returning = validComponentObjects.filter((component) => component.key === 'return_transport')
  if (validComponentObjects.length !== quote.components.length) return false
  const hasFareMetadata = Boolean(
    quote.outboundRoute || quote.returnRoute || quote.vehicleFareBenchmark || quote.vehicleId || quote.driverApplicationId ||
    outbound.length || returning.length,
  )
  if (!hasFareMetadata) return true
  if (
    outbound.length !== 1 || returning.length !== 1 ||
    !quote.outboundRoute || !quote.returnRoute || !quote.vehicleFareBenchmark ||
    typeof quote.vehicleId !== 'string' || quote.vehicleId.trim().length === 0 ||
    typeof quote.driverApplicationId !== 'string' || quote.driverApplicationId.trim().length === 0 ||
    !validateVehicleFareBenchmark(quote.vehicleFareBenchmark)
  ) return false

  for (const [component, route] of [
    [outbound[0], quote.outboundRoute],
    [returning[0], quote.returnRoute],
  ] as const) {
    const expected = calculateVehicleFareLeg(quote.vehicleFareBenchmark, route.distanceMeters)
    if (
      !expected || !Number.isSafeInteger(route.durationSeconds) || route.durationSeconds < 0 ||
      component.unit !== 'per_kilometer' || component.quantity !== route.distanceMeters / 1000 ||
      component.unitRate !== expected.rateUgxPerKm || component.amount !== expected.amountUgx
    ) return false
  }
  return true
}

function isValidAcceptedQuote(
  quote: AcceptedQuoteSnapshot,
): quote is AcceptedQuoteSnapshot {
  if (
    !quote ||
    typeof quote !== 'object' ||
    !/^[A-Z]{3}$/u.test(quote.currency) ||
    typeof quote.farePolicyVersion !== 'string' ||
    quote.farePolicyVersion.trim().length === 0 ||
    !Number.isSafeInteger(quote.nights) ||
    quote.nights < 1 ||
    quote.nights > MAX_TRIP_NIGHTS ||
    !isSafeAmount(quote.totalAmount) ||
    !Array.isArray(quote.components) ||
    quote.components.length === 0 ||
    !hasValidVehicleFareSnapshot(quote)
  ) {
    return false
  }

  let componentTotal = 0
  for (const component of quote.components) {
    if (
      !component ||
      typeof component.key !== 'string' ||
      typeof component.label !== 'string' ||
      !['fixed', 'per_kilometer', 'per_night', 'per_passenger'].includes(component.unit) ||
      !(component.key === 'outbound_transport' || component.key === 'return_transport'
        ? isSafeRate(component.unitRate) : isSafeAmount(component.unitRate)) ||
      typeof component.quantity !== 'number' ||
      !Number.isFinite(component.quantity) || component.quantity <= 0 ||
      !isSafeAmount(component.amount) ||
      ((component.key !== 'outbound_transport' && component.key !== 'return_transport') &&
        (!Number.isSafeInteger(component.quantity) || component.unitRate * component.quantity !== component.amount)) ||
      (component.unit === 'fixed' && component.quantity !== 1) ||
      (component.unit === 'per_night' && (!Number.isSafeInteger(component.quantity) || component.quantity !== quote.nights))
    ) {
      return false
    }
    componentTotal += component.amount
    if (!Number.isSafeInteger(componentTotal) || componentTotal > MAX_TOTAL_AMOUNT) return false
  }

  return componentTotal === quote.totalAmount
}

export function buildAccommodationExtensionSnapshot(
  sourceQuoteId: string,
  acceptedQuote: AcceptedQuoteSnapshot,
  addedNights: number,
): AccommodationExtensionSnapshot | null {
  if (
    typeof sourceQuoteId !== 'string' ||
    sourceQuoteId.trim().length === 0 ||
    sourceQuoteId.length > 200 ||
    !Number.isSafeInteger(addedNights) ||
    addedNights < 1 ||
    !isValidAcceptedQuote(acceptedQuote)
  ) {
    return null
  }

  const revisedNights = acceptedQuote.nights + addedNights
  if (!Number.isSafeInteger(revisedNights) || revisedNights > MAX_TRIP_NIGHTS) return null

  const components = acceptedQuote.components
    .filter((component) => component.unit === 'per_night')
    .map((component) => ({
      key: component.key,
      label: component.label,
      unitRate: component.unitRate,
      originalQuantity: component.quantity,
      originalAmount: component.amount,
      addedQuantity: addedNights,
      addedAmount: component.unitRate * addedNights,
    }))

  if (components.length === 0) return null

  const extensionAmountDueNow = components.reduce(
    (total, component) => total + component.addedAmount,
    0,
  )
  const revisedTotalAmount = acceptedQuote.totalAmount + extensionAmountDueNow
  if (
    !isSafeAmount(extensionAmountDueNow) ||
    !isSafeAmount(revisedTotalAmount)
  ) {
    return null
  }

  return {
    sourceQuoteId: sourceQuoteId.trim(),
    currency: acceptedQuote.currency,
    farePolicyVersion: acceptedQuote.farePolicyVersion,
    originalNights: acceptedQuote.nights,
    addedNights,
    revisedNights,
    originalTotalAmount: acceptedQuote.totalAmount,
    extensionAmountDueNow,
    revisedTotalAmount,
    ...(acceptedQuote.outboundRoute ? { outboundRoute: acceptedQuote.outboundRoute } : {}),
    ...(acceptedQuote.returnRoute ? { returnRoute: acceptedQuote.returnRoute } : {}),
    ...(acceptedQuote.vehicleFareBenchmark ? { vehicleFareBenchmark: acceptedQuote.vehicleFareBenchmark } : {}),
    ...(acceptedQuote.vehicleId ? { vehicleId: acceptedQuote.vehicleId } : {}),
    ...(acceptedQuote.driverApplicationId ? { driverApplicationId: acceptedQuote.driverApplicationId } : {}),
    components,
  }
}
