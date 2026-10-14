import { authenticatedFetch, authenticatedUpload } from '@/lib/api'

export type PolicyDocument = { id: string; type: string; version: string; language: string; body: string; accepted?: boolean }
export type DriverPrerequisites = {
  documents: PolicyDocument[]
  verificationChecklist: { document_type: string; version: string; required: number }[]
  retentionPolicy: { active: boolean; version?: string; retentionDays?: number }
  readyToApply: boolean
}
export type DriverApplication = {
  id: string
  legalName: string
  phoneNumber: string
  lodgingRateUgx: number | null
  status: string
  nextAction: string
  needsEvidenceRefresh?: boolean
  needsPolicyAcceptance?: boolean
  needsCitizenshipConfirmation?: boolean
  applicantMessage: string | null
  retentionExpiresAt?: number | null
  retentionPolicyVersion?: string | null
  documents: {
    id: string
    type: string
    status: string
    requirementVersion?: string | null
  }[]
}
export type Vehicle = {
  id: string
  make: string
  model: string
  year: number
  passengerCapacity: number
  luggageCapacity: number
  comfortDetails: string
  accessibilityDetails: string
  registrationNumber?: string
  status?: string
  applicantMessage?: string | null
  media?: {
    id: string
    type: string
    status: string
    applicantMessage: string | null
    requirementVersion?: string | null
    retentionExpiresAt?: number | null
  }[]
  photos?: { id: string; url: string }[]
}
export type VehicleRequirements = {
  requirements: { evidence_type: string; version: string }[]
  retentionPolicy: { active: boolean; version?: string; retention_days?: number }
  readyToList: boolean
}
export type VehicleAvailability = {
  unavailable: { id: string; start_date: string; end_date: string }[]
  holdsAndBookings: { start_date: string; end_date: string; status: string; hold_expires_at: number }[]
}
export type ClientPrerequisites = {
  documents: PolicyDocument[]
  bookingDocuments: PolicyDocument[]
  profile: { legalName: string; phoneNumber: string } | null
  bookingReady: boolean
}
export type TripLocation = {
  input: { address: string } | { latitude: number; longitude: number }
  address: string
  formattedAddress: string | null
  latitude: number
  longitude: number
}
export type TripQuote = {
  quoteId: string
  vehicleId: string
  pickup: TripLocation
  destination: TripLocation
  route: { distanceMeters: number; durationSeconds: number }
  quote: {
    currency: string
    components: {
      key: string
      label: string
      unit: 'fixed' | 'per_kilometer' | 'per_night' | 'per_passenger'
      unitRate: number
      quantity: number
      amount: number
    }[]
    totalAmount: number
    depositAmount: number
    depositBasisPoints: number
    farePolicyVersion: string
    driverLodgingRate?: number
  }
  expiresAt: number
}
export type TripOfferStatus = 'pending' | 'quoting' | 'quoted' | 'booked' | 'declined' | 'expired' | 'withdrawn' | 'quote_failed'
export type ClientTripRequestSnapshot = {
  pickup: TripQuote['pickup']
  destination: TripQuote['destination']
  startDate: string
  endDate: string
  partySize: number
  luggageCount: number
  vehicle: Pick<Vehicle, 'id' | 'make' | 'model' | 'year' | 'passengerCapacity' | 'luggageCapacity'> | null
}
export type ClientTripOffer = {
  offerId: string
  vehicleId: string
  status: TripOfferStatus
  expiresAt: number
  quote?: TripQuote
  tripRequest?: ClientTripRequestSnapshot
}
export type DriverTripOffer = {
  offerId: string
  vehicleId: string
  pickup: { address: string; formattedAddress: string | null }
  destination: { address: string; formattedAddress: string | null }
  startDate: string
  endDate: string
  passengerCount: number
  luggageCount: number
  expiresAt: number
  vehicle: { make: string; model: string; year: number }
}
export type AdminDriverTripOffer = {
  offerId: string
  status: string
  expiresAt: number
  createdAt: number
  respondedAt: number | null
  startDate: string
  endDate: string
  vehicle: { make: string; model: string }
  route: { pickupArea: string; destinationArea: string }
  followUpCount: number
}
export type NotificationInboxItem = {
  id: string
  title: string
  body: string
  routeKey: 'trips' | 'driver_offers' | 'booking' | 'trip' | 'payments' | 'safety' | 'support'
  priority: 'ordinary' | 'urgent' | 'time_sensitive'
  createdAt: number
  readAt: number | null
  isRead: boolean
}
export type NotificationInboxPage = {
  notifications: NotificationInboxItem[]
  unreadCount: number
  nextCursor: { createdAt: number; id: string } | null
}
export type AdminTripOffers = {
  pendingOffers: AdminDriverTripOffer[]
  processingOffers: AdminDriverTripOffer[]
  recentOffers: AdminDriverTripOffer[]
  refreshedAt: number
}
export type DriverContact = { driver: { name: string; phone: string } }
export type DriverCallOutcome = 'reached' | 'no_answer' | 'busy' | 'voicemail' | 'other'
export type TripBooking = {
  bookingId: string
  status: string
  holdExpiresAt: number
  pickup: { address: string; formattedAddress: string | null; latitude: number; longitude: number }
  destination: { address: string; formattedAddress: string | null; latitude: number; longitude: number }
  startDate: string
  endDate: string
  partySize: number
  luggageCount: number
  vehicle: Pick<Vehicle, 'id' | 'make' | 'model' | 'year' | 'passengerCapacity' | 'luggageCapacity'>
  quote: TripQuote['quote'] & { distanceMeters: number; durationSeconds: number; nights: number }
}

