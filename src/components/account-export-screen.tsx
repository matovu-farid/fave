import { useCallback, useEffect, useRef, useState } from 'react'
import { Platform, ScrollView, StyleSheet } from 'react-native'
import { Link, type Href, useFocusEffect } from 'expo-router'
import * as Linking from 'expo-linking'
import { ActionButton, Card, Message, SectionTitle } from '@/components/marketplace-ui'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme'
import { authClient } from '@/lib/auth-client'
import { acknowledgeAccountExport, getAccountExport, getAccountExports, getArchiveUrl, getExportWebUrl, requestAccountExport, type AccountExportDetail, type AccountExportReceipt, type ExportAuthorization } from '@/lib/account-exports'

function newRequestKey() { return `export-${Date.now()}-${Math.random().toString(36).slice(2)}` }
function signInStillFresh(until: number | null) { return !!until && until > Date.now() }

export default function AccountExportScreen() {
  const { data: session } = authClient.useSession()
  const accountId = session?.user.id ?? ''
  const identity = useRef(accountId)
  const [loadedFor, setLoadedFor] = useState(accountId)
  const [items, setItems] = useState<AccountExportReceipt[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [authorization, setAuthorization] = useState<ExportAuthorization | null>(null)
  const [detail, setDetail] = useState<AccountExportDetail | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const current = useRef(0)
  const focused = useRef(false)
  const action = useRef<symbol | null>(null)
  const requestKey = useRef('')
  useEffect(() => { identity.current = accountId; requestKey.current = '' }, [accountId])
  const valid = (generation: number) => focused.current && current.current === generation && identity.current === accountId
  const clear = useCallback(() => {
    current.current++; action.current = null
    setLoadedFor(accountId); setItems([]); setNextCursor(null); setAuthorization(null); setDetail(null); setConfirming(false); setBusy(false); setError('')
  }, [accountId])
  const refresh = useCallback(async (after?: string) => {
    if (!focused.current || action.current || Platform.OS !== 'web') return
    const generation = ++current.current
    setLoading(true); setError(''); setDetail(null)
    try {
      const result = await getAccountExports(after)
      if (!focused.current || generation !== current.current || identity.current !== accountId) return
      setItems(result.requests); setNextCursor(result.nextCursor ?? null); setAuthorization(result)
      if (result.requests[0]) {
        const ownDetail = await getAccountExport(result.requests[0].id)
        if (focused.current && generation === current.current && identity.current === accountId) { setDetail(ownDetail); setAuthorization(ownDetail) }
      }
    } catch (cause) {
      if (focused.current && generation === current.current && identity.current === accountId) setError(cause instanceof Error ? cause.message : 'Could not load downloads. Refresh to retry.')
    } finally { if (focused.current && generation === current.current && identity.current === accountId) setLoading(false) }
  }, [accountId])
  useFocusEffect(useCallback(() => {
    focused.current = true; clear(); void refresh()
    return () => { focused.current = false; clear() }
  }, [clear, refresh]))
  useEffect(() => {
    if (!authorization?.freshUntil) return
    const timer = setTimeout(() => setAuthorization(value => value ? { ...value, canDownload: false } : null), Math.max(0, authorization.freshUntil - Date.now()))
    return () => clearTimeout(timer)
  }, [authorization?.freshUntil])
  const canDownload = !!authorization?.canDownload && !!authorization.freshUntil
  const submit = async () => {
    if (!focused.current || identity.current !== accountId || !confirming || !canDownload || !signInStillFresh(authorization?.freshUntil ?? null) || action.current) return
    const token = Symbol(); action.current = token
    const generation = ++current.current
    if (!requestKey.current) requestKey.current = newRequestKey()
    setBusy(true); setError('')
    try {
      const result = await requestAccountExport(requestKey.current)
      if (valid(generation)) {
        setItems(existing => [result.request, ...existing.filter(item => item.id !== result.request.id)])
        setAuthorization(result); setDetail(result); setConfirming(false); requestKey.current = ''
      }
    } catch (cause) { if (valid(generation)) setError(cause instanceof Error ? cause.message : 'Could not save the download request. Try again.') }
    finally {
      if (valid(generation) && action.current === token) { action.current = null; setBusy(false) }
      else if (focused.current && identity.current === accountId && generation !== current.current && !action.current) void refresh()
    }
  }
  const select = async (id: string) => {
    if (!focused.current || identity.current !== accountId || action.current) return
    const generation = ++current.current
    setLoading(true); setError(''); setDetail(null)
    try { const result = await getAccountExport(id); if (valid(generation)) { setDetail(result); setAuthorization(result) } }
    catch (cause) { if (valid(generation)) setError(cause instanceof Error ? cause.message : 'Could not load this download. Refresh to retry.') }
    finally { if (valid(generation)) setLoading(false) }
  }
  const acknowledge = async () => {
    if (!focused.current || identity.current !== accountId || !detail || detail.request.status !== 'ready' || action.current) return
    const generation = ++current.current, token = Symbol(); action.current = token
    setBusy(true); setError('')
    try {
      const result = await acknowledgeAccountExport(detail.request.id)
      if (valid(generation)) { setDetail(previous => previous ? { ...previous, ...result } : result); setItems(previous => previous.map(item => item.id === result.request.id ? result.request : item)) }
    } catch (cause) { if (valid(generation)) setError(cause instanceof Error ? cause.message : 'Could not save your receipt report. Try again.') }
    finally {
      if (valid(generation) && action.current === token) { action.current = null; setBusy(false) }
      else if (focused.current && identity.current === accountId && generation !== current.current && !action.current) void refresh()
    }
  }
  const reauthenticate = async () => {
    if (!focused.current || identity.current !== accountId || action.current) return
    const generation = current.current, token = Symbol(); action.current = token; setBusy(true); setError('')
    try { const result = await authClient.signOut(); if (result.error) throw Error('Could not sign out. Please try again.') }
    catch { if (valid(generation)) setError('Could not sign out. Please try again.') }
    finally { if (valid(generation) && action.current === token) { action.current = null; setBusy(false) } }
  }
  const openWeb = async () => {
    try { await Linking.openURL(getExportWebUrl()) }
    catch { setError('Could not open the secure download page. Try again.') }
  }
  if (loadedFor !== accountId) return <Message>Loading your account downloads…</Message>
  const selected = detail?.request
  return <ThemedView style={styles.page}><ScrollView contentContainerStyle={styles.content}>
    <Link href="/account"><ThemedText type="link">Back to Account</ThemedText></Link>
    <SectionTitle title="Download my information" detail="Your account, both profiles and retained uploads in a private ZIP." />
    <Message>Contains private information, including your ID uploads; save it somewhere secure.</Message>
    {Platform.OS !== 'web' ? <>
      <ThemedText>Downloads open in your browser. Sign in there with the same Fave account to continue securely.</ThemedText>
      <ActionButton title="Open secure download page" onPress={() => void openWeb()} />
    </> : <>
      <ThemedText>A sign-in within the last ten minutes is required to request or download an archive. Downloading leaves your account and retained records in place.</ThemedText>
      {loading ? <ThemedText>Loading download status…</ThemedText> : null}
      {authorization && !canDownload ? <>
        <Message>Sign in again to download your private information. You will return to this page.</Message>
        <ActionButton title="Sign in again" busy={busy} onPress={() => void reauthenticate()} />
      </> : null}
      {canDownload && !loading ? confirming ? <Card>
        <ThemedText>Confirm that you want to prepare your information, including your own retained ID documents. Only download on a device you trust.</ThemedText>
        <ActionButton title="Confirm download request" busy={busy} onPress={() => void submit()} />
        <ActionButton title="Cancel" disabled={busy} onPress={() => setConfirming(false)} />
      </Card> : <ActionButton title={items.length ? 'Request updated information' : 'Download my information'} disabled={busy || items.some(item => item.status === 'streaming')} onPress={() => setConfirming(true)} /> : null}
      {selected ? <Card>
        <ThemedText selectable>Request reference: {selected.id}</ThemedText>
        <ThemedText>Received {new Date(selected.requestedAt).toLocaleString()}</ThemedText>
        <ThemedText>{selected.status === 'streaming' ? 'Preparing your archive… Refresh status to check progress.' : selected.status === 'failed' ? 'Archive preparation failed. Retry the download or contact support if it keeps failing.' : selected.status === 'ready' ? 'Archive prepared. You can download a current copy below.' : 'Request received. Download ZIP prepares your archive.'}</ThemedText>
        {selected.generatedAt ? <ThemedText>Last prepared {new Date(selected.generatedAt).toLocaleString()}</ThemedText> : null}
        {canDownload && selected.status !== 'streaming' ? <Link href={getArchiveUrl(selected.id) as Href} target="_blank" rel="noopener noreferrer"><ThemedText type="link">{selected.status === 'failed' ? 'Retry ZIP download' : 'Download ZIP'}</ThemedText></Link> : null}
        <ThemedText>The ZIP opens as a browser download. If it fails or your sign-in expires, return here, refresh status and sign in again. Starting a download does not confirm that you received it.</ThemedText>
        {selected.downloadedAt ? <Message>You reported receiving this download on {new Date(selected.downloadedAt).toLocaleString()}.</Message> : <ActionButton title="I received my download" disabled={busy || selected.status !== 'ready'} busy={busy} onPress={() => void acknowledge()} />}
        {selected.needsFollowUp ? <Message>Some information needs separate follow-up. Your automatic archive remains available. Receiving it does not close the remaining access request.</Message> : null}
        {detail.exceptions?.map(item => <ThemedText key={`${item.category}-${item.code}`}>{item.category.replaceAll('_', ' ')}: {item.code.replaceAll('_', ' ')} ({item.count})</ThemedText>)}
        {detail.responses?.map(response => <ThemedView key={response.id}><ThemedText type="smallBold">Fave follow-up · {new Date(response.createdAt).toLocaleString()}</ThemedText><ThemedText selectable>{response.message}</ThemedText></ThemedView>)}
      </Card> : null}
      <ActionButton title="Refresh download status" busy={loading} disabled={busy} onPress={() => void refresh()} />
      {items.filter(item => item.id !== selected?.id).map(item => <ActionButton key={item.id} title={`View download ${item.id}`} disabled={busy || loading} onPress={() => void select(item.id)} />)}
      {nextCursor ? <ActionButton title="View older download requests" disabled={busy || loading} onPress={() => void refresh(nextCursor)} /> : null}
      <ThemedText>For unresolved access, a written explanation or a complaint, contact Fave support with your request reference. You may also contact Uganda’s Personal Data Protection Office.</ThemedText>
      <Link href="mailto:farid@fidexa.org"><ThemedText type="link">Contact Fave: farid@fidexa.org</ThemedText></Link>
      <Link href="https://pdpo.go.ug/"><ThemedText type="link">Uganda Personal Data Protection Office</ThemedText></Link>
    </>}
    {error ? <Message error>{error}</Message> : null}
  </ScrollView></ThemedView>
}
const styles = StyleSheet.create({ page: { flex: 1 }, content: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', padding: Spacing.three, gap: Spacing.three, paddingBottom: BottomTabInset + Spacing.four } })
