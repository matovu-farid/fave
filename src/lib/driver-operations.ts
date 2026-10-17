import { authenticatedFetch } from './api'
export type OperationsKind = 'drivers' | 'bookings'
export type OperationsPage<T> = { items: T[]; nextCursor: string | null }
export type DriverRow = { id: string; label: string; status: string; decidedAt: number | null }
export type DriverHistory = { id: string; reason: string; priorState: string; newState: string; createdAt: number; actorUserId: string }
export type DriverDetail = { driver: DriverRow & { version: number; reason: string | null; applicantMessage: string | null }; canRestore: boolean; blockers: string[];
  vehicles: { items: { id: string; make: string; model: string; year: number; status: string }[]; hasMore: boolean };
  bookings: { items: { id: string; startDate: string; endDate: string; status: string }[]; hasMore: boolean };
  history: { items: DriverHistory[]; hasMore: boolean } }
export type BookingReviewRow = { id: string; bookingId: string; status: string; createdAt: number; driverId: string; bookingStatus: string; startDate: string; endDate: string; association: string }
export type BookingReviewDetail = { flag: BookingReviewRow & { reason: string; applicantMessage: string; suspendedAt: number; suspendedBy: string; reviewedAt: number | null; reviewedBy: string | null; outcomeNote: string | null }; history: { items: DriverHistory[]; hasMore: boolean } }
const path = (kind: OperationsKind) => `/api/admin/${kind === 'drivers' ? 'driver-operations' : 'booking-reviews'}`
export function getOperationsPage<T>(kind: OperationsKind, status: string, cursor?: string) {
  return authenticatedFetch<OperationsPage<T>>(`${path(kind)}/pending?status=${encodeURIComponent(status)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { cache: 'no-store' })
}
export const getOperationsDetail = <T,>(kind: OperationsKind, id: string) => authenticatedFetch<T>(`${path(kind)}/${encodeURIComponent(id)}`, { cache: 'no-store' })
const post = (body: unknown): RequestInit => ({ method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
export const decideDriverOperation = (id: string, body: { decision: string; expectedVersion: number; reason: string; applicantMessage: string; confirmed: true }) => authenticatedFetch(`${path('drivers')}/${encodeURIComponent(id)}/decision`, post(body))
export const markBookingReviewed = (id: string, note: string) => authenticatedFetch(`${path('bookings')}/${encodeURIComponent(id)}/reviewed`, post({ note, confirmed: true }))
