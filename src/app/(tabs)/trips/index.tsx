import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Image, ScrollView, StyleSheet, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'

import { ActionButton, Card, CheckRow, Field, Message, SectionTitle, formStyles } from '@/components/marketplace-ui'
import { GoogleMapsAttribution } from '@/components/google-maps-attribution'
import PickupMap, { type MapCoordinate } from '@/components/pickup-map'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme'
import { ApiError, apiBaseUrl } from '@/lib/api'
import { authClient } from '@/lib/auth-client'
import { createLatestRequestGuard } from '@/lib/latest-request'
import { ClientAvailabilityRequest, ClientPrerequisites, ClientTripOffer, confirmTrip, createTripEstimate, getAvailabilityRequest, getAvailableVehicles, getClientPrerequisites, getCurrentAvailabilityRequest, getCurrentTripOffer, getMyBookings, getTripEstimate, getTripOfferStatus, PolicyDocument, requestAvailabilityCheck, TripBooking, TripEstimate, TripQuote, updateClientProfile, Vehicle, withdrawAvailabilityRequest, withdrawTripOffer } from '@/lib/marketplace'
import { getAvailabilityView, getRestorableLegacyQuote, isAwaitingAvailability, tripDraftFromEstimate } from '@/lib/trip-availability'
import { BookingProgressStage, getBookingProgress, getCurrentBookingStage, hasActiveDepositHold, hasTripDraftContent, restoreSelectedVehicleId, TripDraft } from '@/lib/trip-draft'
import { tripDraftStore } from '@/lib/trip-draft-storage'
import { getDriverAccommodationNotice } from '@/lib/trip-quote-display'

function asAddress(value: string) { return { address: value } }

