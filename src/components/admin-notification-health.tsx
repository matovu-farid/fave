import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'

import { ActionButton, Card, Message, SectionTitle } from '@/components/marketplace-ui'
import { ThemedText } from '@/components/themed-text'
import {
  AdminNotificationHealth as AdminNotificationHealthData,
  getAdminNotificationHealth,
  retryAdminNotificationDelivery,
} from '@/lib/marketplace'

function pendingAgeLabel(ageMs: number | null) {
  if (ageMs === null) return 'No pending deliveries'
  const minutes = Math.floor(ageMs / 60_000)
  if (minutes < 1) return 'Oldest pending: less than a minute'
  if (minutes < 60) return `Oldest pending: ${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `Oldest pending: ${hours} hr ${remainingMinutes} min`
}

export function AdminNotificationHealth() {
  const [health, setHealth] = useState<AdminNotificationHealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyDeliveryId, setBusyDeliveryId] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const refresh = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true)
    setError('')
    try {
      setHealth(await getAdminNotificationHealth())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Notification delivery health is unavailable.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const initialLoadTimer = setTimeout(() => { void refresh(true) }, 0)
    const refreshTimer = setInterval(() => { void refresh() }, 30_000)
    return () => {
      clearTimeout(initialLoadTimer)
      clearInterval(refreshTimer)
    }
  }, [refresh])

  const retry = async (deliveryId: string) => {
    setBusyDeliveryId(deliveryId)
    setError('')
    setMessage('')
    try {
      const result = await retryAdminNotificationDelivery(deliveryId)
      setMessage(result.result === 'queued'
        ? 'Delivery queued for a safe retry. The app will recheck expiry and push settings.'
        : `Delivery was ${result.result}; no push was sent.`)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The delivery could not be retried.')
    } finally {
      setBusyDeliveryId('')
    }
  }

  return (
    <View>
      <SectionTitle title="Notification delivery health" detail="Redacted delivery status for operations. No message or recipient details are shown." />
      {error ? <Message error>{error}</Message> : null}
      {message ? <Message>{message}</Message> : null}
      {loading && !health ? <ActivityIndicator accessibilityLabel="Loading notification delivery health" /> : null}
      {health ? (
        <>
          <Card>
            <ThemedText type="smallBold">Delivery status</ThemedText>
            {health.statuses.length === 0 ? <ThemedText themeColor="textSecondary">No deliveries yet.</ThemedText> : null}
            {health.statuses.map(({ status, count }) => (
              <ThemedText key={status}>{status.replaceAll('_', ' ')} · {count}</ThemedText>
            ))}
            <ThemedText themeColor="textSecondary">{pendingAgeLabel(health.oldestPendingAgeMs)}</ThemedText>
          </Card>
          <ThemedText type="subtitle">Failed deliveries</ThemedText>
          {health.failures.length === 0 ? (
            <Card><ThemedText>No failed deliveries need attention.</ThemedText></Card>
          ) : health.failures.map((failure) => (
            <Card key={failure.deliveryId}>
              <ThemedText type="smallBold">{failure.eventType.replaceAll('.', ' ')}</ThemedText>
              <ThemedText themeColor="textSecondary">
                {failure.status.replaceAll('_', ' ')} · {failure.attemptCount} attempt{failure.attemptCount === 1 ? '' : 's'}
              </ThemedText>
              <ThemedText themeColor="textSecondary">Reason: {failure.errorCategory ?? 'unknown'}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Ref {failure.deliveryRef} · {new Date(failure.createdAt).toLocaleString()}
              </ThemedText>
              <ActionButton
                title="Retry delivery"
                busy={busyDeliveryId === failure.deliveryId}
                disabled={Boolean(busyDeliveryId)}
                onPress={() => void retry(failure.deliveryId)}
              />
            </Card>
          ))}
        </>
      ) : null}
    </View>
  )
}
