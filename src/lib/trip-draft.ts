export type TripDraft = {
  pickup: string
  destination: string
  pickupPin: { latitude: number; longitude: number } | null
  startDate: string
  endDate: string
  partySize: string
  luggageCount: string
  selectedVehicle: string
}

export type BookingProgressStage = 'trip' | 'vehicle' | 'driver' | 'quote' | 'deposit'

export type BookingProgressStep = {
  id: BookingProgressStage
  label: string
  state: 'complete' | 'current' | 'upcoming'
}

type BookingHold = { status: string; holdExpiresAt: number }

export interface AsyncKeyValueStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

const tripDraftVersion = 1
const bookingStages: { id: BookingProgressStage; label: string }[] = [
  { id: 'trip', label: 'Trip details' },
  { id: 'vehicle', label: 'Choose a car' },
  { id: 'driver', label: 'Driver response' },
  { id: 'quote', label: 'Quote and terms' },
  { id: 'deposit', label: 'Deposit' },
]

function isTripDraft(value: unknown): value is TripDraft {
  if (!value || typeof value !== 'object') return false
  const draft = value as Record<string, unknown>
  const validPin = draft.pickupPin === null || (
    Boolean(draft.pickupPin) && typeof draft.pickupPin === 'object' &&
    Number.isFinite((draft.pickupPin as Record<string, unknown>).latitude) &&
    Number.isFinite((draft.pickupPin as Record<string, unknown>).longitude)
  )

  return typeof draft.pickup === 'string' &&
    typeof draft.destination === 'string' && validPin &&
    typeof draft.startDate === 'string' && typeof draft.endDate === 'string' &&
    typeof draft.partySize === 'string' && typeof draft.luggageCount === 'string' &&
    typeof draft.selectedVehicle === 'string'
}

function parseSavedDraft(value: string | null): { userId: string; draft: TripDraft } | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as { version?: unknown; userId?: unknown; draft?: unknown }
    if (parsed.version !== tripDraftVersion || typeof parsed.userId !== 'string' || !parsed.draft || typeof parsed.draft !== 'object') return null
    const savedDraft = parsed.draft as Record<string, unknown>
    const draft = {
      ...savedDraft,
      selectedVehicle: typeof savedDraft.selectedVehicle === 'string' ? savedDraft.selectedVehicle : '',
    }
    if (!isTripDraft(draft)) return null
    return { userId: parsed.userId, draft }
  } catch {
    return null
  }
}

export function hasTripDraftContent(draft: TripDraft) {
  return Boolean(
    draft.pickup.trim() || draft.destination.trim() || draft.pickupPin ||
    draft.startDate.trim() || draft.endDate.trim() || draft.partySize !== '1' || draft.luggageCount !== '0' || draft.selectedVehicle,
  )
}

export function getBookingProgress(currentStage: BookingProgressStage): BookingProgressStep[] {
  const currentIndex = bookingStages.findIndex((stage) => stage.id === currentStage)
  return bookingStages.map((stage, index) => ({
    ...stage,
    state: index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'upcoming',
  }))
}

export function getCurrentBookingStage(state: {
  hasVehicles: boolean
  hasOffer: boolean
  hasQuote: boolean
  hasDepositHold: boolean
}): BookingProgressStage {
  if (state.hasDepositHold) return 'deposit'
  if (state.hasQuote) return 'quote'
  if (state.hasOffer) return 'driver'
  if (state.hasVehicles) return 'vehicle'
  return 'trip'
}

export function hasActiveDepositHold(bookings: BookingHold[], now: number) {
  return bookings.some((booking) => booking.status === 'deposit_pending' && booking.holdExpiresAt > now)
}

export function restoreSelectedVehicleId(requestedId: string, availableVehicleIds: string[]) {
  return availableVehicleIds.includes(requestedId) ? requestedId : ''
}

export function createTripDraftStore(storage: AsyncKeyValueStorage, key = 'fave-trip-draft-v1') {
  let pendingWrites: Promise<void> = Promise.resolve()

  const enqueue = <T>(operation: () => Promise<T>) => {
    const result = pendingWrites.then(operation)
    pendingWrites = result.then(() => undefined, () => undefined)
    return result
  }

  const clear = (userId: string) => enqueue(async () => {
    const saved = parseSavedDraft(await storage.getItem(key))
    if (saved?.userId === userId) await storage.removeItem(key)
  })

  return {
    async load(userId: string): Promise<TripDraft | null> {
      await pendingWrites
      const raw = await storage.getItem(key)
      const saved = parseSavedDraft(raw)
      if (!saved) {
        if (raw !== null) await storage.removeItem(key)
        return null
      }
      if (saved.userId !== userId || !hasTripDraftContent(saved.draft)) {
        await storage.removeItem(key)
        return null
      }
      return saved.draft
    },

    save(userId: string, draft: TripDraft) {
      if (!hasTripDraftContent(draft)) return clear(userId)
      const value = JSON.stringify({ version: tripDraftVersion, userId, draft })
      return enqueue(() => storage.setItem(key, value))
    },

    clear,
  }
}