export default function TripsScreen() {
  const params = useLocalSearchParams<{ focusTargetId?: string; focusTargetType?: string }>()
  const focusTargetId = typeof params.focusTargetId === 'string' ? params.focusTargetId : ''
  const focusTargetType = typeof params.focusTargetType === 'string' ? params.focusTargetType : ''
  const scrollRef = useRef<ScrollView>(null)
  const { data: session } = authClient.useSession()
  const userId = session?.user.id
  const [prerequisites, setPrerequisites] = useState<ClientPrerequisites | null>(null)
  const [bookings, setBookings] = useState<TripBooking[]>([])
  const [depositBooking, setDepositBooking] = useState<TripBooking | null>(null)
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [selectedVehicle, setSelectedVehicle] = useState('')
  const [quote, setQuote] = useState<TripQuote | null>(null)
  const [estimate, setEstimate] = useState<TripEstimate | null>(null)
  const [availabilityRequest, setAvailabilityRequest] = useState<ClientAvailabilityRequest | null>(null)
  const [offer, setOffer] = useState<ClientTripOffer | null>(null)
  const [offerCountdown, setOfferCountdown] = useState(0)
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [success, setSuccess] = useState('')
  const [legalName, setLegalName] = useState(''); const [phone, setPhone] = useState(''); const [acceptedClientTerms, setAcceptedClientTerms] = useState(false)
  const [pickup, setPickup] = useState(''); const [destination, setDestination] = useState('')
  const [pickupPin, setPickupPin] = useState<MapCoordinate | null>(null)
  const [pinPickerOpen, setPinPickerOpen] = useState(false)
  const [startDate, setStartDate] = useState(''); const [endDate, setEndDate] = useState('')
  const [partySize, setPartySize] = useState('1'); const [luggageCount, setLuggageCount] = useState('0')
  const [checkedPolicies, setCheckedPolicies] = useState<string[]>([]); const [sharePhone, setSharePhone] = useState(false)
  const [tripDraftReady, setTripDraftReady] = useState(false)
  const [tripDraftOwnerId, setTripDraftOwnerId] = useState('')
  const [tripDraftSaveFailed, setTripDraftSaveFailed] = useState(false)
  const [bookingSubmitted, setBookingSubmitted] = useState(false)
  const hydratedDraftUser = useRef('')
  const searchRevision = useRef(createLatestRequestGuard()); const quoteRevision = useRef(0)

  const invalidateQuote = useCallback(() => {
    quoteRevision.current += 1
    setQuote(null)
    setEstimate(null)
    setAvailabilityRequest(null)
    setCheckedPolicies([])
    setSharePhone(false)
  }, [])

  const invalidateTripSearch = useCallback(() => {
    searchRevision.current.invalidate()
    invalidateQuote()
    setBookingSubmitted(false)
    setVehicles([])
    setSelectedVehicle('')
  }, [invalidateQuote])

  const restoreTripRequest = useCallback((current: ClientTripOffer | null) => {
    const trip = current?.tripRequest
    if (!trip) return
    const pickupInput = trip.pickup.input
    setPickup(trip.pickup.address)
    setPickupPin('latitude' in pickupInput
      ? { latitude: pickupInput.latitude, longitude: pickupInput.longitude }
      : null)
    setPinPickerOpen('latitude' in pickupInput)
    setDestination(trip.destination.address)
    setStartDate(trip.startDate); setEndDate(trip.endDate)
    setPartySize(String(trip.partySize)); setLuggageCount(String(trip.luggageCount))
    setSelectedVehicle(current.vehicleId)
  }, [])

  const restoreEstimateInputs = useCallback((saved: TripEstimate) => {
    const draft = tripDraftFromEstimate(saved)
    setPickup(draft.pickup); setPickupPin(draft.pickupPin); setPinPickerOpen(Boolean(draft.pickupPin))
    setDestination(draft.destination); setStartDate(draft.startDate); setEndDate(draft.endDate)
    setPartySize(draft.partySize); setLuggageCount(draft.luggageCount); setSelectedVehicle(draft.selectedVehicle)
  }, [])

  const recoverAvailability = useCallback((request: ClientAvailabilityRequest, restoreInputs = false) => {
    const view = getAvailabilityView(request, Date.now())
    setAvailabilityRequest(view.phase === 'expired' ? { ...request, status: 'expired' } : request)
    if (restoreInputs) restoreEstimateInputs(request.estimate)
    setQuote(view.quote)
    setEstimate(['checking', 'review', 'quote'].includes(view.phase) ? request.estimate : null)
    setCheckedPolicies([]); setSharePhone(false)
    if (['expired', 'unavailable'].includes(view.phase)) {
      setSelectedVehicle(''); setError(view.message)
    } else {
      setSuccess(view.message)
    }
  }, [restoreEstimateInputs])

  const refresh = useCallback(async () => {
    setLoading(true); setError('')
    if (hydratedDraftUser.current && hydratedDraftUser.current !== userId) {
      hydratedDraftUser.current = ''
      setTripDraftReady(false); setTripDraftOwnerId('')
      setPickup(''); setPickupPin(null); setPinPickerOpen(false)
      setDestination(''); setStartDate(''); setEndDate('')
      setPartySize('1'); setLuggageCount('0'); setSelectedVehicle('')
      setVehicles([]); setOffer(null); setQuote(null); setEstimate(null); setAvailabilityRequest(null); setBookingSubmitted(false)
      setPrerequisites(null); setBookings([]); setDepositBooking(null)
      setLegalName(''); setPhone(''); setAcceptedClientTerms(false)
      setCheckedPolicies([]); setSharePhone(false)
    }
    let currentServerOffer: ClientTripOffer | null = null
    let hasActiveAvailability = false
    const offerPromise = (focusTargetType === 'offer' && focusTargetId
      ? getTripOfferStatus(focusTargetId).then((offer) => ({ offer }))
      : getCurrentTripOffer()).then((result) => {
      currentServerOffer = result.offer && (['pending', 'quoting'].includes(result.offer.status) || getRestorableLegacyQuote(result.offer, false, Date.now())) ? result.offer : null
      return result
    }).catch(() => ({ offer: null }))
    const availabilityPromise = (focusTargetType === 'availability' && focusTargetId
      ? getAvailabilityRequest(focusTargetId) : getCurrentAvailabilityRequest()).then((result) => {
      hasActiveAvailability = Boolean(result.request && ['requested', 'confirmed'].includes(result.request.status))
      return result
    })
    try {
      const [result, bookingResult, offerResult, availabilityResult] = await Promise.all([
        getClientPrerequisites(), getMyBookings(), offerPromise, availabilityPromise,
      ])
      setPrerequisites(result)
      setBookings(bookingResult.bookings)
      setDepositBooking(bookingResult.bookings.find((booking) => booking.status === 'deposit_pending' && booking.holdExpiresAt > Date.now()) ?? null)
      if (availabilityResult.request) recoverAvailability(availabilityResult.request, true)
      else setAvailabilityRequest(null)
      const activeLegacyOffer = !hasActiveAvailability && offerResult.offer && ['pending', 'quoting'].includes(offerResult.offer.status) ? offerResult.offer : null
      const legacyQuote = getRestorableLegacyQuote(offerResult.offer, hasActiveAvailability, Date.now())
      if (activeLegacyOffer) restoreTripRequest(activeLegacyOffer)
      if (legacyQuote) {
        restoreTripRequest(offerResult.offer)
        setQuote(legacyQuote); setEstimate(null); setAvailabilityRequest(null)
      }
      setBookingSubmitted(hasActiveDepositHold(bookingResult.bookings, Date.now()))
      setOffer(activeLegacyOffer)
      if (focusTargetId && offerResult.offer?.offerId === focusTargetId) {
        setSuccess('This is the trip request from your notification. Its current status is shown below.')
      }
      if (focusTargetType === 'offer' && !hasActiveAvailability && offerResult.offer && ['declined', 'expired', 'withdrawn', 'quote_failed'].includes(offerResult.offer.status)) {
        setSelectedVehicle('')
        setError(offerResult.offer.status === 'quote_failed'
          ? 'The quote could not be prepared. No payment was taken. Choose another car and try again.'
          : 'That driver could not accept the trip. No payment was taken. Choose another car to try again.')
      }
      if (activeLegacyOffer) {
        if (userId) void tripDraftStore.clear(userId).catch(() => undefined)
      }
      setLegalName(result.profile?.legalName ?? '')
      setPhone(result.profile?.phoneNumber ?? '')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load booking requirements.') }
    finally {
      if (userId && hydratedDraftUser.current !== userId) {
        hydratedDraftUser.current = userId
        if (currentServerOffer || hasActiveAvailability) {
          void tripDraftStore.clear(userId).catch(() => undefined)
        } else {
          const savedDraft = await tripDraftStore.load(userId).catch(() => null)
          if (savedDraft) {
            setPickup(savedDraft.pickup)
            setPickupPin(savedDraft.pickupPin)
            setPinPickerOpen(Boolean(savedDraft.pickupPin))
            setDestination(savedDraft.destination)
            setStartDate(savedDraft.startDate); setEndDate(savedDraft.endDate)
            setPartySize(savedDraft.partySize); setLuggageCount(savedDraft.luggageCount)
            if (savedDraft.estimateId) {
              try {
                const savedEstimate = await getTripEstimate(savedDraft.estimateId)
                setEstimate(savedEstimate)
                setQuote({
                  quoteId: savedEstimate.estimateId, vehicleId: savedEstimate.vehicleId,
                  pickup: savedEstimate.pickup, destination: savedEstimate.destination,
                  route: savedEstimate.route,
                  quote: savedEstimate.quote, expiresAt: 0,
                })
              } catch { /* The saved draft remains available if the estimate was removed or expired. */ }
            }
            if (savedDraft.selectedVehicle && savedDraft.startDate && savedDraft.endDate) {
              try {
                const result = await getAvailableVehicles({
                  startDate: savedDraft.startDate,
                  endDate: savedDraft.endDate,
                  partySize: Number(savedDraft.partySize),
                  luggageCount: Number(savedDraft.luggageCount),
                })
                setVehicles(result.vehicles)
                const restoredVehicleId = restoreSelectedVehicleId(
                  savedDraft.selectedVehicle,
                  result.vehicles.map((vehicle) => vehicle.id),
                )
                if (restoredVehicleId) {
                  setSelectedVehicle(restoredVehicleId)
                } else {
                  setSelectedVehicle('')
                  setError('The car you selected is no longer available for these dates. Choose another available car to continue.')
                }
              } catch {
                setSelectedVehicle('')
                setError('Your trip details are back, but vehicle availability could not be checked. Search again before requesting a driver.')
              }
            }
          }
        }
        setTripDraftOwnerId(userId)
      }
      setTripDraftReady(true)
      setLoading(false)
    }
  }, [focusTargetId, focusTargetType, restoreTripRequest, recoverAvailability, userId])
  useEffect(() => { void Promise.resolve().then(refresh) }, [refresh])
  useEffect(() => {
    if (!tripDraftReady || !userId || tripDraftOwnerId !== userId) return
    const draft: TripDraft = { pickup, destination, pickupPin, startDate, endDate, partySize, luggageCount, selectedVehicle, estimateId: estimate?.estimateId }
    if (offer || (availabilityRequest && ['requested', 'confirmed'].includes(availabilityRequest.status)) || bookingSubmitted || !hasTripDraftContent(draft)) {
      void tripDraftStore.clear(userId).then(() => setTripDraftSaveFailed(false)).catch(() => setTripDraftSaveFailed(true))
      return
    }
    void tripDraftStore.save(userId, draft).then(() => setTripDraftSaveFailed(false)).catch(() => setTripDraftSaveFailed(true))
  }, [tripDraftReady, tripDraftOwnerId, userId, pickup, destination, pickupPin, startDate, endDate, partySize, luggageCount, selectedVehicle, offer, quote, estimate, availabilityRequest, bookingSubmitted])
  useEffect(() => {
    if (!offer || !['pending', 'quoting'].includes(offer.status)) return
    let active = true
    const poll = async () => {
      try {
        const status = await getTripOfferStatus(offer.offerId)
        if (!active) return
        if (status.status === 'quoted' && status.quote) {
          setQuote(status.quote)
          setOffer(null)
          setSuccess('The driver accepted. Review the trip estimate and continue when you are ready.')
        } else if (status.status === 'booked') {
          setOffer(null)
          setSuccess('This trip is already booked. See your trip requests below.')
        } else if (['declined', 'expired', 'withdrawn', 'quote_failed'].includes(status.status)) {
          setOffer(null)
          setSelectedVehicle('')
          setError(status.status === 'quote_failed'
            ? 'The quote could not be prepared. No payment was taken. Choose another car and try again.'
            : 'That driver could not accept the trip. No payment was taken. Choose another car to try again.')
        } else {
          setOffer(status)
        }
      } catch {
        // Keep the pending screen visible; a later poll can recover the current status.
      }
    }
    const timer = setInterval(() => { void poll() }, 4000)
    return () => { active = false; clearInterval(timer) }
  }, [offer])
  useEffect(() => {
    if (!availabilityRequest || !['requested', 'confirmed'].includes(availabilityRequest.status)) return
    let active = true
    const poll = async () => {
      try {
        const result = await getAvailabilityRequest(availabilityRequest.requestId)
        if (!active) return
        const next = result.request
        if (next.status !== availabilityRequest.status || next.needsReview !== availabilityRequest.needsReview) {
          recoverAvailability(next)
        }
      } catch { /* Keep the status visible and retry on the next interval. */ }
    }
    const timer = setInterval(() => { void poll() }, 4000)
    const expiryTimer = availabilityRequest.status === 'confirmed' && availabilityRequest.holdExpiresAt
      ? setTimeout(() => recoverAvailability({ ...availabilityRequest, status: 'expired' }),
        Math.max(0, availabilityRequest.holdExpiresAt - Date.now()))
      : undefined
    return () => { active = false; clearInterval(timer); if (expiryTimer) clearTimeout(expiryTimer) }
  }, [availabilityRequest, recoverAvailability])
  useEffect(() => {
    if (!offer) return
    const updateCountdown = () => setOfferCountdown(Math.max(0, Math.ceil((offer.expiresAt - Date.now()) / 1000)))
    updateCountdown()
    const timer = setInterval(updateCountdown, 1000)
    return () => clearInterval(timer)
  }, [offer])

  const canProfile = Boolean(legalName.trim() && phone.trim() && acceptedClientTerms && prerequisites?.documents.length === 2)
  const configureProfile = async () => {
    if (!prerequisites) return
    setBusy(true); setError('')
    try {
      await updateClientProfile(legalName, phone, prerequisites.documents.map((document) => document.id))
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save your details.') }
    finally { setBusy(false) }
  }

  const findVehicles = async () => {
    const revision = searchRevision.current.begin()
    setBusy(true); setError(''); setSuccess(''); invalidateQuote(); setVehicles([]); setSelectedVehicle('')
    try {
      const result = await getAvailableVehicles({ startDate, endDate, partySize: Number(partySize), luggageCount: Number(luggageCount) })
      if (!searchRevision.current.isCurrent(revision)) return
      setVehicles(result.vehicles); setSelectedVehicle(result.vehicles[0]?.id ?? '')
      if (!result.vehicles.length) setSuccess('No approved vehicles match these dates and passenger requirements yet.')
    } catch (cause) {
      if (searchRevision.current.isCurrent(revision)) setError(cause instanceof Error ? cause.message : 'Could not check available vehicles.')
    } finally {
      if (searchRevision.current.isCurrent(revision)) setBusy(false)
    }
  }

  const getQuote = async () => {
    const requestedVehicle = selectedVehicle
    setBusy(true); setError(''); invalidateQuote()
    const revision = quoteRevision.current
    try {
      const result = await createTripEstimate({ origin: pickupPin ?? asAddress(pickup.trim()), destination: asAddress(destination.trim()), startDate, endDate, partySize: Number(partySize), luggageCount: Number(luggageCount), vehicleId: requestedVehicle })
      if (revision !== quoteRevision.current) return
      setEstimate(result)
      setAvailabilityRequest(null)
      setQuote({
        quoteId: result.estimateId, vehicleId: result.vehicleId, pickup: result.pickup,
        destination: result.destination, route: result.route, quote: result.quote, expiresAt: 0,
      })
      setCheckedPolicies([]); setSharePhone(false)
      setSuccess('Here is your saved price estimate. Review it before asking Fave to check these dates with the driver.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create a trip estimate.') }
    finally { setBusy(false) }
  }

  const requestStaffAvailability = async () => {
    if (!estimate) return
    setBusy(true); setError(''); setSuccess('')
    try {
      const result = await requestAvailabilityCheck(estimate.estimateId)
      const next = { requestId: result.requestId, estimateId: result.estimateId, status: 'requested' as const, createdAt: result.createdAt, expiresAt: null, holdExpiresAt: null, needsReview: false, estimate }
      setAvailabilityRequest(next)
      setQuote(null)
      setSuccess('Fave will call the driver to check these dates. You will not pay while we check.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not ask Fave to check availability.') }
    finally { setBusy(false) }
  }

  const withdrawOffer = async () => {
    if (!offer) return
    setBusy(true); setError('')
    try {
      await withdrawTripOffer(offer.offerId)
      setOffer(null); setSelectedVehicle('')
      setSuccess('Trip request withdrawn. No payment was taken. You can choose another car.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not withdraw this request.') }
    finally { setBusy(false) }
  }

  const withdrawAvailability = async () => {
    if (!availabilityRequest) return
    setBusy(true); setError('')
    try {
      await withdrawAvailabilityRequest(availabilityRequest.requestId)
      setAvailabilityRequest({ ...availabilityRequest, status: 'withdrawn' })
      setQuote(null); setEstimate(null)
      setSuccess('Availability request withdrawn. No payment was taken.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not withdraw this request.') }
    finally { setBusy(false) }
  }

  const disclosures = prerequisites?.bookingDocuments ?? []
  const disclosureIds = useMemo(() => new Set(checkedPolicies), [checkedPolicies])
  const allDisclosureIds = disclosures.length === 6 && disclosures.every((document) => disclosureIds.has(document.id))
  const togglePolicy = (document: PolicyDocument) => setCheckedPolicies((current) => current.includes(document.id) ? current.filter((id) => id !== document.id) : [...current, document.id])
  const currentBookingStage: BookingProgressStage = getCurrentBookingStage({
    hasVehicles: vehicles.length > 0,
    hasOffer: Boolean(offer || isAwaitingAvailability(availabilityRequest)),
    hasQuote: Boolean(quote),
    hasDepositHold: bookingSubmitted,
  })
  const bookingProgress = getBookingProgress(currentBookingStage)
  const currentProgressStep = bookingProgress.findIndex((step) => step.state === 'current')
  const isFinalQuote = Boolean(quote && quote.expiresAt > 0)

  const confirm = async () => {
    if (!quote) return
    if (!allDisclosureIds || !sharePhone) {
      setError('Accept every current booking disclosure and the separate phone-sharing consent before requesting this trip.')
      return
    }
    setBusy(true); setError(''); setSuccess('')
    try {
      const booking = await confirmTrip(quote.quoteId, disclosures.map((document) => document.id), sharePhone)
      setBookingSubmitted(true)
      setSuccess(`Trip request placed. Status: ${booking.status.replaceAll('_', ' ')}. The deposit hold expires ${new Date(booking.holdExpiresAt).toLocaleString()}.`)
      setQuote(null); setVehicles([]); setSharePhone(false); setCheckedPolicies([])
      try {
        const bookingResult = await getMyBookings()
        setBookings(bookingResult.bookings)
        setDepositBooking(bookingResult.bookings.find((item) => item.bookingId === booking.bookingId) ?? null)
      } catch {
        setError('Your trip request was placed, but its status could not be refreshed. Refresh this screen to check it.')
      }
    } catch (cause) {
      if (cause instanceof ApiError && ['QUOTE_EXPIRED', 'QUOTE_CHANGED', 'QUOTE_INVALID', 'BOOKING_UNAVAILABLE'].includes(cause.code ?? '')) {
        invalidateQuote()
        setError(`${cause.message} Refresh available vehicles and request a new quote before confirming.`)
      } else if (cause instanceof ApiError && ['BOOKING_TERMS_CHANGED', 'BOOKING_TERMS_UNAVAILABLE'].includes(cause.code ?? '')) {
        try {
          setPrerequisites(await getClientPrerequisites())
          setCheckedPolicies([]); setSharePhone(false)
          setError('Booking disclosures changed. Review the current disclosures and accept them again before confirming.')
        } catch {
          invalidateQuote()
          setError('Booking disclosures changed and could not be refreshed. Refresh this screen before requesting another quote.')
        }
      } else {
        setError(cause instanceof Error ? cause.message : 'Could not confirm this trip request.')
      }
    }
    finally { setBusy(false) }
  }

  if (loading) return <ThemedView style={styles.loading}><ThemedText>Loading trip requirements…</ThemedText></ThemedView>
  return <ThemedView style={styles.page}>
    <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <SectionTitle title="Plan a trip" detail="Choose your dates and vehicle. Pickups must be in Kampala, Mukono, or Wakiso; destinations must be in Uganda." />
      <Card>
        <View style={styles.progressRow} accessibilityLabel={`Booking progress, step ${currentProgressStep + 1} of ${bookingProgress.length}: ${bookingProgress[currentProgressStep]?.label}`}>
          {bookingProgress.map((step, index) => <View key={step.id} style={styles.progressStep}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressConnector, index === 0 && styles.progressConnectorHidden, index > 0 && bookingProgress[index - 1]?.state === 'complete' && styles.progressConnectorActive]} />
              <View style={[styles.progressNode, step.state === 'complete' && styles.progressNodeComplete, step.state === 'current' && styles.progressNodeCurrent]}>
                <ThemedText type="smallBold" style={[styles.progressNodeText, step.state !== 'upcoming' && styles.progressNodeTextActive]}>
                  {step.state === 'complete' ? '✓' : index + 1}
                </ThemedText>
              </View>
              <View style={[styles.progressConnector, index === bookingProgress.length - 1 && styles.progressConnectorHidden, step.state === 'complete' && styles.progressConnectorActive]} />
            </View>
            <ThemedText type="small" style={[styles.progressLabel, step.state === 'current' && styles.progressLabelCurrent]}>{step.label}</ThemedText>
          </View>)}
        </View>
        <ThemedText type="smallBold" accessibilityLiveRegion="polite">Step {currentProgressStep + 1} of {bookingProgress.length} · {bookingProgress[currentProgressStep]?.label}</ThemedText>
        {tripDraftSaveFailed
          ? <Message error>We could not save your trip draft. Keep this screen open so you do not lose these details.</Message>
          : <ThemedText type="small">Your trip details are saved as you go. Profile details, consent, and payment information are not saved in this draft.</ThemedText>}
      </Card>
      {error ? <Message error>{error}</Message> : null}{success ? <Message>{success}</Message> : null}
      {currentBookingStage === 'trip' ? <Card>
        <ThemedText type="subtitle">Client details and terms</ThemedText>
        {prerequisites?.documents.length ? prerequisites.documents.map((document) => <View key={document.id} style={styles.document}>
          <ThemedText type="smallBold">{document.type.replaceAll('_', ' ')} · v{document.version}</ThemedText><ThemedText>{document.body}</ThemedText>
        </View>) : <Message>Current approved client terms and privacy notice are not available. Client setup is paused until they are published.</Message>}
        <CheckRow title="I agree to the current client terms and privacy notice" checked={acceptedClientTerms} onPress={() => setAcceptedClientTerms(!acceptedClientTerms)} disabled={busy} />
        <Field label="Legal name" value={legalName} onChangeText={setLegalName} placeholder="Your full name" />
        <Field label="Phone number" value={phone} onChangeText={(value) => { setPhone(value); setSharePhone(false) }} placeholder="+256…" keyboardType="phone-pad" editable={!busy} />
        <ActionButton title="Save client details" onPress={() => void configureProfile()} disabled={!canProfile} busy={busy} />
        <Message>Phone verification is not required in V1. Your number is shared with a driver only if you give separate consent for that trip.</Message>
      </Card> : null}
      {bookings.length > 0 ? <Card>
        <ThemedText type="subtitle">Your trip requests</ThemedText>
        {bookings.map((booking) => <View key={booking.bookingId} style={styles.booking} onLayout={(event) => {
          if (focusTargetType === 'booking' && focusTargetId === booking.bookingId) {
            scrollRef.current?.scrollTo({ y: event.nativeEvent.layout.y, animated: true })
          }
        }}>
          {focusTargetType === 'booking' && focusTargetId === booking.bookingId ? <ThemedText type="smallBold">Opened from your alert</ThemedText> : null}
          <ThemedText type="smallBold">{booking.status.replaceAll('_', ' ')}</ThemedText>
          <ThemedText>{booking.startDate} to {booking.endDate} · {booking.vehicle.year} {booking.vehicle.make} {booking.vehicle.model}</ThemedText>
          <ThemedText>Pickup · {booking.pickup.formattedAddress ?? booking.pickup.address}</ThemedText>
          <ThemedText>Destination · {booking.destination.formattedAddress ?? booking.destination.address}</ThemedText>
          <ThemedText>{booking.quote.totalAmount.toLocaleString()} {booking.quote.currency}{booking.status === 'deposit_pending' ? ` · hold expires ${new Date(booking.holdExpiresAt).toLocaleString()}` : ''}</ThemedText>
        </View>)}
      </Card> : null}
      {currentBookingStage === 'trip' ? <Card>
        <ThemedText type="subtitle">Trip details</ThemedText>
        <Message>When you request a route quote, Fave sends your pickup and destination addresses or map pins to Google Maps to verify pickup coverage and estimate the route. Exact locations are stored with your trip request and are not shown in public vehicle listings.</Message>
        <Field label="Pickup address" value={pickup} onChangeText={(value) => { setPickup(value); setPickupPin(null); setPinPickerOpen(false); invalidateTripSearch() }} placeholder="Street, landmark, Kampala / Wakiso / Mukono" editable={!busy && !offer} />
        <ActionButton title={pinPickerOpen ? 'Use pickup address' : 'Drop a pickup pin'} onPress={() => { setPinPickerOpen(!pinPickerOpen); if (!pinPickerOpen) setPickup(''); setPickupPin(null); invalidateTripSearch() }} disabled={Boolean(offer)} busy={busy} />
        {pinPickerOpen ? <>
          <PickupMap value={pickupPin} onChange={(value) => { if (!busy) { setPickupPin(value); invalidateTripSearch() } }} />
          {pickupPin ? <Message>Pickup pin · {pickupPin.latitude.toFixed(5)}, {pickupPin.longitude.toFixed(5)}. Fave sends these coordinates to Google Maps when you request a route quote to verify coverage and estimate the route.</Message> : <Message>Place a pin in Kampala, Wakiso, or Mukono. Your pin stays private in the trip details.</Message>}
        </> : null}
        <Field label="Destination address" value={destination} onChangeText={(value) => { setDestination(value); invalidateTripSearch() }} placeholder="Town or address in Uganda" editable={!busy && !offer} />
        <View style={formStyles.row}><Field label="Start date (YYYY-MM-DD)" value={startDate} onChangeText={(value) => { setStartDate(value); invalidateTripSearch() }} placeholder="YYYY-MM-DD" editable={!busy && !offer} /><Field label="End date (YYYY-MM-DD)" value={endDate} onChangeText={(value) => { setEndDate(value); invalidateTripSearch() }} placeholder="YYYY-MM-DD" editable={!busy && !offer} /></View>
        <View style={formStyles.row}><Field label="Passengers" value={partySize} onChangeText={(value) => { setPartySize(value); invalidateTripSearch() }} keyboardType="numeric" editable={!busy && !offer} /><Field label="Luggage pieces" value={luggageCount} onChangeText={(value) => { setLuggageCount(value); invalidateTripSearch() }} keyboardType="numeric" editable={!busy && !offer} /></View>
        <ActionButton title="Find available vehicles" onPress={() => void findVehicles()} disabled={Boolean(offer) || (!pickupPin && !pickup.trim()) || (pinPickerOpen && !pickupPin) || !destination.trim() || !startDate || !endDate} busy={busy} />
        {!prerequisites?.bookingReady ? <Message>Booking requires saved client details, current client terms, and all current booking disclosures.</Message> : null}
      </Card> : null}
      {currentBookingStage === 'vehicle' ? <>
        <Card>
          <ThemedText type="subtitle">Choose your car</ThemedText>
          <ThemedText>{pickupPin ? 'Pinned pickup' : pickup} → {destination}</ThemedText>
          <ThemedText>{startDate} to {endDate} · {partySize} passengers · {luggageCount} luggage pieces</ThemedText>
          <ActionButton title="Change trip details" onPress={() => { setVehicles([]); setSelectedVehicle(''); invalidateQuote() }} disabled={busy} />
        </Card>
      {vehicles.map((vehicle) => <Card key={vehicle.id}>
        {vehicle.photos?.length ? <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.vehiclePhotos}
          accessibilityLabel={`Approved photos of ${vehicle.year} ${vehicle.make} ${vehicle.model}`}
        >
          {vehicle.photos.map((photo, index) => <Image
            key={photo.id}
            source={{ uri: new URL(photo.url, apiBaseUrl).toString() }}
            style={styles.vehiclePhoto}
            accessibilityLabel={`Approved vehicle photo ${index + 1}`}
          />)}
        </ScrollView> : null}
        <ThemedText type="subtitle">{vehicle.year} {vehicle.make} {vehicle.model}</ThemedText>
        <ThemedText>{vehicle.passengerCapacity} passengers · {vehicle.luggageCapacity} luggage pieces</ThemedText>
        <ThemedText>{vehicle.comfortDetails}</ThemedText>
        {vehicle.accessibilityDetails ? <ThemedText>{vehicle.accessibilityDetails}</ThemedText> : null}
        <CheckRow title="Select this vehicle" checked={selectedVehicle === vehicle.id} onPress={() => { if (selectedVehicle !== vehicle.id) invalidateQuote(); setSelectedVehicle(vehicle.id) }} disabled={busy} />
      </Card>)}
        <ActionButton title="See price estimate" onPress={() => void getQuote()} disabled={!selectedVehicle} busy={busy} />
      </> : null}
      {currentBookingStage === 'driver' && availabilityRequest ? <Card>
        <ThemedText type="subtitle">{availabilityRequest.needsReview ? 'Fave is rechecking these dates' : 'Fave is checking these dates'}</ThemedText>
        <ThemedText>{availabilityRequest.estimate.vehicle?.year} {availabilityRequest.estimate.vehicle?.make} {availabilityRequest.estimate.vehicle?.model} · {availabilityRequest.estimate.startDate} to {availabilityRequest.estimate.endDate}</ThemedText>
        <ThemedText>{availabilityRequest.estimate.pickup.formattedAddress ?? availabilityRequest.estimate.pickup.address} → {availabilityRequest.estimate.destination.formattedAddress ?? availabilityRequest.estimate.destination.address}</ThemedText>
        <ThemedText>Estimate · {availabilityRequest.estimate.quote.totalAmount.toLocaleString()} {availabilityRequest.estimate.quote.currency}</ThemedText>
        <ThemedText>{availabilityRequest.needsReview
          ? 'The car’s availability changed. Fave is reviewing your dates. No payment is due while we recheck.'
          : 'Fave will call the driver to check these dates. No payment is due while we check.'}</ThemedText>
        {availabilityRequest.status === 'requested' ? <ThemedText>Asking us to check does not hold the car.</ThemedText> : null}
        {availabilityRequest.status === 'requested' ? <ActionButton title="Withdraw availability request" onPress={() => void withdrawAvailability()} busy={busy} /> : null}
        <ActionButton title="Refresh status" onPress={() => void refresh()} disabled={busy} />
      </Card> : null}
      {currentBookingStage === 'driver' && offer ? <Card>
        {(() => {
          const vehicle = offer.tripRequest?.vehicle ?? vehicles.find((item) => item.id === offer.vehicleId)
          return vehicle ? <ThemedText type="smallBold">Selected car · {vehicle.year} {vehicle.make} {vehicle.model}</ThemedText> : null
        })()}
        {offer.status === 'pending' ? <>
          <ThemedText type="subtitle">Waiting for the driver</ThemedText>
          <ThemedText>The selected car’s driver has up to 15 minutes to confirm availability. We’ll show the price after they accept. No payment details or money are taken while you wait.</ThemedText>
          <ThemedText type="smallBold">Time remaining · {Math.floor(offerCountdown / 60)}:{String(offerCountdown % 60).padStart(2, '0')}</ThemedText>
          <ActionButton title="Withdraw request" onPress={() => void withdrawOffer()} busy={busy} />
        </> : <>
          <ThemedText type="subtitle">The driver accepted</ThemedText>
          <ThemedText>We’re preparing your trip estimate. You won’t be charged while we calculate the quote.</ThemedText>
        </>}
      </Card> : null}
      {currentBookingStage === 'quote' && quote ? <Card>
        <ThemedText type="subtitle">{isFinalQuote ? 'Your final trip quote' : 'Your trip estimate'} · {quote.quote.currency}</ThemedText>
        <ThemedText>Pickup · {quote.pickup.formattedAddress ?? quote.pickup.address} ({quote.pickup.latitude.toFixed(5)}, {quote.pickup.longitude.toFixed(5)})</ThemedText>
        <ThemedText>Destination · {quote.destination.formattedAddress ?? quote.destination.address} ({quote.destination.latitude.toFixed(5)}, {quote.destination.longitude.toFixed(5)})</ThemedText>
        <ThemedText>Dates · {startDate} to {endDate} · {partySize} passengers · {luggageCount} luggage pieces</ThemedText>
        {!quote.quote.outboundRoute || !quote.quote.returnRoute ? <Message error>The separate outbound and return price details are not available. Request a new quote before continuing.</Message> : null}
        <GoogleMapsAttribution />
        {quote.quote.components.map((component) => {
          const routeLeg = component.key === 'outbound_transport' ? quote.quote.outboundRoute :
            component.key === 'return_transport' ? quote.quote.returnRoute : null
          const unitLabel = component.unit === 'per_night' ? 'nights' :
            component.unit === 'per_kilometer' ? 'km' :
              component.unit === 'per_passenger' ? 'passengers' : 'flat'
          return <View key={component.key} style={styles.quoteLine}>
            <View style={styles.quoteDetails}>
              <ThemedText>{component.label}</ThemedText>
              {routeLeg ? <ThemedText>{(routeLeg.distanceMeters / 1000).toFixed(1)} km · approx. {Math.ceil(routeLeg.durationSeconds / 60)} min · approx. {component.unitRate.toLocaleString(undefined, { maximumFractionDigits: 0 })} {quote.quote.currency}/km</ThemedText> : null}
              {!routeLeg ? <ThemedText>{component.unitRate.toLocaleString()} {quote.quote.currency}{component.unit === 'fixed' ? ' flat' : ` × ${component.quantity} ${unitLabel}`}</ThemedText> : null}
            </View>
            <ThemedText style={styles.quoteAmount}>{component.amount.toLocaleString()} {quote.quote.currency}</ThemedText>
          </View>
        })}
        {getDriverAccommodationNotice(quote.quote.components) ? <ThemedText type="small">{getDriverAccommodationNotice(quote.quote.components)}</ThemedText> : null}
        <View style={styles.quoteLine}><ThemedText type="smallBold" style={styles.quoteDetails}>{availabilityRequest?.status === 'confirmed' ? 'Final trip total · same as your estimate' : isFinalQuote ? 'Trip total' : 'Estimated trip total'}</ThemedText><ThemedText type="smallBold" style={styles.quoteAmount}>{quote.quote.totalAmount.toLocaleString()} {quote.quote.currency}</ThemedText></View>
        {isFinalQuote ? <>
        <ThemedText>{availabilityRequest?.status === 'confirmed' ? 'Fave confirmed the car for your dates at your saved estimate price. The car is held until' : 'The driver accepted this earlier request. Review the quote before'} {new Date(quote.expiresAt).toLocaleString()}.</ThemedText>
        <ThemedText>Deposit to place a time-limited vehicle hold: {quote.quote.depositAmount.toLocaleString()} {quote.quote.currency}.</ThemedText>
        <ThemedText>Fare policy · v{quote.quote.farePolicyVersion}</ThemedText>
        <ThemedText type="subtitle">Review booking disclosures</ThemedText>
        {disclosures.map((document) => <View key={document.id} style={styles.document}>
          <ThemedText type="smallBold">{document.type.replaceAll('_', ' ')} · v{document.version}</ThemedText><ThemedText>{document.body}</ThemedText>
          <CheckRow title="I have read and accept this disclosure" checked={disclosureIds.has(document.id)} onPress={() => togglePolicy(document)} disabled={busy} />
        </View>)}
        <CheckRow title="I agree that my phone number may be shared with the driver assigned to this trip" detail="Your contact details are not shared with drivers before assignment." checked={sharePhone} onPress={() => setSharePhone(!sharePhone)} disabled={busy} />
        <ActionButton title="Continue to deposit" onPress={() => void confirm()} disabled={!quote.quote.outboundRoute || !quote.quote.returnRoute || !allDisclosureIds || !sharePhone || !prerequisites?.bookingReady} busy={busy} />
        </> : <>
          <ThemedText>This estimate is saved with its calculation. You can review it before Fave calls the driver. No payment is due now.</ThemedText>
          <ActionButton title="Ask Fave to book these dates" onPress={() => void requestStaffAvailability()} disabled={!estimate} busy={busy} />
          <ActionButton title="Edit trip details" onPress={() => { setQuote(null); setEstimate(null); setVehicles([]); setSelectedVehicle('') }} disabled={busy} />
        </>}
      </Card> : null}
      {currentBookingStage === 'deposit' ? <Card>
        <ThemedText type="subtitle">Deposit needed to confirm your trip</ThemedText>
        {depositBooking ? (() => {
          const booking = depositBooking
          return <>
            <ThemedText>{booking.vehicle.year} {booking.vehicle.make} {booking.vehicle.model} · {booking.startDate} to {booking.endDate}</ThemedText>
            <ThemedText>Deposit · {booking.quote.depositAmount.toLocaleString()} {booking.quote.currency}</ThemedText>
            <ThemedText>Car held until {new Date(booking.holdExpiresAt).toLocaleString()}</ThemedText>
          </>
        })() : null}
        <Message>Your trip is not confirmed until the deposit is paid. The payment option will appear here when it is ready.</Message>
      </Card> : null}
    </ScrollView>
  </ThemedView>
}

