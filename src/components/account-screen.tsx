import { useCallback, useState } from 'react'
import { ScrollView, StyleSheet } from 'react-native'
import { router, useFocusEffect } from 'expo-router'

import { ActionButton, Card, CheckRow, Field, Message, SectionTitle } from '@/components/marketplace-ui'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme'
import { authClient } from '@/lib/auth-client'
import { ClientPrerequisites, DriverApplication, getClientPrerequisites, getDriverApplication, updateClientProfile } from '@/lib/marketplace'
import { unregisterPushNotifications } from '@/lib/push-notifications'

export default function AccountScreen({ onClose }: { onClose: () => void }) {
  const { data: session } = authClient.useSession()
  const [client, setClient] = useState<ClientPrerequisites | null>(null)
  const [driver, setDriver] = useState<DriverApplication | null>(null)
  const [clientError, setClientError] = useState('')
  const [driverError, setDriverError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [legalName, setLegalName] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [message, setMessage] = useState('')
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setClientError('')
    setDriverError('')
    const results = await Promise.allSettled([getClientPrerequisites(), getDriverApplication()])
    const [clientResult, driverResult] = results
    if (clientResult.status === 'fulfilled') {
      setClient(clientResult.value)
      setLegalName(clientResult.value.profile?.legalName ?? '')
      setPhoneNumber(clientResult.value.profile?.phoneNumber ?? '')
    } else {
      setClientError(clientResult.reason instanceof Error ? clientResult.reason.message : 'Could not load your client profile.')
    }
    if (driverResult.status === 'fulfilled') setDriver(driverResult.value.application)
    else setDriverError(driverResult.reason instanceof Error ? driverResult.reason.message : 'Could not load your driver profile.')
    setLoading(false)
  }, [])

  useFocusEffect(useCallback(() => { void refresh() }, [refresh]))

  const saveClientProfile = async () => {
    if (!client || client.documents.length !== 2) return
    setSaving(true)
    setMessage('')
    setClientError('')
    try {
      const profile = await updateClientProfile(legalName.trim(), phoneNumber.trim(), client.documents.map((document) => document.id))
      setLegalName(profile.legalName)
      setPhoneNumber(profile.phoneNumber)
      setAccepted(false)
      setMessage('Client profile saved.')
      await refresh()
    } catch (cause) {
      setClientError(cause instanceof Error ? cause.message : 'Could not save your client profile.')
    } finally {
      setSaving(false)
    }
  }

  const signOut = async () => {
    setSigningOut(true)
    setSignOutError('')
    try {
      try { await unregisterPushNotifications() } catch { /* Sign-out must remain available when push cleanup fails. */ }
      const result = await authClient.signOut()
      if (result.error) {
        setSignOutError('Could not sign out. Please try again.')
        return
      }
      router.replace('/')
    } catch {
      setSignOutError('Could not sign out. Please try again.')
    } finally {
      setSigningOut(false)
    }
  }

  const hasCurrentClientDocuments = client?.documents.length === 2
  const clientProfileReady = Boolean(legalName.trim() && phoneNumber.trim())

  return <ThemedView style={styles.page}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <SectionTitle title="Account" detail={`Signed in${session?.user.email ? ` as ${session.user.email}` : ''}. Use the same Fave sign-in for both your client and driver profiles.`} />
      {loading ? <ThemedText>Loading your profiles…</ThemedText> : null}

      <Card>
        <ThemedText type="subtitle">Client profile</ThemedText>
        {clientError ? <Message error>{clientError}</Message> : null}
        {client ? <>
          <ThemedText themeColor="textSecondary">{client.profile ? 'Your booking contact details' : 'Complete these details before requesting a trip.'}</ThemedText>
          <Field label="Full name" value={legalName} onChangeText={setLegalName} placeholder="Your name" />
          <Field label="Phone number" value={phoneNumber} onChangeText={setPhoneNumber} placeholder="+256…" keyboardType="phone-pad" />
          {client.documents.map((document) => <ThemedView key={document.id} style={styles.policy}>
            <ThemedText type="smallBold">{document.type.replaceAll('_', ' ')} · v{document.version} · {document.language}</ThemedText>
            <ThemedText type="small">{document.body}</ThemedText>
          </ThemedView>)}
          {!hasCurrentClientDocuments ? <Message>Current approved client terms and privacy notice are not available. Profile changes and booking remain unavailable until they are published.</Message> : <CheckRow
            title="I accept the current client terms and privacy notice"
            checked={accepted}
            onPress={() => setAccepted((value) => !value)}
            disabled={saving}
          />}
          {message ? <Message>{message}</Message> : null}
          <ActionButton title="Save client profile" onPress={() => void saveClientProfile()} disabled={!hasCurrentClientDocuments || !accepted || !clientProfileReady} busy={saving} />
        </> : null}
        <ActionButton title="Plan a trip" onPress={() => router.push('/trips')} />
      </Card>

      <Card>
        <ThemedText type="subtitle">Driver profile</ThemedText>
        {driverError ? <Message error>{driverError}</Message> : null}
        {driver ? <>
          <ThemedText type="smallBold">Application · {driver.status.replaceAll('_', ' ')}</ThemedText>
          <ThemedText>{driver.nextAction}</ThemedText>
          {driver.status === 'approved' ? <ThemedText type="small">Registered overnight rate · {driver.lodgingRateUgx === null ? 'needs updating' : `${driver.lodgingRateUgx.toLocaleString()} UGX per night`}</ThemedText> : null}
        </> : !driverError ? <ThemedText themeColor="textSecondary">No driver profile yet. Apply separately if you want to drive with Fave.</ThemedText> : null}
        <ActionButton title={driver ? 'Open driver profile' : 'Apply to drive'} onPress={() => router.push('/driver')} />
      </Card>

      <Card>
        <ThemedText type="subtitle">Account access</ThemedText>
        <ThemedText themeColor="textSecondary">Your Fave account is signed in. Data export and deletion requests will be added when the approved retention rules are available.</ThemedText>
        {signOutError ? <Message error>{signOutError}</Message> : null}
        <ActionButton title="Sign out" onPress={() => void signOut()} busy={signingOut} />
        <ActionButton title="Back to home" onPress={onClose} />
      </Card>
    </ScrollView>
  </ThemedView>
}

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: 'center', paddingBottom: BottomTabInset },
  content: { width: '100%', maxWidth: MaxContentWidth, padding: Spacing.three, gap: Spacing.three },
  policy: { gap: Spacing.two, padding: Spacing.two, borderRadius: 12 },
})
