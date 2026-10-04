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
export type TripQuote = {
  quoteId: string
  vehicleId: string
  pickup: { address: string; formattedAddress: string | null; latitude: number; longitude: number }
  destination: { address: string; formattedAddress: string | null; latitude: number; longitude: number }
  route: { distanceMeters: number; durationSeconds: number }
  quote: {
    currency: string
    components: { key: string; label: string; amount: number }[]
    totalAmount: number
    depositAmount: number
    depositBasisPoints: number
    farePolicyVersion: string
  }
  expiresAt: number
}
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
  return authenticatedFetch<TripQuote>('/api/trips/quote', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
}
export function confirmTrip(quoteId: string, acceptedDisclosureIds: string[], contactSharingConsent: boolean) {
  return authenticatedFetch<{ bookingId: string; status: string; holdExpiresAt: number }>('/api/trips/confirm', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quoteId, accepted: true, contactSharingConsent, acceptedDisclosureIds }),
  })
}
