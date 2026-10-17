import { Link, type Href, useLocalSearchParams } from 'expo-router'
import { ActionButton, Card, Field, Message, SectionTitle } from '@/components/marketplace-ui'
import { ThemedText } from '@/components/themed-text'
import { usePrivateOperations } from '@/hooks/use-private-operations'
import { markBookingReviewed, type BookingReviewDetail, type BookingReviewRow } from '@/lib/driver-operations'
import ReviewFrame from './review-frame'
import SecurityPanel, { useReviewSecurity } from './security-panel'

export default function BookingReviewsScreen() {
  const params = useLocalSearchParams<{ id?: string; status?: string }>()
  const id = typeof params.id === 'string' ? params.id : '', status = params.status === 'reviewed' ? 'reviewed' : 'open'
  const access = useReviewSecurity(), view = usePrivateOperations<BookingReviewRow, BookingReviewDetail>('bookings', status, id, access)
  const flag = view.detail?.flag, draft = view.draft
  const valid = draft.note.trim().length >= 4 && draft.note.trim().length <= 1000
  return <ReviewFrame title="Bookings needing review">
    <ThemedText>Review bookings affected by a driver suspension. A flag keeps the booking visible until you record your review.</ThemedText>
    <SecurityPanel state={access} />
    {view.error ? <Message error>{view.error}</Message> : null}
    {view.message ? <Message>{view.message}</Message> : null}
    {id ? <>
      <Link href={`/admin/booking-reviews?status=${encodeURIComponent(status)}` as Href}><ThemedText type="link">Back to booking reviews</ThemedText></Link>
      {!access.unlocked ? <Message>Unlock reviews to open the suspension reason and record your review.</Message> : <>
        <ActionButton title={flag ? 'Refresh booking review' : 'Open booking review'} busy={view.busy} onPress={() => void view.open()} />
        {flag ? <>
          <SectionTitle title={flag.status === 'open' ? 'Owner review needed' : 'Review recorded'} />
          <ThemedText selectable>Booking reference: {flag.bookingId}</ThemedText>
          <ThemedText>{flag.startDate} to {flag.endDate}</ThemedText>
          <ThemedText>Current booking status: {flag.bookingStatus.replace(/_/g, ' ')}</ThemedText>
          {flag.association === 'legacy_vehicle' ? <Message error>Verify the booked driver. This older booking has no valid saved driver reference; it was flagged using the car’s current driver.</Message> : null}
          <Card><SectionTitle title="Suspension record" /><ThemedText>{new Date(flag.suspendedAt).toLocaleString()} · Reviewer {flag.suspendedBy}</ThemedText><ThemedText>Internal reason: {flag.reason}</ThemedText><ThemedText>Message shown to driver: {flag.applicantMessage}</ThemedText></Card>
          <Link href={`/admin/driver-operations?id=${encodeURIComponent(flag.driverId)}` as Href}><ThemedText type="link">Open driver operations</ThemedText></Link>
          {flag.status === 'open' ? <Card>
            <SectionTitle title="Record your review" detail="Describe what you checked and the next steps. This does not cancel, refund, reassign or complete the trip." />
            <Field label="Internal outcome note (4–1000 characters)" value={draft.note} onChangeText={value => view.setField('note', value)} multiline editable={!view.busy} />
            <ActionButton title="Mark reviewed" disabled={!valid || view.busy} onPress={() => view.setField('action', 'reviewed')} />
            {draft.action ? <><Message>Close this review flag for booking {flag.bookingId}? The booking and any payments will stay as they are.</Message><ActionButton title="Confirm review recorded" busy={view.busy} disabled={!valid} onPress={() => void view.submit(() => markBookingReviewed(id, draft.note))} /><ActionButton title="Keep editing" disabled={view.busy} onPress={() => view.setField('action', '')} /></> : null}
          </Card> : <Card><SectionTitle title="Recorded outcome" /><ThemedText>{flag.outcomeNote}</ThemedText><ThemedText>{flag.reviewedAt ? new Date(flag.reviewedAt).toLocaleString() : ''} · Reviewer {flag.reviewedBy}</ThemedText></Card>}
          <SectionTitle title="Driver decision history" />
          {view.detail!.history.items.map(event => <Card key={event.id}><ThemedText>{event.priorState} → {event.newState}</ThemedText><ThemedText>{new Date(event.createdAt).toLocaleString()} · Reviewer {event.actorUserId}</ThemedText><ThemedText>{event.reason}</ThemedText></Card>)}
          {view.detail!.history.hasMore ? <Message>Showing the latest 25 decisions.</Message> : null}
        </> : null}
      </>}
    </> : <>
      <SectionTitle title={status === 'open' ? 'Open flags' : 'Reviewed flags'} detail="Oldest flags first. Only owner reviewers can access this queue." />
      <Link href={`/admin/booking-reviews?status=${encodeURIComponent(status === 'open' ? 'reviewed' : 'open')}` as Href}><ThemedText type="link">{status === 'open' ? 'Show reviewed flags' : 'Show open flags'}</ThemedText></Link>
      <ActionButton title="Refresh booking reviews" busy={view.busy} onPress={() => void view.refresh()} />
      {!view.busy && !view.error && !view.items.length ? <Message>{status === 'open' ? 'No bookings are waiting for suspension review.' : 'No reviews have been recorded.'}</Message> : null}
      {view.items.map(item => <Card key={item.id}><ThemedText selectable>Booking: {item.bookingId}</ThemedText><ThemedText>{item.startDate} to {item.endDate} · {item.bookingStatus.replace(/_/g, ' ')}</ThemedText><ThemedText selectable>Driver reference: {item.driverId}</ThemedText><ThemedText>Flagged {new Date(item.createdAt).toLocaleString()}</ThemedText><Link href={`/admin/booking-reviews?id=${encodeURIComponent(item.id)}&status=${encodeURIComponent(status)}` as Href}><ThemedText type="link">Open review for booking {item.bookingId}</ThemedText></Link></Card>)}
      {view.nextCursor ? <ActionButton title="Load more booking reviews" busy={view.busy} onPress={() => void view.loadMore()} /> : null}
    </>}
  </ReviewFrame>
}
