import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Linking, Pressable, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { ActionButton, Card, Message, SectionTitle } from '@/components/marketplace-ui'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme'
import {
  disablePushNotifications,
  enablePushNotifications,
  getPushPermissionStatus,
  syncPushTokenForSignedInUser,
} from '../lib/push-notifications'

export default function NotificationsScreen() {
  const [enabled, setEnabled] = useState(false)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [unsupported, setUnsupported] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const refresh = useCallback(async () => {
    setError('')
    try {
      const permission = await getPushPermissionStatus()
      if (permission === 'unsupported') {
        setUnsupported(true)
        setEnabled(false)
        return
      }
      setUnsupported(false)
      setPermissionDenied(permission !== 'granted')
      if (permission === 'granted') setEnabled(await syncPushTokenForSignedInUser() === 'enabled')
      else setEnabled(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Notification settings are temporarily unavailable.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => { void refresh() }, 0)
    return () => clearTimeout(timer)
  }, [refresh])

  const enable = async () => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await enablePushNotifications()
      setEnabled(result === 'enabled')
      setPermissionDenied(result === 'permission_denied')
      setUnsupported(result === 'unsupported')
      if (result === 'enabled') setMessage('Booking and trip alerts are enabled on this device.')
      if (result === 'permission_denied') setMessage('Allow notifications in your device settings, then try again.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not enable notifications right now.')
    } finally {
      setBusy(false)
    }
  }

  const disable = async () => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await disablePushNotifications()
      setEnabled(false)
      setMessage('Push alerts are off on this device.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not turn off notifications right now.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.content}>
          <ThemedText type="smallBold" style={styles.eyebrow}>FAVE · UGANDA</ThemedText>
          <ThemedText type="title" style={styles.title}>Notifications</ThemedText>
          <Card>
            <SectionTitle title="Booking and trip alerts" detail="Choose whether this device can receive push alerts from Fave." />
            <Message>Alerts use a short, private preview. Open Fave to see booking details.</Message>
            {loading ? <ActivityIndicator accessibilityLabel="Loading notification settings" /> : null}
            {!loading && unsupported ? <Message>Push alerts are available in the Fave mobile app.</Message> : null}
            {!loading && !unsupported && enabled ? <Message>Push alerts are on for this device.</Message> : null}
            {!loading && !unsupported && !enabled && permissionDenied ? <Message>Notifications are currently blocked by this device. You can enable them in Settings.</Message> : null}
            {!loading && !unsupported && !enabled && !permissionDenied ? <Message>Push alerts are off for this device.</Message> : null}
            {error ? <Message error>{error}</Message> : null}
            {message ? <Message>{message}</Message> : null}
            {!loading && !unsupported && enabled
              ? <ActionButton title="Turn off push alerts" onPress={() => void disable()} busy={busy} />
              : !loading && !unsupported
                ? <ActionButton title="Enable push alerts" onPress={() => void enable()} busy={busy} />
                : null}
            {!loading && !unsupported && permissionDenied
              ? <Pressable accessibilityRole="button" onPress={() => { void Linking.openSettings() }} style={styles.settingsButton}>
                  <ThemedText type="smallBold">Open device settings</ThemedText>
                </Pressable>
              : null}
          </Card>
          <ThemedText type="small" themeColor="textSecondary">You can change this choice at any time. Notification previews never include addresses, phone numbers, or payment details.</ThemedText>
        </ThemedView>
      </SafeAreaView>
    </ThemedView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row' },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    paddingBottom: BottomTabInset + Spacing.three,
    maxWidth: MaxContentWidth,
  },
  content: { width: '100%', flex: 1, justifyContent: 'center', gap: Spacing.three },
  eyebrow: { letterSpacing: 2 },
  title: { fontSize: 38, lineHeight: 44 },
  settingsButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
})
