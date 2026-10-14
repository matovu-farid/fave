import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import * as Linking from 'expo-linking'
import { SafeAreaView } from 'react-native-safe-area-context'

import { ActionButton, Card, Field, Message, SectionTitle } from '@/components/marketplace-ui'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme'
import {
  AdminDriverTripOffer,
  DriverCallOutcome,
  DriverContact,
  getAdminTripOffers,
  getDriverTripOfferContact,
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
  const [pendingOffers, setPendingOffers] = useState<AdminDriverTripOffer[]>([])
  const [processingOffers, setProcessingOffers] = useState<AdminDriverTripOffer[]>([])
  const [recentOffers, setRecentOffers] = useState<AdminDriverTripOffer[]>([])
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
      const result = await getAdminTripOffers()
      setPendingOffers(result.pendingOffers)
      setProcessingOffers(result.processingOffers)
      setRecentOffers(result.recentOffers)
      setNow(Date.now())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Trip operations are temporarily unavailable.')
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [])

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
              <ThemedText type="title">Trip follow-up</ThemedText>
              <ThemedText themeColor="textSecondary">Check driver responses and call when a request may need a nudge.</ThemedText>
            </View>
            <Pressable accessibilityRole="button" onPress={() => void refresh(true)} style={styles.refreshButton}>
              <ThemedText type="smallBold">Refresh</ThemedText>
            </Pressable>
          </View>

          {error ? <Message error>{error}</Message> : null}
          {message ? <Message>{message}</Message> : null}
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
})
