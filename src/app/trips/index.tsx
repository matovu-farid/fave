import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Image, ScrollView, StyleSheet, View } from 'react-native'

import { ActionButton, Card, CheckRow, Field, Message, SectionTitle, formStyles } from '@/components/marketplace-ui'
import PickupMap, { type MapCoordinate } from '@/components/pickup-map'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme'
import { ApiError, apiBaseUrl } from '@/lib/api'
import { ClientPrerequisites, confirmTrip, getAvailableVehicles, getClientPrerequisites, getMyBookings, PolicyDocument, requestTripQuote, TripBooking, TripQuote, updateClientProfile, Vehicle } from '@/lib/marketplace'

function asAddress(value: string) { return { address: value } }

export default function TripsScreen() {
  const [prerequisites, setPrerequisites] = useState<ClientPrerequisites | null>(null)
  const [bookings, setBookings] = useState<TripBooking[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [selectedVehicle, setSelectedVehicle] = useState('')
  const [quote, setQuote] = useState<TripQuote | null>(null)
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [success, setSuccess] = useState('')
  const [legalName, setLegalName] = useState(''); const [phone, setPhone] = useState(''); const [acceptedClientTerms, setAcceptedClientTerms] = useState(false)
  const [pickup, setPickup] = useState(''); const [destination, setDestination] = useState('')
  const [pickupPin, setPickupPin] = useState<MapCoordinate | null>(null)
  const [pinPickerOpen, setPinPickerOpen] = useState(false)
  const [startDate, setStartDate] = useState(''); const [endDate, setEndDate] = useState('')
  const [partySize, setPartySize] = useState('1'); const [luggageCount, setLuggageCount] = useState('0')
  const [checkedPolicies, setCheckedPolicies] = useState<string[]>([]); const [sharePhone, setSharePhone] = useState(false)
  const searchRevision = useRef(0); const quoteRevision = useRef(0)

  const invalidateQuote = useCallback(() => {
    quoteRevision.current += 1
    setQuote(null)
    setCheckedPolicies([])
    setSharePhone(false)
  }, [])

  const invalidateTripSearch = useCallback(() => {
    searchRevision.current += 1
    invalidateQuote()
    setVehicles([])
    setSelectedVehicle('')
  }, [invalidateQuote])

  const refresh = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [result, bookingResult] = await Promise.all([getClientPrerequisites(), getMyBookings()])
      setPrerequisites(result)
      setBookings(bookingResult.bookings)
      setLegalName(result.profile?.legalName ?? '')
      setPhone(result.profile?.phoneNumber ?? '')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load booking requirements.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void Promise.resolve().then(refresh) }, [refresh])

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
    const revision = searchRevision.current
    setBusy(true); setError(''); setSuccess(''); invalidateQuote(); setVehicles([]); setSelectedVehicle('')
    try {
      const result = await getAvailableVehicles({ startDate, endDate, partySize: Number(partySize), luggageCount: Number(luggageCount) })
      if (revision !== searchRevision.current) return
      setVehicles(result.vehicles); setSelectedVehicle(result.vehicles[0]?.id ?? '')
      if (!result.vehicles.length) setSuccess('No approved vehicles match these dates and passenger requirements yet.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not check available vehicles.') }
    finally { setBusy(false) }
  }

  const getQuote = async () => {
    const requestedVehicle = selectedVehicle
    setBusy(true); setError(''); invalidateQuote()
    const revision = quoteRevision.current
    try {
      const result = await requestTripQuote({ origin: pickupPin ?? asAddress(pickup.trim()), destination: asAddress(destination.trim()), startDate, endDate, partySize: Number(partySize), luggageCount: Number(luggageCount), vehicleId: requestedVehicle })
      if (revision !== quoteRevision.current) return
      setCheckedPolicies([]); setSharePhone(false)
      setQuote(result)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create a trip quote.') }
    finally { setBusy(false) }
  }

  const disclosures = prerequisites?.bookingDocuments ?? []
  const disclosureIds = useMemo(() => new Set(checkedPolicies), [checkedPolicies])
  const allDisclosureIds = disclosures.length === 6 && disclosures.every((document) => disclosureIds.has(document.id))
  const togglePolicy = (document: PolicyDocument) => setCheckedPolicies((current) => current.includes(document.id) ? current.filter((id) => id !== document.id) : [...current, document.id])

  const confirm = async () => {
    if (!quote) return
    if (!allDisclosureIds || !sharePhone) {
      setError('Accept every current booking disclosure and the separate phone-sharing consent before requesting this trip.')
      return
    }
    setBusy(true); setError(''); setSuccess('')
    try {
      const booking = await confirmTrip(quote.quoteId, disclosures.map((document) => document.id), sharePhone)
      setSuccess(`Trip request placed. Status: ${booking.status.replaceAll('_', ' ')}. The deposit hold expires ${new Date(booking.holdExpiresAt).toLocaleString()}.`)
      setQuote(null); setVehicles([]); setSharePhone(false); setCheckedPolicies([])
      try {
        const bookingResult = await getMyBookings()
        setBookings(bookingResult.bookings)
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
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <SectionTitle title="Plan a trip" detail="Choose your dates and vehicle. Pickups must be in Kampala, Mukono, or Wakiso; destinations must be in Uganda." />
      {error ? <Message error>{error}</Message> : null}{success ? <Message>{success}</Message> : null}
      <Card>
        <ThemedText type="subtitle">Client details and terms</ThemedText>
        {prerequisites?.documents.length ? prerequisites.documents.map((document) => <View key={document.id} style={styles.document}>
          <ThemedText type="smallBold">{document.type.replaceAll('_', ' ')} · v{document.version}</ThemedText><ThemedText>{document.body}</ThemedText>
        </View>) : <Message>Current approved client terms and privacy notice are not available. Client setup is paused until they are published.</Message>}
        <CheckRow title="I agree to the current client terms and privacy notice" checked={acceptedClientTerms} onPress={() => setAcceptedClientTerms(!acceptedClientTerms)} disabled={busy} />
        <Field label="Legal name" value={legalName} onChangeText={setLegalName} placeholder="Your full name" />
        <Field label="Phone number" value={phone} onChangeText={(value) => { setPhone(value); setSharePhone(false) }} placeholder="+256…" keyboardType="phone-pad" editable={!busy} />
        <ActionButton title="Save client details" onPress={() => void configureProfile()} disabled={!canProfile} busy={busy} />
        <Message>Phone verification is not required in V1. Your number is shared with a driver only if you give separate consent for that trip.</Message>
      </Card>
      {bookings.length > 0 ? <Card>
        <ThemedText type="subtitle">Your trip requests</ThemedText>
        {bookings.map((booking) => <View key={booking.bookingId} style={styles.booking}>
          <ThemedText type="smallBold">{booking.status.replaceAll('_', ' ')}</ThemedText>
          <ThemedText>{booking.startDate} to {booking.endDate} · {booking.vehicle.year} {booking.vehicle.make} {booking.vehicle.model}</ThemedText>
          <ThemedText>Pickup · {booking.pickup.formattedAddress ?? booking.pickup.address}</ThemedText>
          <ThemedText>Destination · {booking.destination.formattedAddress ?? booking.destination.address}</ThemedText>
          <ThemedText>{booking.quote.totalAmount.toLocaleString()} {booking.quote.currency}{booking.status === 'deposit_pending' ? ` · hold expires ${new Date(booking.holdExpiresAt).toLocaleString()}` : ''}</ThemedText>
        </View>)}
      </Card> : null}
      <Card>
        <ThemedText type="subtitle">Trip details</ThemedText>
        <Message>When you request a route quote, Fave sends your pickup and destination addresses or map pins to Google Maps to verify pickup coverage and estimate the route. Exact locations are stored with your trip request and are not shown in public vehicle listings.</Message>
        <Field label="Pickup address" value={pickup} onChangeText={(value) => { setPickup(value); setPickupPin(null); setPinPickerOpen(false); invalidateTripSearch() }} placeholder="Street, landmark, Kampala / Wakiso / Mukono" editable={!busy} />
        <ActionButton title={pinPickerOpen ? 'Use pickup address' : 'Drop a pickup pin'} onPress={() => { setPinPickerOpen(!pinPickerOpen); if (!pinPickerOpen) setPickup(''); setPickupPin(null); invalidateTripSearch() }} busy={busy} />
        {pinPickerOpen ? <>
          <PickupMap value={pickupPin} onChange={(value) => { if (!busy) { setPickupPin(value); invalidateTripSearch() } }} />
          {pickupPin ? <Message>Pickup pin · {pickupPin.latitude.toFixed(5)}, {pickupPin.longitude.toFixed(5)}. Fave sends these coordinates to Google Maps when you request a route quote to verify coverage and estimate the route.</Message> : <Message>Place a pin in Kampala, Wakiso, or Mukono. Your pin stays private in the trip details.</Message>}
        </> : null}
        <Field label="Destination address" value={destination} onChangeText={(value) => { setDestination(value); invalidateTripSearch() }} placeholder="Town or address in Uganda" editable={!busy} />
        <View style={formStyles.row}><Field label="Start date (YYYY-MM-DD)" value={startDate} onChangeText={(value) => { setStartDate(value); invalidateTripSearch() }} placeholder="2026-10-04" editable={!busy} /><Field label="End date (YYYY-MM-DD)" value={endDate} onChangeText={(value) => { setEndDate(value); invalidateTripSearch() }} placeholder="2026-10-05" editable={!busy} /></View>
        <View style={formStyles.row}><Field label="Passengers" value={partySize} onChangeText={(value) => { setPartySize(value); invalidateTripSearch() }} keyboardType="numeric" editable={!busy} /><Field label="Luggage pieces" value={luggageCount} onChangeText={(value) => { setLuggageCount(value); invalidateTripSearch() }} keyboardType="numeric" editable={!busy} /></View>
        <ActionButton title="Find available vehicles" onPress={() => void findVehicles()} disabled={(!pickupPin && !pickup.trim()) || (pinPickerOpen && !pickupPin) || !destination.trim() || !startDate || !endDate} busy={busy} />
        {!prerequisites?.bookingReady ? <Message>Booking requires saved client details, current client terms, and all current booking disclosures.</Message> : null}
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
      {vehicles.length > 0 && !quote ? <ActionButton title="Get route and price quote" onPress={() => void getQuote()} disabled={!selectedVehicle} busy={busy} /> : null}
      {quote ? <Card>
        <ThemedText type="subtitle">Your quote · {quote.quote.currency}</ThemedText>
        <ThemedText>Pickup · {quote.pickup.formattedAddress ?? quote.pickup.address} ({quote.pickup.latitude.toFixed(5)}, {quote.pickup.longitude.toFixed(5)})</ThemedText>
        <ThemedText>Destination · {quote.destination.formattedAddress ?? quote.destination.address} ({quote.destination.latitude.toFixed(5)}, {quote.destination.longitude.toFixed(5)})</ThemedText>
        <ThemedText>Dates · {startDate} to {endDate} · {partySize} passengers · {luggageCount} luggage pieces</ThemedText>
        <ThemedText>Route · {(quote.route.distanceMeters / 1000).toFixed(1)} km · approx. {Math.ceil(quote.route.durationSeconds / 60)} min</ThemedText>
        {quote.quote.components.map((component) => <View key={component.key} style={styles.quoteLine}><ThemedText>{component.label}</ThemedText><ThemedText>{component.amount.toLocaleString()} {quote.quote.currency}</ThemedText></View>)}
        <View style={styles.quoteLine}><ThemedText type="smallBold">Trip total</ThemedText><ThemedText type="smallBold">{quote.quote.totalAmount.toLocaleString()} {quote.quote.currency}</ThemedText></View>
        <ThemedText>Deposit to place a time-limited vehicle hold: {quote.quote.depositAmount.toLocaleString()} {quote.quote.currency}. Quote expires {new Date(quote.expiresAt).toLocaleString()}.</ThemedText>
        <ThemedText>Fare policy · v{quote.quote.farePolicyVersion}</ThemedText>
        <ThemedText type="subtitle">Review booking disclosures</ThemedText>
        {disclosures.map((document) => <View key={document.id} style={styles.document}>
          <ThemedText type="smallBold">{document.type.replaceAll('_', ' ')} · v{document.version}</ThemedText><ThemedText>{document.body}</ThemedText>
          <CheckRow title="I have read and accept this disclosure" checked={disclosureIds.has(document.id)} onPress={() => togglePolicy(document)} disabled={busy} />
        </View>)}
        <CheckRow title="I agree that my phone number may be shared with the driver assigned to this trip" detail="Your contact details are not shared with drivers before assignment." checked={sharePhone} onPress={() => setSharePhone(!sharePhone)} disabled={busy} />
        <ActionButton title="Request this trip" onPress={() => void confirm()} disabled={!allDisclosureIds || !sharePhone || !prerequisites?.bookingReady} busy={busy} />
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
  booking: { gap: Spacing.one, paddingVertical: Spacing.two, borderBottomWidth: 1, borderBottomColor: '#b8bbc2' },
})