const styles = StyleSheet.create({
  page: { flex: 1 }, loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', padding: Spacing.three, paddingBottom: BottomTabInset + Spacing.five, gap: Spacing.three },
  document: { gap: Spacing.two, padding: Spacing.three, backgroundColor: '#fff', borderRadius: 12 },
  vehiclePhotos: { gap: Spacing.two },
  vehiclePhoto: { width: 280, height: 190, borderRadius: 14, backgroundColor: '#ddd' },
  quoteLine: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
  quoteDetails: { flex: 1, minWidth: 0 },
  quoteAmount: { flexShrink: 0, maxWidth: '45%', textAlign: 'right' },
  booking: { gap: Spacing.one, paddingVertical: Spacing.two, borderBottomWidth: 1, borderBottomColor: '#b8bbc2' },
  progressRow: { flexDirection: 'row', alignItems: 'flex-start' },
  progressStep: { flex: 1, alignItems: 'center', gap: Spacing.one },
  progressTrack: { width: '100%', flexDirection: 'row', alignItems: 'center' },
  progressConnector: { flex: 1, height: 2, backgroundColor: '#d0d5dd' },
  progressConnectorHidden: { backgroundColor: 'transparent' },
  progressConnectorActive: { backgroundColor: '#208AEF' },
  progressNode: { width: 30, height: 30, borderWidth: 1, borderColor: '#b8bbc2', borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  progressNodeComplete: { borderColor: '#208AEF', backgroundColor: '#208AEF' },
  progressNodeCurrent: { borderColor: '#121212', borderWidth: 2, backgroundColor: '#121212' },
  progressNodeText: { fontSize: 12, lineHeight: 16, color: '#667085' },
  progressNodeTextActive: { color: '#fff' },
  progressLabel: { textAlign: 'center', fontSize: 10, lineHeight: 14, color: '#667085' },
  progressLabelCurrent: { color: '#121212', fontWeight: '700' },
})
