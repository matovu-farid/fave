import { useCallback, useRef, useState } from 'react'
import { AppState, Platform } from 'react-native'
import { useFocusEffect } from 'expo-router'
import * as Linking from 'expo-linking'

import { authClient } from '@/lib/auth-client'
import { ApiError } from '@/lib/api'
import {
  type AdminAvailabilityRequest, type AdminDriverTripOffer, type DriverCallOutcome, type DriverContact,
  confirmAvailabilityRequest, getAdminAccess, getAdminAvailabilityRequests, getAdminTripOffers,
  getAvailabilityDriverContact, getDriverTripOfferContact, markAvailabilityUnavailable,
  recordAvailabilityCall, recordDriverTripOfferFollowUp,
} from '@/lib/marketplace'

type Lists = {
  pendingOffers: AdminDriverTripOffer[]; processingOffers: AdminDriverTripOffer[]; recentOffers: AdminDriverTripOffer[]
  availabilityRequests: AdminAvailabilityRequest[]; confirmedRequests: AdminAvailabilityRequest[]; recentRequests: AdminAvailabilityRequest[]
}
const emptyLists = (): Lists => ({ pendingOffers: [], processingOffers: [], recentOffers: [], availabilityRequests: [], confirmedRequests: [], recentRequests: [] })
const retain = <T,>(values: Record<string, T>, ids: Set<string>) => Object.fromEntries(Object.entries(values).filter(([id]) => ids.has(id)))
const accessDenied = (cause: unknown) => cause instanceof ApiError && (cause.status === 401 || cause.status === 403)

