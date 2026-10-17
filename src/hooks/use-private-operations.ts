import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AppState, Platform } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { authClient } from '@/lib/auth-client'
import { ApiError } from '@/lib/api'
import { getOperationsDetail, getOperationsPage, type OperationsKind } from '@/lib/driver-operations'
import { lockReviews } from '@/lib/staff-review'
import type { ReviewSecurityState } from '@/components/staff-review/security-panel'

type Draft = { reason: string; message: string; note: string; action: string }
const emptyDraft = (): Draft => ({ reason: '', message: '', note: '', action: '' })
type State<Row, Detail> = { key: string; items: Row[]; nextCursor: string | null; detail: Detail | null; draft: Draft; busy: boolean; error: string; message: string }
function empty<Row, Detail>(key: string): State<Row, Detail> { return { key, items: [], nextCursor: null, detail: null, draft: emptyDraft(), busy: false, error: '', message: '' } }

// No private result or draft survives a different session, proof window or screen.
export function usePrivateOperations<Row extends { id: string }, Detail>(kind: OperationsKind, status: string, id: string, access: ReviewSecurityState) {
  const session = authClient.useSession().data
  const key = JSON.stringify([session?.user.id, session?.session.id, kind, status, id, access.unlocked, access.security?.expiresAt])
  const [state, setState] = useState<State<Row, Detail>>(() => empty(key))
  const context = useRef(key), generation = useRef(0), focused = useRef(false), active = useRef(true), mutex = useRef<symbol | null>(null)
  const clear = useCallback(() => { generation.current++; mutex.current = null; setState(empty(context.current)) }, [])
  useLayoutEffect(() => { context.current = key; clear() }, [key, clear])
  const clearAccess = access.clear
  const live = () => context.current === key && focused.current && active.current && !(Platform.OS === 'web' && document.hidden)
  const privateLive = () => live() && access.unlocked && !!access.security?.expiresAt && access.security.expiresAt > Date.now()
  const allowed = (g: number) => g === generation.current && live()
  const fail = async (cause: unknown, g: number) => {
    if (!allowed(g)) return
    setState({ ...empty<Row, Detail>(key), error: cause instanceof Error ? cause.message : 'Could not complete this request. Refresh and try again.' })
    if (cause instanceof ApiError && [401, 403, 428].includes(cause.status)) { access.clear(); await access.refresh() }
  }
  const page = async (cursor?: string) => {
    if (!live() || mutex.current) return
    const g = ++generation.current, token = Symbol(); mutex.current = token
    setState(s => ({ ...(s.key === key ? s : empty<Row, Detail>(key)), busy: true, error: '', detail: null, draft: emptyDraft() }))
    try {
      const result = await getOperationsPage<Row>(kind, status, cursor)
      if (allowed(g)) setState(s => ({ ...s, items: cursor ? [...s.items, ...result.items.filter(row => !s.items.some(old => old.id === row.id))] : result.items, nextCursor: result.nextCursor, busy: false }))
    } catch (cause) { await fail(cause, g) }
    finally { if (mutex.current === token) { mutex.current = null; if (allowed(g)) setState(s => ({ ...s, busy: false })) } }
  }
  const open = async () => {
    if (!privateLive() || mutex.current || !id) return
    const g = ++generation.current, token = Symbol(); mutex.current = token
    setState({ ...empty<Row, Detail>(key), busy: true })
    try { const detail = await getOperationsDetail<Detail>(kind, id); if (allowed(g) && privateLive()) setState({ ...empty<Row, Detail>(key), detail }) }
    catch (cause) { await fail(cause, g) }
    finally { if (mutex.current === token) { mutex.current = null; if (allowed(g)) setState(s => ({ ...s, busy: false })) } }
  }
  const submit = async (action: (detail: Detail) => Promise<unknown>) => {
    if (!privateLive() || mutex.current || state.key !== key || !state.detail) return
    const g = ++generation.current, token = Symbol(); mutex.current = token
    setState(s => ({ ...s, busy: true, error: '', message: '' }))
    try {
      await action(state.detail)
      if (!allowed(g) || !privateLive()) return
      // A completed write is never replayed. Obtain current server truth separately.
      setState({ ...empty<Row, Detail>(key), busy: true })
      const detail = await getOperationsDetail<Detail>(kind, id)
      if (allowed(g) && privateLive()) setState({ ...empty<Row, Detail>(key), detail, message: 'Decision saved. Current record refreshed.' })
    } catch (cause) { await fail(cause, g) }
    finally { if (mutex.current === token) { mutex.current = null; if (allowed(g)) setState(s => ({ ...s, busy: false })) } }
  }
  useFocusEffect(useCallback(() => {
    focused.current = true; clear()
    if (!id) void page()
    return () => { focused.current = false; clear() }
    // page deliberately belongs to this exact screen/session/proof context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, clear]))
  useEffect(() => {
    const background = () => { active.current = false; clear(); clearAccess(); void lockReviews().catch(() => undefined) }
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') background(); else active.current = true })
    const visibility = () => { if (document.hidden) background(); else active.current = true }
    if (Platform.OS === 'web') document.addEventListener('visibilitychange', visibility)
    return () => { subscription.remove(); if (Platform.OS === 'web') document.removeEventListener('visibilitychange', visibility) }
  }, [clear, clearAccess])
  const visible = state.key === key ? state : empty<Row, Detail>(key)
  return { ...visible, open, refresh: () => id ? open() : page(), loadMore: () => state.nextCursor ? page(state.nextCursor) : Promise.resolve(), submit,
    setField: (field: keyof Draft, value: string) => { if (privateLive() && !mutex.current) setState(s => ({ ...s, draft: { ...s.draft, [field]: value } })) } }
}
