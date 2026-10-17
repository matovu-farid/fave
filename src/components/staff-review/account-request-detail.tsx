import { useCallback, useEffect, useRef, useState } from 'react'
import { Platform } from 'react-native'
import { Link, type Href, useFocusEffect } from 'expo-router'

import { ActionButton, Card, Message, SectionTitle } from '@/components/marketplace-ui'
import { ThemedText } from '@/components/themed-text'
import { ApiError } from '@/lib/api'
import { getAccountRequestDetail, type AccountRequestDetail } from '@/lib/account-lifecycle'
import type { ReviewSecurityState } from './security-panel'

export default function AccountRequestDetailView({ id, access }: { id: string; access: ReviewSecurityState }) {
  const [detail, setDetail] = useState<AccountRequestDetail | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const current = useRef(0)
  const focused = useRef(false)
  const running = useRef(false)
  const clear = useCallback(() => { current.current++; running.current = false; setDetail(null); setBusy(false); setError('') }, [])
  useFocusEffect(useCallback(() => { focused.current = true; return () => { focused.current = false; clear() } }, [clear]))
  useEffect(() => clear, [access.unlocked, clear])
  useEffect(() => {
    if (Platform.OS !== 'web') return
    const hide = () => { if (document.hidden) clear() }
    document.addEventListener('visibilitychange', hide)
    return () => document.removeEventListener('visibilitychange', hide)
  }, [clear])

  const reveal = async () => {
    if (!focused.current || !access.unlocked || running.current || !access.security?.expiresAt || access.security.expiresAt <= Date.now() || (Platform.OS === 'web' && document.hidden)) return
    const generation = ++current.current
    running.current = true
    setDetail(null)
    setBusy(true)
    setError('')
    try {
      const result = await getAccountRequestDetail(id)
      if (focused.current && generation === current.current && access.security.expiresAt > Date.now() && !(Platform.OS === 'web' && document.hidden)) setDetail(result.request)
    } catch (cause) {
      if (focused.current && generation === current.current) {
        setError(cause instanceof Error ? cause.message : 'Could not open this request. Try again.')
        if (cause instanceof ApiError && [401, 403, 428].includes(cause.status)) { clear(); await access.refresh() }
      }
    } finally {
      if (generation === current.current) { running.current = false; setBusy(false) }
    }
  }

  if (!access.unlocked) return <Message>Unlock reviews to open the requester’s contact details. Only an owner reviewer can access account requests.</Message>
  return <>
    <Link href={'/admin/account-requests' as Href}><ThemedText type="link">Back to account requests</ThemedText></Link>
    <SectionTitle title="Deletion request" detail="Opening contact details is recorded in the audit trail. This request has been received; deletion has not been fulfilled." />
    <ThemedText selectable>Request reference: {id}</ThemedText>
    {error ? <Message error>{error}</Message> : null}
    {detail ? <Card>
      <ThemedText type="smallBold">Request received {new Date(detail.requestedAt).toLocaleString()}</ThemedText>
      <ThemedText>Name: {detail.name ?? 'Not provided'}</ThemedText>
      <ThemedText selectable>Email: {detail.email}</ThemedText>
      <ThemedText selectable>Account reference: {detail.userId}</ThemedText>
      <Message>New bookings and driver assignments are restricted. Existing trips, payments and retained records remain available for resolution.</Message>
      <ActionButton title="Hide requester details" onPress={clear} />
    </Card> : <ActionButton title="Open requester details" busy={busy} onPress={() => void reveal()} />}
  </>
}
