import { useCallback, useRef, useState } from 'react'
import { Link, type Href, useFocusEffect, useLocalSearchParams } from 'expo-router'

import { ActionButton, Card, Message } from '@/components/marketplace-ui'
import { ThemedText } from '@/components/themed-text'
import { getAccountRequestPage, type AccountDeletionRequest } from '@/lib/account-lifecycle'
import ReviewFrame from './review-frame'
import SecurityPanel, { useReviewSecurity } from './security-panel'
import AccountRequestDetailView from './account-request-detail'

export default function AccountRequestsScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>()
  const selected = typeof id === 'string' ? id : ''
  const access = useReviewSecurity()
  const [items, setItems] = useState<AccountDeletionRequest[]>([])
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
      const result = await getAccountRequestPage()
      if (generation === current.current) { setItems(result.requests); setNextCursor(result.nextCursor ?? null) }
    }
    catch (cause) { if (generation === current.current) { setItems([]); setNextCursor(null); setError(cause instanceof Error ? cause.message : 'Account requests are unavailable. Try again.') } }
    finally { if (generation === current.current) setLoading(false) }
  }, [])
  const loadMore = async () => {
    if (!focused.current || !nextCursor || loading || pageAction.current) return
    const generation = current.current
    const token = Symbol()
    pageAction.current = token
    setPageLoading(true)
    setError('')
    try {
      const result = await getAccountRequestPage(nextCursor)
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
  return <ReviewFrame title="Account deletion requests">
    <SecurityPanel state={access} />
    {selected ? <AccountRequestDetailView key={selected} id={selected} access={access} /> : <>
      <ThemedText>Owner review only. Oldest received requests first. Opening requester contact details requires fresh staff verification and is audited.</ThemedText>
      <ThemedText>A received request is awaiting review. This console does not erase records or mark deletion as fulfilled.</ThemedText>
      <ActionButton title="Refresh account requests" busy={loading} disabled={pageLoading} onPress={() => void refresh()} />
      {error ? <Message error>{error}</Message> : null}
      {!loading && !error && items.length === 0 ? <Message>No account deletion requests are waiting for review.</Message> : null}
      {items.map(item => <Card key={item.id}>
        <ThemedText selectable>Request reference: {item.id}</ThemedText>
        <ThemedText>Received {new Date(item.requestedAt).toLocaleString()}</ThemedText>
        <Link href={{ pathname: '/admin/account-requests', params: { id: item.id } } as Href}><ThemedText type="link">Review request {item.id}</ThemedText></Link>
      </Card>)}
      {nextCursor ? <ActionButton title="Load more account requests" busy={pageLoading} disabled={loading} onPress={() => void loadMore()} /> : null}
    </>}
  </ReviewFrame>
}