// The queue, revealed contacts and actions belong to one focused account/session.
// Clearing that context also invalidates reads and actions already in flight.
export function useBookingOperations() {
  const { data: session } = authClient.useSession()
  const identity = `${session?.user.id ?? ''}:${session?.session.id ?? ''}`
  const identityRef = useRef(identity)
  const [loadedFor, setLoadedFor] = useState(identity)
  const [operations, setOperations] = useState(false)
  const [lists, setLists] = useState<Lists>(emptyLists)
  const [contacts, setContacts] = useState<Record<string, DriverContact['driver']>>({})
  const [outcomes, setOutcomes] = useState<Record<string, DriverCallOutcome>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [decisionRequestId, setDecisionRequestId] = useState('')
  const [loggingOfferId, setLoggingOfferId] = useState('')
  const [busyOfferId, setBusyOfferId] = useState('')
  const [now, setNow] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const active = useRef(false), permitted = useRef(false), generation = useRef(0), read = useRef(0)
  const action = useRef<symbol | null>(null)
  const reconcile = useRef(false)
  const current = useCallback((epoch: number) => active.current && generation.current === epoch && identityRef.current === identity, [identity])
  const clear = useCallback(() => {
    generation.current++; read.current++; action.current = null; permitted.current = false; reconcile.current = false
    setOperations(false); setLists(emptyLists()); setContacts({}); setOutcomes({}); setNotes({})
    setDecisionRequestId(''); setLoggingOfferId(''); setBusyOfferId(''); setMessage(''); setError(''); setLoading(false)
  }, [])

  const refresh = useCallback(async (showLoading = false) => {
    if (!active.current || identityRef.current !== identity || !session?.user.id || action.current) return
    const epoch = generation.current, request = ++read.current
    const valid = () => current(epoch) && request === read.current
    if (showLoading) setLoading(true)
    setError('')
    try {
      const access = await getAdminAccess()
      // A same-context denial wins even if an action superseded this queue read.
      if (!current(epoch)) return
      if (!access.operations) { clear(); setLoadedFor(identity); return }
      if (!valid()) return
      const [offers, availability] = await Promise.all([getAdminTripOffers(), getAdminAvailabilityRequests()])
      if (!valid()) return
      const ids = new Set([...availability.pendingRequests, ...availability.confirmedRequests.filter(item => item.needsReview)].map(item => item.requestId))
      offers.pendingOffers.forEach(item => ids.add(item.offerId))
      setContacts(value => retain(value, ids)); setOutcomes(value => retain(value, ids)); setNotes(value => retain(value, ids))
      setDecisionRequestId(value => ids.has(value) ? value : ''); setLoggingOfferId(value => ids.has(value) ? value : '')
      setLists({ ...offers, availabilityRequests: availability.pendingRequests, confirmedRequests: availability.confirmedRequests, recentRequests: availability.recentRequests })
      permitted.current = true; setOperations(true); setLoadedFor(identity); setNow(Date.now())
    } catch (cause) {
      if (valid() || (current(epoch) && accessDenied(cause))) {
        clear(); setLoadedFor(identity); setError(cause instanceof Error ? cause.message : 'Trip operations are temporarily unavailable.')
      }
    } finally { if (valid()) setLoading(false) }
  }, [identity, session?.user.id, current, clear])

  useFocusEffect(useCallback(() => {
    identityRef.current = identity
    let appState = AppState.currentState
    const visible = () => appState === 'active' && (Platform.OS !== 'web' || !document.hidden)
    const update = () => {
      const next = visible()
      if (next === active.current) return
      active.current = next; clear()
      if (next) void refresh(true)
    }
    clear(); active.current = visible()
    if (active.current) void refresh(true)
    const subscription = AppState.addEventListener('change', state => { appState = state; update() })
    if (Platform.OS === 'web') document.addEventListener('visibilitychange', update)
    const refreshTimer = setInterval(() => { void refresh() }, 15_000)
    const clockTimer = setInterval(() => { if (active.current) setNow(Date.now()) }, 1000)
    return () => {
      active.current = false; clear(); subscription.remove()
      if (Platform.OS === 'web') document.removeEventListener('visibilitychange', update)
      clearInterval(refreshTimer); clearInterval(clockTimer)
    }
  }, [clear, refresh, identity]))

  const run = async <T,>(id: string, operation: () => Promise<T>, onSuccess: (value: T) => void, reload = false, onFailure?: () => void) => {
    if (!active.current || !permitted.current || identityRef.current !== identity || action.current) return
    const epoch = generation.current, token = Symbol()
    action.current = token; read.current++
    let denied = false
    const valid = () => current(epoch) && action.current === token
    setBusyOfferId(id); setLoading(false); setError(''); setMessage('')
    try { const value = await operation(); if (valid()) onSuccess(value) }
    catch (cause) {
      if (valid()) {
        if (accessDenied(cause)) { denied = true; clear() }
        else onFailure?.()
        setError(cause instanceof Error ? cause.message : 'Could not complete this operation. Refresh and try again.')
      }
    } finally {
      if (valid()) {
        action.current = null; setBusyOfferId('')
        if (reload || reconcile.current) { reconcile.current = false; await refresh() }
      } else if (reload && !denied && active.current && identityRef.current === identity) {
        // The server may have committed while this screen was hidden. Reconcile
        // its current state without restoring the old action's contact or message.
        reconcile.current = true
        if (!action.current) { reconcile.current = false; await refresh() }
      }
    }
  }

  const reveal = (id: string, legacy: boolean) => run(id,
    () => legacy ? getDriverTripOfferContact(id) : getAvailabilityDriverContact(id),
    result => {
      setContacts(value => ({ ...value, [id]: result.driver })); setOutcomes(value => ({ ...value, [id]: value[id] ?? 'no_answer' }))
      setMessage(legacy ? 'Driver contact access was recorded. Call the driver if a follow-up is needed.' : 'Driver contact access was recorded. Call the driver to check these dates.')
    })
  const call = (id: string, legacy: boolean) => {
    const contact = contacts[id]
    if (!contact) return
    return run(id, () => Linking.openURL(`tel:${contact.phone}`), () => {
      setLoggingOfferId(id); setMessage(legacy ? 'After the call, save its outcome below.' : 'After the call, save its outcome before deciding availability.')
    }, false, () => { setLoggingOfferId(id) })
  }
  const saveCall = (id: string, legacy: boolean) => run(id,
    async () => {
      if (legacy) await recordDriverTripOfferFollowUp(id, outcomes[id] ?? 'no_answer', notes[id] ?? '')
      else await recordAvailabilityCall(id, outcomes[id] ?? 'no_answer', notes[id] ?? '')
    },
    () => {
      setNotes(value => ({ ...value, [id]: '' })); setLoggingOfferId('')
      setMessage(legacy ? 'Call attempt saved to the audit trail.' : outcomes[id] === 'reached'
        ? 'Call attempt saved. You can now confirm or decline availability for the requested dates.'
        : 'Call attempt saved. The driver has not been reached; leave this request awaiting follow-up.')
    }, true)
  const decideAvailability = (id: string, available: boolean) => run(id,
    async () => {
      if (available) await confirmAvailabilityRequest(id)
      else await markAvailabilityUnavailable(id)
    },
    () => {
      setContacts(value => { const next = { ...value }; delete next[id]; return next }); setDecisionRequestId('')
      setMessage(available ? 'Dates confirmed. The client has the same-price quote and a hold through the quote window.' : 'Marked unavailable. The client was notified and no deposit is requested.')
    }, true)

  return { ...lists, operations: operations && loadedFor === identity, contacts, outcomes, notes, decisionRequestId, loggingOfferId, busyOfferId,
    now, loading, error: loadedFor === identity ? error : '', message: loadedFor === identity ? message : '', refresh,
    setOutcomes, setNotes, setDecisionRequestId, setLoggingOfferId, decideAvailability,
    revealAvailabilityDriver: (id: string) => reveal(id, false), revealDriverContact: (id: string) => reveal(id, true),
    callAvailabilityDriver: (id: string) => call(id, false), callDriver: (id: string) => call(id, true),
    saveAvailabilityCall: (id: string) => saveCall(id, false), saveFollowUp: (id: string) => saveCall(id, true),
  }
}
