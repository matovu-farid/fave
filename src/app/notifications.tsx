import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet } from 'react-native'
import { router } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'

import { ActionButton, Card, Message, SectionTitle } from '@/components/marketplace-ui'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme'
import { getNotificationInbox, markAllNotificationsRead, markNotificationRead, type NotificationInboxItem } from '@/lib/marketplace'
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
  const [inbox, setInbox] = useState<NotificationInboxItem[]>([])
  const [inboxUnreadCount, setInboxUnreadCount] = useState(0)
  const [inboxLoading, setInboxLoading] = useState(true)
  const [inboxBusy, setInboxBusy] = useState(false)
  const [inboxError, setInboxError] = useState('')
  const [inboxNextCursor, setInboxNextCursor] = useState<{ createdAt: number; id: string } | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

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

  const loadInbox = useCallback(async () => {
    setInboxError('')
    setInboxLoading(true)
    try {
      const page = await getNotificationInbox()
      setInbox(page.notifications)
      setInboxUnreadCount(page.unreadCount)
      setInboxNextCursor(page.nextCursor)
    } catch (cause) {
      setInboxError(cause instanceof Error ? cause.message : 'Your inbox is temporarily unavailable.')
    } finally {
      setInboxLoading(false)
    }
  }, [])

  const loadMore = async () => {
    if (!inboxNextCursor || loadingMore) return
    setLoadingMore(true)
    setInboxError('')
    try {
      const page = await getNotificationInbox(inboxNextCursor)
      setInbox(items => [...items, ...page.notifications.filter(item => !items.some(existing => existing.id === item.id))])
      setInboxNextCursor(page.nextCursor)
    } catch (cause) {
      setInboxError(cause instanceof Error ? cause.message : 'More notifications are temporarily unavailable.')
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => { void loadInbox() }, 0)
    return () => clearTimeout(timer)
  }, [loadInbox])

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

  const openNotification = async (item: NotificationInboxItem) => {
    if (!item.isRead) {
      try {
        const result = await markNotificationRead(item.id)
        setInbox(items => items.map(current => current.id === item.id ? { ...current, isRead: true, readAt: result.readAt } : current))
        setInboxUnreadCount(count => Math.max(0, count - 1))
      } catch (cause) {
        setInboxError(cause instanceof Error ? cause.message : 'Could not update this notification.')
        return
      }
    }
    const destination = {
      trips: '/trips', driver_offers: '/driver', booking: '/trips', trip: '/trips',
      payments: '/trips', safety: '/trips', support: '/trips',
    }[item.routeKey]
    router.push(destination as '/trips' | '/driver')
  }

  const readAll = async () => {
    setInboxBusy(true)
    setInboxError('')
    try {
      const result = await markAllNotificationsRead()
      setInbox(items => items.map(item => ({ ...item, isRead: true, readAt: item.readAt ?? result.readAt })))
      setInboxUnreadCount(0)
    } catch (cause) {
      setInboxError(cause instanceof Error ? cause.message : 'Could not mark notifications as read.')
    } finally {
      setInboxBusy(false)
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
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
          <ThemedView style={styles.inboxHeading}>
            <ThemedText type="subtitle">Your inbox{inboxUnreadCount > 0 ? ` · ${inboxUnreadCount} unread` : ''}</ThemedText>
            {inboxUnreadCount > 0
              ? <Pressable accessibilityRole="button" disabled={inboxBusy} onPress={() => void readAll()} style={styles.readAllButton}>
                  <ThemedText type="smallBold">{inboxBusy ? 'Updating…' : 'Mark all read'}</ThemedText>
                </Pressable>
              : null}
          </ThemedView>
          {inboxError ? <Message error>{inboxError}</Message> : null}
          {inboxLoading ? <ActivityIndicator accessibilityLabel="Loading notification inbox" /> : null}
          {!inboxLoading && inboxError
            ? <ActionButton title="Try again" onPress={() => void loadInbox()} />
            : null}
          {!inboxLoading && !inboxError && inbox.length === 0
            ? <Card><Message>You’re all caught up. New booking and trip updates will appear here.</Message></Card>
            : null}
          {!inboxLoading && !inboxError
            ? inbox.map(item => (
                <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.title}. ${item.body}`} onPress={() => void openNotification(item)}>
                  <Card>
                    <ThemedView style={styles.notificationTitleRow}>
                      <ThemedText type="smallBold" style={styles.notificationTitle}>{item.title}</ThemedText>
                      {!item.isRead ? <ThemedView accessibilityLabel="Unread" style={styles.unreadDot} /> : null}
                    </ThemedView>
                    <Message>{item.body}</Message>
                    <ThemedText type="small" themeColor="textSecondary">{new Date(item.createdAt).toLocaleString()}</ThemedText>
                  </Card>
                </Pressable>
              ))
            : null}
          {!inboxLoading && !inboxError && inboxNextCursor
            ? <ActionButton title={loadingMore ? 'Loading…' : 'Load older notifications'} onPress={() => void loadMore()} busy={loadingMore} />
            : null}
          <ThemedText type="small" themeColor="textSecondary">You can change this choice at any time. Notification previews never include addresses, phone numbers, or payment details.</ThemedText>
        </ScrollView>
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
  content: { width: '100%', flexGrow: 1, gap: Spacing.three, paddingVertical: Spacing.three },
  inboxHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  readAllButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.two },
  notificationTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  notificationTitle: { flex: 1 },
  unreadDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#2A6B4F', marginLeft: Spacing.two },
  eyebrow: { letterSpacing: 2 },
  title: { fontSize: 38, lineHeight: 44 },
  settingsButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
})
