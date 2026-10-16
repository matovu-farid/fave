import { Link, type Href } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import * as Linking from 'expo-linking'
import { SafeAreaView } from 'react-native-safe-area-context'

import { ActionButton, Card, Field, Message, SectionTitle } from '@/components/marketplace-ui'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme'
import { AdminNotificationHealth } from '@/components/admin-notification-health'
import {
  getAdminAccess,
  AdminDriverTripOffer,
  AdminAvailabilityRequest,
  DriverCallOutcome,
  DriverContact,
  confirmAvailabilityRequest,
  getAdminAvailabilityRequests,
  getAdminTripOffers,
  getAvailabilityDriverContact,
  getDriverTripOfferContact,
  markAvailabilityUnavailable,
  recordAvailabilityCall,
  recordDriverTripOfferFollowUp,
} from '@/lib/marketplace'

const callOutcomes: { value: DriverCallOutcome; label: string }[] = [
  { value: 'reached', label: 'Reached' },
  { value: 'no_answer', label: 'No answer' },
  { value: 'busy', label: 'Busy' },
  { value: 'voicemail', label: 'Voicemail' },
  { value: 'other', label: 'Other' },
]

function remainingTime(expiresAt: number, now: number) {
  const seconds = Math.max(0, Math.floor((expiresAt - now) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function statusLabel(status: string) {
  switch (status) {
    case 'quoted': return 'Driver accepted · quote ready'
    case 'declined': return 'Driver declined'
    case 'expired': return 'Offer expired'
    case 'withdrawn': return 'Request withdrawn'
    case 'quote_failed': return 'Quote could not be prepared'
    default: return status
  }
}

export default function AdminScreen() {
  const [operations,setOperations]=useState(false)
  const [pendingOffers, setPendingOffers] = useState<AdminDriverTripOffer[]>([])
  const [processingOffers, setProcessingOffers] = useState<AdminDriverTripOffer[]>([])
  const [recentOffers, setRecentOffers] = useState<AdminDriverTripOffer[]>([])
  const [availabilityRequests, setAvailabilityRequests] = useState<AdminAvailabilityRequest[]>([])
  const [confirmedRequests, setConfirmedRequests] = useState<AdminAvailabilityRequest[]>([])
  const [recentRequests, setRecentRequests] = useState<AdminAvailabilityRequest[]>([])
  const [decisionRequestId, setDecisionRequestId] = useState('')
  const [contacts, setContacts] = useState<Record<string, DriverContact['driver']>>({})
  const [outcomes, setOutcomes] = useState<Record<string, DriverCallOutcome>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [loggingOfferId, setLoggingOfferId] = useState('')
  const [busyOfferId, setBusyOfferId] = useState('')
  const [now, setNow] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const refresh = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true)
    setError('')
    try {
      const access=await getAdminAccess()
      setOperations(access.operations)
      if(!access.operations)return
      const [result, availability] = await Promise.all([getAdminTripOffers(), getAdminAvailabilityRequests()])
      setPendingOffers(result.pendingOffers)
      setProcessingOffers(result.processingOffers)
      setRecentOffers(result.recentOffers)
      setAvailabilityRequests(availability.pendingRequests)
      setConfirmedRequests(availability.confirmedRequests)
      setRecentRequests(availability.recentRequests)
      setNow(Date.now())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Trip operations are temporarily unavailable.')
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [])

  const revealAvailabilityDriver = async (requestId: string) => {
    setBusyOfferId(requestId); setError(''); setMessage('')
    try {
      const result = await getAvailabilityDriverContact(requestId)
      setContacts((current) => ({ ...current, [requestId]: result.driver }))
      setOutcomes((current) => ({ ...current, [requestId]: current[requestId] ?? 'no_answer' }))
      setMessage('Driver contact access was recorded. Call the driver to check these dates.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Driver contact is temporarily unavailable.') }
    finally { setBusyOfferId('') }
  }

  const callAvailabilityDriver = async (requestId: string) => {
    const contact = contacts[requestId]
    if (!contact) return
    try {
      await Linking.openURL(`tel:${contact.phone}`)
      setLoggingOfferId(requestId)
      setMessage('After the call, save its outcome before deciding availability.')
    } catch {
      setError('This device could not open the phone app. You can still record a call attempt.')
      setLoggingOfferId(requestId)
    }
  }

  const saveAvailabilityCall = async (requestId: string) => {
    setBusyOfferId(requestId); setError(''); setMessage('')
    try {
      await recordAvailabilityCall(requestId, outcomes[requestId] ?? 'no_answer', notes[requestId] ?? '')
      setNotes((current) => ({ ...current, [requestId]: '' }))
      setLoggingOfferId('')
      setMessage('Call attempt saved. You can now confirm or decline availability for the requested dates.')
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The call attempt could not be saved.') }
    finally { setBusyOfferId('') }
  }

  const decideAvailability = async (requestId: string, available: boolean) => {
    setBusyOfferId(requestId); setError(''); setMessage('')
    try {
      if (available) await confirmAvailabilityRequest(requestId)
      else await markAvailabilityUnavailable(requestId)
      setContacts((current) => { const next = { ...current }; delete next[requestId]; return next })
      setDecisionRequestId('')
      setMessage(available ? 'Dates confirmed. The client has the same-price quote and a hold through the quote window.' : 'Marked unavailable. The client was notified and no deposit is requested.')
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update availability.') }
    finally { setBusyOfferId('') }
  }

  useEffect(() => {
    const initialLoadTimer = setTimeout(() => { void refresh(true) }, 0)
    const refreshTimer = setInterval(() => { void refresh() }, 15_000)
    const clockTimer = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      clearTimeout(initialLoadTimer)
      clearInterval(refreshTimer)
      clearInterval(clockTimer)
    }
  }, [refresh])

  const revealDriverContact = async (offerId: string) => {
    setBusyOfferId(offerId)
    setError('')
    setMessage('')
    try {
      const result = await getDriverTripOfferContact(offerId)
      setContacts((current) => ({ ...current, [offerId]: result.driver }))
      setOutcomes((current) => ({ ...current, [offerId]: current[offerId] ?? 'no_answer' }))
      setMessage('Driver contact access was recorded. Call the driver if a follow-up is needed.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Driver contact is temporarily unavailable.')
    } finally {
      setBusyOfferId('')
    }
  }

  const callDriver = async (offerId: string) => {
    const contact = contacts[offerId]
    if (!contact) return
    try {
      await Linking.openURL(`tel:${contact.phone}`)
      setLoggingOfferId(offerId)
      setMessage('After the call, save its outcome below.')
    } catch {
      setError('This device could not open the phone app. You can still record a call attempt below.')
      setLoggingOfferId(offerId)
    }
  }

  const saveFollowUp = async (offerId: string) => {
    setBusyOfferId(offerId)
    setError('')
    setMessage('')
    try {
      await recordDriverTripOfferFollowUp(
        offerId,
        outcomes[offerId] ?? 'no_answer',
        notes[offerId] ?? '',
      )
      setNotes((current) => ({ ...current, [offerId]: '' }))
      setLoggingOfferId('')
      setMessage('Call attempt saved to the audit trail.')
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The call attempt could not be saved.')
    } finally {
      setBusyOfferId('')
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <View style={styles.titleGroup}>
              <ThemedText type="smallBold" style={styles.eyebrow}>FAVE · OPERATIONS</ThemedText>
              <ThemedText type="title">Booking requests</ThemedText>
              <ThemedText themeColor="textSecondary">Call drivers to confirm the selected cars for the requested dates.</ThemedText>
            </View>
            <Pressable accessibilityRole="button" onPress={() => void refresh(true)} style={styles.refreshButton}>
              <ThemedText type="smallBold">Refresh</ThemedText>
            </Pressable>
          </View>

          {error ? <Message error>{error}</Message> : null}
          {message ? <Message>{message}</Message> : null}
          <Card>
            <SectionTitle title="Application reviews" detail="Review driver and vehicle applications separately. Private evidence requires your staff verification."/>
            <Link href={'/admin/drivers' as Href}><ThemedText type="link">Driver applications</ThemedText></Link>
            <Link href={'/admin/vehicles' as Href}><ThemedText type="link">Vehicle applications</ThemedText></Link>
            <Link href={'/admin/review-security' as Href}><ThemedText type="link">Staff security</ThemedText></Link>
          </Card>
          {operations?<>
          <AdminNotificationHealth />

          <SectionTitle title="Needs availability check" detail="The client has already seen the saved estimate. Call the driver before confirming the car for these dates." />
          {loading ? <ActivityIndicator accessibilityLabel="Loading availability requests" /> : null}
          {!loading && availabilityRequests.length === 0 && !confirmedRequests.some((request) => request.needsReview) ? (
            <Card><ThemedText>No date checks are waiting for staff.</ThemedText></Card>
          ) : null}
          {[...availabilityRequests, ...confirmedRequests.filter((request) => request.needsReview)].map((request) => {
            const contact = contacts[request.requestId]
            const busy = busyOfferId === request.requestId
            const canDecide = request.callCount > 0
            return (
              <Card key={request.requestId}>
                <View style={styles.offerHeader}>
                  <ThemedText type="smallBold">Received {new Date(request.createdAt).toLocaleString()}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{request.callCount} call{request.callCount === 1 ? '' : 's'} logged</ThemedText>
                </View>
                <ThemedText type="subtitle">{request.vehicle.year} {request.vehicle.make} {request.vehicle.model}</ThemedText>
                <ThemedText>{request.route.pickupArea} → {request.route.destinationArea}</ThemedText>
                <ThemedText themeColor="textSecondary">{request.startDate} to {request.endDate}</ThemedText>
                <ThemedText type="smallBold">Estimate: UGX {request.estimate.totalAmount.toLocaleString()}</ThemedText>
                {request.needsReview ? <Message error>The car’s availability or approval has changed. Review these dates with the driver. The client cannot continue to payment.</Message> : null}
                {request.calls.map((call) => <View key={call.callId} style={styles.callHistory}>
                  <ThemedText type="smallBold">{callOutcomes.find((outcome) => outcome.value === call.outcome)?.label ?? call.outcome}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{call.actorName} · {new Date(call.createdAt).toLocaleString()}</ThemedText>
                  {call.note ? <ThemedText type="small">{call.note}</ThemedText> : null}
                </View>)}

                {!contact ? (
                  <ActionButton title="Show driver contact" busy={busy} onPress={() => void revealAvailabilityDriver(request.requestId)} />
                ) : (
                  <View style={styles.contactPanel}>
                    <ThemedText type="smallBold">{contact.name}</ThemedText>
                    <ThemedText selectable>{contact.phone}</ThemedText>
                    <ActionButton title="Call driver" onPress={() => void callAvailabilityDriver(request.requestId)} />
                    {loggingOfferId === request.requestId ? (
                      <View style={styles.followUpForm}>
                        <ThemedText type="smallBold">Log call outcome</ThemedText>
                        <View style={styles.outcomeList}>
                          {callOutcomes.map((outcome) => {
                            const selected = (outcomes[request.requestId] ?? 'no_answer') === outcome.value
                            return (
                              <Pressable
                                key={outcome.value}
                                accessibilityRole="radio"
                                accessibilityState={{ checked: selected }}
                                onPress={() => setOutcomes((current) => ({ ...current, [request.requestId]: outcome.value }))}
                                style={[styles.outcome, selected && styles.outcomeSelected]}
                              >
                                <ThemedText type="smallBold" style={selected ? styles.selectedLabel : undefined}>{outcome.label}</ThemedText>
                              </Pressable>
                            )
                          })}
                        </View>
                        <Field
                          label="Optional note"
                          value={notes[request.requestId] ?? ''}
                          onChangeText={(value) => setNotes((current) => ({ ...current, [request.requestId]: value }))}
                          placeholder="Short operational note"
                          multiline
                        />
                        <ActionButton title="Save call attempt" busy={busy} onPress={() => void saveAvailabilityCall(request.requestId)} />
                      </View>
                    ) : null}
                  </View>
                )}
                <View style={styles.decisionRow}>
                  <View style={styles.decisionButton}>
                    <ActionButton title="Confirm dates" busy={busy} disabled={!request.driverReached || request.needsReview || request.status !== 'requested'} onPress={() => setDecisionRequestId(request.requestId)} />
                  </View>
                  <View style={styles.decisionButton}>
                    <ActionButton title="Unavailable" busy={busy} disabled={!canDecide} onPress={() => void decideAvailability(request.requestId, false)} />
                  </View>
                </View>
                {!canDecide ? <ThemedText type="small" themeColor="textSecondary">Log at least one call attempt before confirming or declining these dates.</ThemedText> : null}
                {canDecide && !request.driverReached ? <ThemedText type="small" themeColor="textSecondary">The driver hasn’t been reached yet. Leave this request awaiting follow-up until they confirm availability.</ThemedText> : null}
                {decisionRequestId === request.requestId ? <View style={styles.confirmPanel}>
                  <ThemedText type="smallBold">Confirm {request.vehicle.year} {request.vehicle.make} {request.vehicle.model} for {request.startDate} to {request.endDate}?</ThemedText>
                  <ThemedText>This sends the final quote at UGX {request.estimate.totalAmount.toLocaleString()} and holds these dates for this client during the quote window.</ThemedText>
                  <ActionButton title="Send quote and hold these dates" busy={busy} disabled={request.needsReview} onPress={() => void decideAvailability(request.requestId, true)} />
                  <ActionButton title="Back" disabled={busy} onPress={() => setDecisionRequestId('')} />
                </View> : null}
              </Card>
            )
          })}

          <SectionTitle title="Quote sent" detail="These cars are held for the clients until their quote windows end or they continue to the deposit step." />
          {confirmedRequests.filter((request) => !request.needsReview).length === 0 ? <ThemedText themeColor="textSecondary">No quote holds are active.</ThemedText> : null}
          {confirmedRequests.filter((request) => !request.needsReview).map((request) => <Card key={request.requestId}>
            <ThemedText type="subtitle">{request.vehicle.year} {request.vehicle.make} {request.vehicle.model}</ThemedText>
            <ThemedText>{request.startDate} to {request.endDate} · {request.route.pickupArea} → {request.route.destinationArea}</ThemedText>
            <ThemedText>UGX {request.estimate.totalAmount.toLocaleString()} · held until {request.holdExpiresAt ? new Date(request.holdExpiresAt).toLocaleString() : '—'}</ThemedText>
          </Card>)}

          <SectionTitle title="Recent availability activity" detail="Unavailable, withdrawn, expired, and converted requests." />
          {recentRequests.length === 0 ? <ThemedText themeColor="textSecondary">No recent availability activity.</ThemedText> : null}
          {recentRequests.map((request) => <Card key={request.requestId}>
            <ThemedText type="smallBold">{request.status === 'converted_to_booking' ? 'Continued to booking' : request.status.replaceAll('_', ' ')}</ThemedText>
            <ThemedText>{request.vehicle.make} {request.vehicle.model} · {request.startDate} to {request.endDate}</ThemedText>
            <ThemedText themeColor="textSecondary">{request.route.pickupArea} → {request.route.destinationArea}</ThemedText>
          </Card>)}

          <SectionTitle title="Waiting for drivers" detail="Offers close after 15 minutes. Fave will not charge the client while waiting." />
          {loading ? <ActivityIndicator accessibilityLabel="Loading trip offers" /> : null}
          {!loading && pendingOffers.length === 0 ? (
            <Card><ThemedText>No driver offers need follow-up right now.</ThemedText></Card>
          ) : null}
          {pendingOffers.map((offer) => {
            const contact = contacts[offer.offerId]
            const expired = offer.expiresAt <= now
            return (
              <Card key={offer.offerId}>
                <View style={styles.offerHeader}>
                  <ThemedText type="smallBold" style={expired ? styles.expired : styles.countdown}>
                    {expired ? 'Refreshing offer status…' : `${remainingTime(offer.expiresAt, now)} left`}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{offer.followUpCount} call{offer.followUpCount === 1 ? '' : 's'} logged</ThemedText>
                </View>
                <ThemedText type="subtitle">{offer.vehicle.make} {offer.vehicle.model}</ThemedText>
                <ThemedText>{offer.route.pickupArea} → {offer.route.destinationArea}</ThemedText>
                <ThemedText themeColor="textSecondary">{offer.startDate} to {offer.endDate}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">Request received {new Date(offer.createdAt).toLocaleString()}</ThemedText>

                {!contact ? (
                  <ActionButton
                    title="Show driver contact"
                    busy={busyOfferId === offer.offerId}
                    disabled={expired}
                    onPress={() => void revealDriverContact(offer.offerId)}
                  />
                ) : (
                  <View style={styles.contactPanel}>
                    <ThemedText type="smallBold">{contact.name}</ThemedText>
                    <ThemedText selectable>{contact.phone}</ThemedText>
                    <ActionButton title="Call driver" disabled={expired} onPress={() => void callDriver(offer.offerId)} />
                    {loggingOfferId === offer.offerId ? (
                      <View style={styles.followUpForm}>
                        <ThemedText type="smallBold">Log call outcome</ThemedText>
                        <View style={styles.outcomeList}>
                          {callOutcomes.map((outcome) => {
                            const selected = (outcomes[offer.offerId] ?? 'no_answer') === outcome.value
                            return (
                              <Pressable
                                key={outcome.value}
                                accessibilityRole="radio"
                                accessibilityState={{ checked: selected }}
                                onPress={() => setOutcomes((current) => ({ ...current, [offer.offerId]: outcome.value }))}
                                style={[styles.outcome, selected && styles.outcomeSelected]}
                              >
                                <ThemedText type="smallBold" style={selected ? styles.selectedLabel : undefined}>{outcome.label}</ThemedText>
                              </Pressable>
                            )
                          })}
                        </View>
                        <Field
                          label="Optional note"
                          value={notes[offer.offerId] ?? ''}
                          onChangeText={(value) => setNotes((current) => ({ ...current, [offer.offerId]: value }))}
                          placeholder="Short operational note"
                          multiline
                        />
                        <ActionButton
                          title="Save call attempt"
                          busy={busyOfferId === offer.offerId}
                          onPress={() => void saveFollowUp(offer.offerId)}
                        />
                      </View>
                    ) : null}
                  </View>
                )}
              </Card>
            )
          })}

          <SectionTitle title="Preparing quotes" detail="These drivers accepted. The trip quote is being calculated; no payment has been taken." />
          {processingOffers.length === 0 ? <ThemedText themeColor="textSecondary">No quotes are being prepared.</ThemedText> : null}
          {processingOffers.map((offer) => (
            <Card key={offer.offerId}>
              <ThemedText type="smallBold">Driver accepted · preparing quote</ThemedText>
              <ThemedText type="subtitle">{offer.vehicle.make} {offer.vehicle.model}</ThemedText>
              <ThemedText>{offer.route.pickupArea} → {offer.route.destinationArea}</ThemedText>
              <ThemedText themeColor="textSecondary">{offer.startDate} to {offer.endDate}</ThemedText>
            </Card>
          ))}

          <SectionTitle title="Recent responses" detail="Accepted, declined, expired, and unsuccessful offers from the last 24 hours." />
          {recentOffers.length === 0 ? <ThemedText themeColor="textSecondary">No recent responses.</ThemedText> : null}
          {recentOffers.map((offer) => (
            <Card key={offer.offerId}>
              <ThemedText type="smallBold">{statusLabel(offer.status)}</ThemedText>
              <ThemedText>{offer.vehicle.make} {offer.vehicle.model} · {offer.startDate} to {offer.endDate}</ThemedText>
              <ThemedText themeColor="textSecondary">{offer.route.pickupArea} → {offer.route.destinationArea}</ThemedText>
            </Card>
          ))}
          <ThemedText type="small" themeColor="textSecondary">Follow-up never accepts, declines, or extends a driver offer. Client contact details are not shown here.</ThemedText>
          </>:null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row' },
  safeArea: { flex: 1, alignItems: 'center', paddingBottom: BottomTabInset, maxWidth: MaxContentWidth },
  content: { width: '100%', padding: Spacing.three, paddingBottom: Spacing.five, gap: Spacing.three },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.two },
  titleGroup: { flex: 1, gap: Spacing.two },
  eyebrow: { letterSpacing: 2 },
  refreshButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.three },
  offerHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
  countdown: { color: '#9a3412' },
  expired: { color: '#b42318' },
  contactPanel: { gap: Spacing.two },
  followUpForm: { gap: Spacing.two },
  outcomeList: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  outcome: { minHeight: 42, justifyContent: 'center', borderWidth: 1, borderColor: '#aeb2b9', borderRadius: 20, paddingHorizontal: Spacing.two },
  outcomeSelected: { backgroundColor: '#121212', borderColor: '#121212' },
  selectedLabel: { color: '#fff' },
  decisionRow: { flexDirection: 'row', gap: Spacing.two },
  decisionButton: { flex: 1 },
  callHistory: { gap: Spacing.one, paddingVertical: Spacing.two, borderBottomWidth: 1, borderBottomColor: '#d0d5dd' },
  confirmPanel: { gap: Spacing.two, padding: Spacing.three, backgroundColor: '#f3f4f6', borderRadius: 12 },
})
