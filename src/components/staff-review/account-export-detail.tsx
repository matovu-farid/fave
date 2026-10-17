import { useCallback, useEffect, useRef, useState } from 'react'
import { Platform } from 'react-native'
import { Link, type Href, useFocusEffect } from 'expo-router'
import { ActionButton, Card, Field, Message, SectionTitle } from '@/components/marketplace-ui'
import { ThemedText } from '@/components/themed-text'
import { authClient } from '@/lib/auth-client'
import { ApiError } from '@/lib/api'
import { getAccountExportDetail, saveAccountExportResponse, type OwnerExportDetail } from '@/lib/account-exports'
import type { ReviewSecurityState } from './security-panel'

export default function AccountExportDetailView({ id, access }: { id: string; access: ReviewSecurityState }) {
  const { data: session } = authClient.useSession()
  const accountId = session?.user.id ?? ''
  const [disclosedTo, setDisclosedTo] = useState('')
  const [detail, setDetail] = useState<OwnerExportDetail | null>(null)
  const [message, setMessage] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const current = useRef(0)
  const focused = useRef(false)
  const running = useRef(false)
  const live = useRef({ id, access, accountId })
  useEffect(() => { live.current = { id, access, accountId } }, [id, access, accountId])
  const clear = useCallback(() => { current.current++; running.current = false; setDetail(null); setMessage(''); setNotice(''); setBusy(false); setError('') }, [])
  const authorized = () => focused.current && live.current.id === id && live.current.accountId === accountId && live.current.access.unlocked && !!live.current.access.security?.expiresAt && live.current.access.security.expiresAt > Date.now() && !(Platform.OS === 'web' && document.hidden)
  useFocusEffect(useCallback(() => { focused.current = true; return () => { focused.current = false; clear() } }, [clear]))
  useEffect(() => { return clear }, [id, accountId, access.unlocked, clear])
  useEffect(() => {
    if (!access.security?.expiresAt) return
    const timer = setTimeout(clear, Math.max(0, access.security.expiresAt - Date.now()))
    return () => clearTimeout(timer)
  }, [access.security?.expiresAt, clear])
  useEffect(() => {
    if (Platform.OS !== 'web') return
    const hide = () => { if (document.hidden) clear() }
    document.addEventListener('visibilitychange', hide)
    return () => document.removeEventListener('visibilitychange', hide)
  }, [clear])
  const failed = async (cause: unknown, generation: number) => {
    if (generation !== current.current || !authorized()) return
    if (cause instanceof ApiError && [401, 403, 428].includes(cause.status)) { clear(); await access.refresh() }
    else setError(cause instanceof Error ? cause.message : 'Could not update this follow-up. Try again.')
  }
  const reveal = async () => {
    if (!authorized() || running.current) return
    const generation = ++current.current; running.current = true
    setDetail(null); setMessage(''); setNotice(''); setBusy(true); setError('')
    try { const result = await getAccountExportDetail(id); if (generation === current.current && authorized()) { setDisclosedTo(accountId); setDetail(result.request) } }
    catch (cause) { await failed(cause, generation) }
    finally { if (generation === current.current) { running.current = false; setBusy(false) } }
  }
  const save = async () => {
    if (!authorized() || !detail || !message.trim() || running.current) return
    const generation = ++current.current; running.current = true
    setBusy(true); setNotice(''); setError('')
    try {
      await saveAccountExportResponse(id, message.trim())
      if (generation !== current.current || !authorized()) return
      setMessage(''); setNotice('Response saved. Remaining access decisions stay open.')
      const result = await getAccountExportDetail(id)
      if (generation === current.current && authorized()) { setDisclosedTo(accountId); setDetail(result.request) }
    } catch (cause) { await failed(cause, generation) }
    finally { if (generation === current.current) { running.current = false; setBusy(false) } }
  }
  if (!access.unlocked) return <Message>Unlock reviews to open export follow-up details. Only an owner reviewer can access these requests.</Message>
  return <>
    <Link href={'/admin/account-exports' as Href}><ThemedText type="link">Back to export follow-up</ThemedText></Link>
    <SectionTitle title="Export follow-up" detail="Opening requester details and saving responses are audited. Safe automatic downloads remain available while exceptional information is assessed." />
    <ThemedText selectable>Request reference: {id}</ThemedText>
    {error ? <Message error>{error}</Message> : null}
    {detail && disclosedTo === accountId ? <Card>
      <ThemedText>Received {new Date(detail.requestedAt).toLocaleString()}</ThemedText>
      <ThemedText>Name: {detail.name ?? 'Not provided'}</ThemedText>
      <ThemedText selectable>Email: {detail.email}</ThemedText>
      <ThemedText selectable>Account reference: {detail.userId}</ThemedText>
      {detail.exceptions.map(item => <ThemedText key={`${item.category}-${item.code}`}>{item.category.replaceAll('_', ' ')}: {item.code.replaceAll('_', ' ')} ({item.count})</ThemedText>)}
      {detail.responses.map(response => <ThemedText key={response.id} selectable>{new Date(response.createdAt).toLocaleString()}: {response.message}</ThemedText>)}
      <Message>Record a specific written explanation or next action. A saved response does not close outstanding access decisions, prove receipt or erase records. Include the support or complaint route when appropriate.</Message>
      <Field label="Written follow-up response" value={message} onChangeText={setMessage} multiline editable={!busy} />
      <ActionButton title="Save written response" busy={busy} disabled={!message.trim() || message.length > 4000} onPress={() => void save()} />
      {notice ? <Message>{notice}</Message> : null}
      <ActionButton title="Hide export follow-up" onPress={clear} />
    </Card> : <ActionButton title="Open export follow-up" busy={busy} onPress={() => void reveal()} />}
  </>
}
