import { useCallback, useRef, useState } from 'react'
import { Link, useFocusEffect } from 'expo-router'

import { ActionButton, Card, Message, SectionTitle } from '@/components/marketplace-ui'
import { ThemedText } from '@/components/themed-text'
import { getAccountDeletionRequest, requestAccountDeletion, type AccountDeletionStatus } from '@/lib/account-lifecycle'

export default function AccountDeletionCard() {
  const [status, setStatus] = useState<AccountDeletionStatus | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const current = useRef(0)
  const focused = useRef(false)
  const submitting = useRef(false)

  const refresh = useCallback(async () => {
    if (submitting.current) return
    const generation = ++current.current
    setLoading(true)
    setError('')
    try {
      const result = await getAccountDeletionRequest()
      if (focused.current && generation === current.current) {
        setStatus(result)
        if (result.request) setConfirming(false)
      }
    } catch (cause) {
      if (focused.current && generation === current.current) setError(cause instanceof Error ? cause.message : 'Could not load your request. Refresh to retry.')
    } finally {
      if (focused.current && generation === current.current) setLoading(false)
    }
  }, [])

  useFocusEffect(useCallback(() => {
    focused.current = true
    void refresh()
    return () => { focused.current = false; current.current++; setConfirming(false) }
  }, [refresh]))

  const submit = async () => {
    if (!focused.current || !confirming || !status || status.request || submitting.current || loading) return
    submitting.current = true
    const generation = ++current.current
    setSaving(true)
    setError('')
    try {
      const result = await requestAccountDeletion()
      if (focused.current && generation === current.current) { setStatus(result); setConfirming(false) }
    } catch (cause) {
      if (focused.current && generation === current.current) setError(cause instanceof Error ? cause.message : 'Could not save your request. Try again or refresh its status.')
    } finally {
      submitting.current = false
      setSaving(false)
      if (focused.current && generation !== current.current) void refresh()
    }
  }

  return <Card>
    <SectionTitle title={status?.request ? 'Deletion request received' : 'Request account deletion'} />
    <ThemedText>Submitting a deletion request immediately stops new client bookings and driver assignments across both of your profiles.</ThemedText>
    <ThemedText>Existing trips and payments remain accessible, including payment resolution and withdrawal of pending requests. You can still sign out.</ThemedText>
    {status?.request ? <>
      <ThemedText>Your request has been received. Your account data has not been erased. Fave must review retained records and existing obligations before fulfilling deletion.</ThemedText>
      <ThemedText selectable>Request reference: {status.request.id}</ThemedText>
      <ThemedText>Received {new Date(status.request.requestedAt).toLocaleString()}</ThemedText>
    </> : status && !loading ? confirming ? <>
      <Message>Confirm this request for your whole Fave account. New bookings and driver assignments stop immediately; this screen cannot reactivate your account.</Message>
      <ActionButton title="Confirm deletion request" onPress={() => void submit()} busy={saving} />
      <ActionButton title="Cancel" disabled={saving} onPress={() => setConfirming(false)} />
    </> : <ActionButton title="Request account deletion" onPress={() => setConfirming(true)} /> : null}
    {loading ? <ThemedText>Loading request status…</ThemedText> : null}
    {error ? <Message error>{error}</Message> : null}
    <ActionButton title="Refresh request status" busy={loading} disabled={saving} onPress={() => void refresh()} />
    <Link href="/trips"><ThemedText type="link">Open existing Trips</ThemedText></Link>
    <ThemedText>For a readable data export or a question about retained records, email Fave with your account or booking reference. Support email is not continuously monitored.</ThemedText>
    <Link href="mailto:farid@fidexa.org"><ThemedText type="link">Request data export: farid@fidexa.org</ThemedText></Link>
  </Card>
}
