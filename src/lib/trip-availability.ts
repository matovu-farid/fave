import type { ClientAvailabilityRequest, ClientTripOffer, TripEstimate, TripQuote } from './marketplace'
import type { TripDraft } from './trip-draft'

export function tripDraftFromEstimate(estimate: TripEstimate): TripDraft {
  const input = estimate.pickup.input
  return {
    pickup: estimate.pickup.address,
    pickupPin: 'latitude' in input ? { latitude: input.latitude, longitude: input.longitude } : null,
    destination: estimate.destination.address,
    startDate: estimate.startDate, endDate: estimate.endDate,
    partySize: String(estimate.partySize), luggageCount: String(estimate.luggageCount),
    selectedVehicle: estimate.vehicleId, estimateId: estimate.estimateId,
  }
}

export function getRestorableLegacyQuote(offer: ClientTripOffer | null, hasActiveAvailability: boolean, now: number) {
  return !hasActiveAvailability && offer?.status === 'quoted' && offer.quote && offer.quote.expiresAt > now
    ? offer.quote : null
}

export function isAwaitingAvailability(request: ClientAvailabilityRequest | null) {
  return request?.status === 'requested' || (request?.status === 'confirmed' && request.needsReview)
}

type AvailabilityPhase = 'checking' | 'review' | 'quote' | 'unavailable' | 'withdrawn' | 'expired' | 'booked'

export function getAvailabilityView(request: ClientAvailabilityRequest, now: number): {
  phase: AvailabilityPhase; quote: TripQuote | null; message: string
} {
  if (request.status === 'confirmed' && (request.expiresAt === null || request.expiresAt <= now ||
      request.holdExpiresAt === null || request.holdExpiresAt <= now)) {
    return { phase: 'expired', quote: null, message: 'The quote window ended. No deposit was taken. Check current availability to see a new estimate.' }
  }
  if (request.needsReview && ['requested', 'confirmed'].includes(request.status)) {
    return { phase: 'review', quote: null, message: 'The car’s availability changed. Fave is reviewing your dates. No payment is due while we recheck.' }
  }
  if (request.status === 'requested') {
    return { phase: 'checking', quote: null, message: 'Fave will call the driver to check these dates. No payment is due while we check.' }
  }
  if (request.status === 'confirmed' && request.quote && request.quoteId && request.expiresAt) {
    return { phase: 'quote', message: 'Fave confirmed your dates. The final quote keeps your original estimate price.', quote: {
      quoteId: request.quoteId, vehicleId: request.estimate.vehicleId,
      pickup: request.estimate.pickup, destination: request.estimate.destination,
      route: request.estimate.route, quote: request.quote, expiresAt: request.expiresAt,
    } }
  }
  if (request.status === 'confirmed') return { phase: 'review', quote: null, message: 'Your quote could not be loaded. Fave will recheck its status before you pay.' }
  if (request.status === 'converted_to_booking') return { phase: 'booked', quote: null, message: 'This quote has already been used. See your trip requests for its current booking status.' }
  if (request.status === 'unavailable') return { phase: 'unavailable', quote: null, message: 'Fave could not confirm this car for those dates. No deposit is due. Choose another car for a new estimate.' }
  if (request.status === 'withdrawn') return { phase: 'withdrawn', quote: null, message: 'Availability request withdrawn. No payment was taken. You can plan a new trip.' }
  return { phase: 'expired', quote: null, message: 'The quote window ended. No deposit was taken. Check current availability to see a new estimate.' }
}