export function getDriverPrerequisites() {
  return authenticatedFetch<DriverPrerequisites>('/api/marketplace/driver-prerequisites')
}
export function getDriverApplication() {
  return authenticatedFetch<{ application: DriverApplication | null }>('/api/drivers/application')
}
export function acceptDriverPolicies(documentIds: string[]) {
  return authenticatedFetch<{ accepted: boolean }>('/api/marketplace/driver-policy-acceptance', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accepted: true, documentIds }),
  })
}
export function submitDriverApplication(form: FormData) {
  return authenticatedUpload<{ applicationId: string; status: string }>('/api/drivers/application', form)
}
export function setDriverLodgingRate(lodgingRateUgx: number) {
  return authenticatedFetch<{ lodgingRateUgx: number }>('/api/drivers/application/lodging-rate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lodgingRateUgx }),
  })
}
export function getMyVehicles() {
  return authenticatedFetch<{ vehicles: Vehicle[] }>('/api/vehicles/mine')
}
export function getVehicleRequirements() {
  return authenticatedFetch<VehicleRequirements>('/api/vehicles/requirements')
}
export function submitVehicle(form: FormData) {
  return authenticatedUpload<{ vehicleId: string; status: string }>('/api/vehicles', form)
}
export function submitVehicleCorrections(vehicleId: string, form: FormData) {
  return authenticatedUpload<{ vehicleId: string; status: string }>(`/api/vehicles/${vehicleId}/corrections`, form)
}
export function updateVehicle(vehicleId: string, vehicle: {
  make: string; model: string; year: number; passengerCapacity: number; luggageCapacity: number;
  comfortDetails: string; accessibilityDetails: string; registrationNumber: string;
}) {
  return authenticatedFetch<{ vehicleId: string; status: string; reviewRequired: boolean }>(`/api/vehicles/${vehicleId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(vehicle),
  })
}
export function markUnavailable(vehicleId: string, startDate: string, endDate: string) {
  return authenticatedFetch<{ unavailabilityId: string }>(`/api/vehicles/${vehicleId}/unavailability`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ startDate, endDate }),
  })
}
export function removeUnavailable(vehicleId: string, blockId: string) {
  return authenticatedFetch<{ removed: boolean }>(
    `/api/vehicles/${encodeURIComponent(vehicleId)}/unavailability/${encodeURIComponent(blockId)}`,
    { method: 'DELETE' },
  )
}
export function getVehicleAvailability(vehicleId: string) {
  return authenticatedFetch<VehicleAvailability>(`/api/vehicles/${vehicleId}/availability`)
}
export function getClientPrerequisites() {
  return authenticatedFetch<ClientPrerequisites>('/api/marketplace/client-prerequisites')
}
export function getMyBookings() {
  return authenticatedFetch<{ bookings: TripBooking[] }>('/api/trips/mine')
}
export function updateClientProfile(legalName: string, phoneNumber: string, acceptedDocumentIds: string[]) {
  return authenticatedFetch<{ legalName: string; phoneNumber: string }>('/api/marketplace/client-profile', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ legalName, phoneNumber, accepted: true, acceptedDocumentIds }),
  })
}
export function getAvailableVehicles(input: { startDate: string; endDate: string; partySize: number; luggageCount: number }) {
  const query = new URLSearchParams({ ...input, partySize: String(input.partySize), luggageCount: String(input.luggageCount) })
  return authenticatedFetch<{ vehicles: Vehicle[] }>(`/api/vehicles/catalog?${query.toString()}`)
}
export function requestTripQuote(input: {
  origin: { address: string } | { latitude: number; longitude: number }; destination: { address: string }; startDate: string; endDate: string;
  partySize: number; luggageCount: number; vehicleId: string
}) {
  return authenticatedFetch<{ status: 'pending_driver_acceptance'; offerId: string; vehicleId: string; expiresAt: number }>('/api/trips/quote', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
}
export function getCurrentTripOffer() {
  return authenticatedFetch<{ offer: ClientTripOffer | null }>('/api/trips/quote-requests/current')
}
export function getTripOfferStatus(offerId: string) {
  return authenticatedFetch<ClientTripOffer>(`/api/trips/quote-requests/${encodeURIComponent(offerId)}`)
}
export function withdrawTripOffer(offerId: string) {
  return authenticatedFetch<{ offerId: string; status: 'withdrawn' }>(`/api/trips/quote-requests/${encodeURIComponent(offerId)}/withdraw`, { method: 'POST' })
}
export function getDriverTripOffers() {
  return authenticatedFetch<{ offers: DriverTripOffer[] }>('/api/trips/driver-offers')
}
export function respondToDriverTripOffer(offerId: string, decision: 'accept' | 'decline') {
  return authenticatedFetch<{ offerId: string; status: string; quote?: TripQuote }>(
    `/api/trips/driver-offers/${encodeURIComponent(offerId)}/respond`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }) },
  )
}
export function getAdminAccess() {
  return authenticatedFetch<{ authorized: true }>('/api/admin/trip-offers/access')
}
export function getAdminTripOffers() {
  return authenticatedFetch<AdminTripOffers>('/api/admin/trip-offers')
}
export function getDriverTripOfferContact(offerId: string) {
  return authenticatedFetch<DriverContact>(`/api/admin/trip-offers/${encodeURIComponent(offerId)}/driver-contact`, { method: 'POST' })
}
export function getNotificationInbox(cursor?: { createdAt: number; id: string } | null) {
  const params = new URLSearchParams({ limit: '30' })
  if (cursor) {
    params.set('createdAt', String(cursor.createdAt))
    params.set('id', cursor.id)
  }
  return authenticatedFetch<NotificationInboxPage>(`/api/notifications/inbox?${params.toString()}`)
}
export function markNotificationRead(notificationId: string) {
  return authenticatedFetch<{ read: true; readAt: number }>(`/api/notifications/inbox/${encodeURIComponent(notificationId)}/read`, { method: 'POST' })
}
export function markAllNotificationsRead() {
  return authenticatedFetch<{ updated: number; readAt: number }>('/api/notifications/inbox/read-all', { method: 'POST' })
}
export function recordDriverTripOfferFollowUp(offerId: string, outcome: DriverCallOutcome, note: string) {
  return authenticatedFetch<{ followUpId: string; offerId: string; outcome: DriverCallOutcome; createdAt: number }>(
    `/api/admin/trip-offers/${encodeURIComponent(offerId)}/follow-ups`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outcome, note }) },
  )
}
export function confirmTrip(quoteId: string, acceptedDisclosureIds: string[], contactSharingConsent: boolean) {
  return authenticatedFetch<{ bookingId: string; status: string; holdExpiresAt: number }>('/api/trips/confirm', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quoteId, accepted: true, contactSharingConsent, acceptedDisclosureIds }),
  })
}
