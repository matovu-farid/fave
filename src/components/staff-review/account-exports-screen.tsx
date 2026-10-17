import { useCallback, useRef, useState } from 'react'
import { Link, type Href, useFocusEffect, useLocalSearchParams } from 'expo-router'

import { ActionButton, Card, Message } from '@/components/marketplace-ui'
import { ThemedText } from '@/components/themed-text'
import { authClient } from '@/lib/auth-client'
import { getAccountExportPage, type ExportQueueItem } from '@/lib/account-exports'
import ReviewFrame from './review-frame'
import SecurityPanel, { useReviewSecurity } from './security-panel'
import AccountExportDetailView from './account-export-detail'

export default function AccountExportsScreen() {
  const { data: session } = authClient.useSession()
  const accountId = session?.user.id ?? ''
  const [queueAccount, setQueueAccount] = useState(accountId)
  const { id } = useLocalSearchParams<{ id?: string }>()
  const selected = typeof id === 'string' ? id : ''
  const access = useReviewSecurity()
  const [items, setItems] = useState<ExportQueueItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [pageLoading, setPageLoading] = useState(false)
  const pageAction = useRef<symbol | null>(null)
  const current = useRef(0)
  const focused = useRef(false)
  const refresh = useCallback(async () => {
    if (!focused.current) return
    const generation = ++current.current
    pageAction.current = null
    setPageLoading(false)
    setLoading(true)
    setError('')
    try {
      const result = await getAccountExportPage()
      if (generation === current.current) { setQueueAccount(accountId); setItems(result.requests); setNextCursor(result.nextCursor ?? null) }
    }
    catch (cause) { if (generation === current.current) { setItems([]); setNextCursor(null); setError(cause instanceof Error ? cause.message : 'Export follow-up is unavailable. Try again.') } }
    finally { if (generation === current.current) setLoading(false) }
  }, [accountId])
  const loadMore = async () => {
    if (!focused.current || !nextCursor || loading || pageAction.current) return
    const generation = current.current
    const token = Symbol()
    pageAction.current = token
    setPageLoading(true)
    setError('')
    try {
      const result = await getAccountExportPage(nextCursor)
      if (generation === current.current && pageAction.current === token) {
        setItems(existing => {
          const seen = new Set(existing.map(item => item.id))
          return [...existing, ...result.requests.filter(item => {
            if (seen.has(item.id)) return false
            seen.add(item.id)
            return true
          })]
        })
        setNextCursor(result.nextCursor ?? null)
      }
    } catch (cause) {
      if (generation === current.current && pageAction.current === token) setError(cause instanceof Error ? cause.message : 'Could not load more requests. Try again.')
    } finally {
      if (generation === current.current && pageAction.current === token) { pageAction.current = null; setPageLoading(false) }
    }
  }
  useFocusEffect(useCallback(() => {
    focused.current = true
    if (!selected) void refresh()
    return () => { focused.current = false; current.current++; pageAction.current = null; setItems([]); setNextCursor(null); setPageLoading(false) }
  }, [selected, refresh]))
  return <ReviewFrame title="Account export follow-up">
    <SecurityPanel state={access} />
    {selected ? <AccountExportDetailView key={selected} id={selected} access={access} /> : <>
      <ThemedText>Owner review only. Oldest received requests first. Opening requester contact details requires fresh staff verification and is audited.</ThemedText>
      <ThemedText>Review exceptional missing or mixed-person records and provide a written response. Ordinary downloads do not need owner approval.</ThemedText>
      <ActionButton title="Refresh export follow-up" busy={loading} disabled={pageLoading} onPress={() => void refresh()} />
      {error ? <Message error>{error}</Message> : null}
      {!loading && !error && items.length === 0 ? <Message>No export exceptions are waiting for follow-up.</Message> : null}
      {(queueAccount === accountId ? items : []).map(item => <Card key={item.id}>
        <ThemedText selectable>Request reference: {item.id}</ThemedText>
        <ThemedText>Received {new Date(item.requestedAt).toLocaleString()}</ThemedText>
        <ThemedText>Status: {item.status} · {item.needsFollowUp ? 'Follow-up needed' : 'No current exception'}</ThemedText>
        <Link href={`/admin/account-exports?id=${encodeURIComponent(item.id)}` as Href}><ThemedText type="link">Review request {item.id}</ThemedText></Link>
      </Card>)}
      {nextCursor ? <ActionButton title="Load more export follow-up" busy={pageLoading} disabled={loading} onPress={() => void loadMore()} /> : null}
    </>}
  </ReviewFrame>
}
