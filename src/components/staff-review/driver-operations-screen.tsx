import { Link, type Href, useLocalSearchParams } from 'expo-router'
import { ActionButton, Card, Field, Message, SectionTitle } from '@/components/marketplace-ui'
import { ThemedText } from '@/components/themed-text'
import { usePrivateOperations } from '@/hooks/use-private-operations'
import { decideDriverOperation, type DriverDetail, type DriverRow } from '@/lib/driver-operations'
import ReviewFrame from './review-frame'
import SecurityPanel, { useReviewSecurity } from './security-panel'

const labels: Record<string, string> = { suspend: 'Suspend driver', restore: 'Restore driver', request_corrections: 'Request corrections' }
export default function DriverOperationsScreen() {
  const params = useLocalSearchParams<{ id?: string; status?: string }>()
  const id = typeof params.id === 'string' ? params.id : '', status = params.status === 'suspended' ? 'suspended' : 'approved'
  const access = useReviewSecurity(), view = usePrivateOperations<DriverRow, DriverDetail>('drivers', status, id, access)
  const detail = view.detail, driver = detail?.driver, draft = view.draft
  const valid = draft.reason.trim().length >= 4 && draft.reason.trim().length <= 300 && draft.message.trim().length >= 4 && draft.message.trim().length <= 300
  return <ReviewFrame title="Driver operations">
    <ThemedText>Suspend or restore drivers, and review the bookings that need your attention.</ThemedText>
    <SecurityPanel state={access} />
    {view.error ? <Message error>{view.error}</Message> : null}
    {view.message ? <Message>{view.message}</Message> : null}
    {id ? <>
      <Link href={`/admin/driver-operations?status=${encodeURIComponent(status)}` as Href}><ThemedText type="link">Back to driver list</ThemedText></Link>
      {!access.unlocked ? <Message>Unlock reviews to open this driver’s operational record.</Message> : <>
        <ActionButton title={driver ? 'Refresh driver record' : 'Open driver record'} busy={view.busy} onPress={() => void view.open()} />
        {driver && detail ? <>
          <SectionTitle title={driver.label} detail={`Status: ${driver.status.replace(/_/g, ' ')}`} />
          <ThemedText selectable>Driver reference: {driver.id}</ThemedText>
          {driver.applicantMessage ? <Message>Message shown to driver: {driver.applicantMessage}</Message> : null}
          {driver.reason ? <ThemedText>Latest internal reason: {driver.reason}</ThemedText> : null}
          {!detail.canRestore ? <Card><SectionTitle title="Approval requirements" />{detail.blockers.map(blocker => <Message key={blocker}>{blocker}</Message>)}</Card> : null}
          <Link href={{ pathname: '/admin/drivers', params: { id } } as Href}><ThemedText type="link">Open application review</ThemedText></Link>
          {['approved', 'suspended'].includes(driver.status) ? <Card>
            <SectionTitle title="Make a decision" detail="The internal reason stays private. The driver receives only the next-step message." />
            <Field label="Internal reason (4–300 characters)" value={draft.reason} onChangeText={value => view.setField('reason', value)} multiline editable={!view.busy} />
            <Field label="Next step shown to driver (4–300 characters)" value={draft.message} onChangeText={value => view.setField('message', value)} multiline editable={!view.busy} />
            {driver.status === 'approved' ? <ActionButton title="Suspend driver" disabled={!valid || view.busy} onPress={() => view.setField('action', 'suspend')} /> : <>
              <ActionButton title="Restore driver" disabled={!valid || !detail.canRestore || view.busy} onPress={() => view.setField('action', 'restore')} />
              <ActionButton title="Request corrections" disabled={!valid || view.busy} onPress={() => view.setField('action', 'request_corrections')} />
            </>}
            {draft.action ? <>
              <SectionTitle title={`Confirm: ${labels[draft.action]}`} detail={`Driver: ${driver.label}`} />
              <Message>{draft.action === 'suspend' ? 'New bookings will stop. Existing active bookings will be flagged for owner review; their booking and payment state will stay as it is.' : draft.action === 'restore' ? 'New work becomes possible only if all current approval checks pass. Open booking-review flags stay open.' : 'The driver can correct and resubmit the application. New bookings remain blocked. Open booking-review flags stay open.'}</Message>
              <ThemedText>Driver message: {draft.message}</ThemedText>
              <ActionButton title={`Confirm ${labels[draft.action].toLowerCase()}`} busy={view.busy} disabled={!valid} onPress={() => void view.submit(current => decideDriverOperation(id, { decision: draft.action, expectedVersion: current.driver.version, reason: draft.reason, applicantMessage: draft.message, confirmed: true }))} />
              <ActionButton title="Keep editing" disabled={view.busy} onPress={() => view.setField('action', '')} />
            </> : null}
          </Card> : <Message>This driver is awaiting application review. Use the application review screen for the next decision.</Message>}
          <SectionTitle title="Vehicles" />
          {!detail.vehicles.items.length ? <Message>No vehicles are registered.</Message> : detail.vehicles.items.map(car => <ThemedText key={car.id}>{car.year} {car.make} {car.model} · {car.status}</ThemedText>)}
          {detail.vehicles.hasMore ? <Message>Showing the first 25 vehicles.</Message> : null}
          <SectionTitle title="Existing active bookings" detail="Scheduled dates alone do not prove a trip is complete." />
          {!detail.bookings.items.length ? <Message>No active bookings are linked to this driver.</Message> : detail.bookings.items.map(booking => <Card key={booking.id}><ThemedText selectable>Booking: {booking.id}</ThemedText><ThemedText>{booking.startDate} to {booking.endDate} · {booking.status.replace(/_/g, ' ')}</ThemedText></Card>)}
          {detail.bookings.hasMore ? <Message>Showing the first 25 active bookings. Review all suspension flags in Bookings needing review.</Message> : null}
          <Link href={'/admin/booking-reviews' as Href}><ThemedText type="link">Bookings needing review</ThemedText></Link>
          <SectionTitle title="Decision history" />
          {!detail.history.items.length ? <Message>No recorded decisions.</Message> : detail.history.items.map(event => <Card key={event.id}><ThemedText>{event.priorState} → {event.newState}</ThemedText><ThemedText>{new Date(event.createdAt).toLocaleString()} · Reviewer {event.actorUserId}</ThemedText><ThemedText>{event.reason}</ThemedText></Card>)}
          {detail.history.hasMore ? <Message>Showing the latest 25 decisions.</Message> : null}
        </> : null}
      </>}
    </> : <>
      <SectionTitle title={status === 'approved' ? 'Approved drivers' : 'Suspended drivers'} />
      <Link href={`/admin/driver-operations?status=${encodeURIComponent(status === 'approved' ? 'suspended' : 'approved')}` as Href}><ThemedText type="link">{status === 'approved' ? 'Show suspended drivers' : 'Show approved drivers'}</ThemedText></Link>
      <ActionButton title="Refresh driver list" busy={view.busy} onPress={() => void view.refresh()} />
      {!view.busy && !view.error && !view.items.length ? <Message>No {status} drivers.</Message> : null}
      {view.items.map(item => <Card key={item.id}><ThemedText type="subtitle">{item.label}</ThemedText><ThemedText>{item.status}</ThemedText><ThemedText selectable>Reference: {item.id}</ThemedText>{item.decidedAt ? <ThemedText>Last decision {new Date(item.decidedAt).toLocaleString()}</ThemedText> : null}<Link href={`/admin/driver-operations?id=${encodeURIComponent(item.id)}&status=${encodeURIComponent(status)}` as Href}><ThemedText type="link">Open driver {item.label}</ThemedText></Link></Card>)}
      {view.nextCursor ? <ActionButton title="Load more drivers" busy={view.busy} onPress={() => void view.loadMore()} /> : null}
    </>}
  </ReviewFrame>
}
