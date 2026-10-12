export type AcceptedQuoteComponent = {
  key: string
  label: string
  unit: 'fixed' | 'per_kilometer' | 'per_night' | 'per_passenger'
  unitRate: number
  quantity: number
  amount: number
}

export type AcceptedQuoteSnapshot = {
  currency: string
  components: AcceptedQuoteComponent[]
  totalAmount: number
  farePolicyVersion: string
  nights: number
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
    quote.components.length === 0
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
      !isSafeAmount(component.unitRate) ||
      !Number.isSafeInteger(component.quantity) ||
      component.quantity < 1 ||
      !isSafeAmount(component.amount) ||
      component.unitRate * component.quantity !== component.amount ||
      (component.unit === 'fixed' && component.quantity !== 1) ||
      (component.unit === 'per_night' && component.quantity !== quote.nights)
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
    components,
  }
}
