import type { AuthBindings } from './auth'

// Immutable quote identity wins; malformed legacy identity uses a labelled fallback.
const savedDriver = `CASE WHEN json_valid(booking.quote_snapshot_json) THEN
  CASE WHEN json_type(booking.quote_snapshot_json,'$.driverApplicationId')='text'
    THEN NULLIF(trim(json_extract(booking.quote_snapshot_json,'$.driverApplicationId')),'') END END`
export const bookedDriverPredicate = (driver: string) => `(${savedDriver}=${driver} OR (${savedDriver} IS NULL AND EXISTS
  (SELECT 1 FROM vehicles WHERE vehicles.id=booking.vehicle_id AND vehicles.driver_application_id=${driver})))`
export function suspensionBookingFlags(env: AuthBindings, eventId: string, driverId: string, now: number) {
  return [env.DB.prepare(`INSERT INTO booking_review_flags(id,event_id,booking_id,association,status,created_at)
    SELECT ? || ':' || booking.id, ?, booking.id, CASE WHEN ${savedDriver} IS NULL THEN 'legacy_vehicle' ELSE 'saved_driver' END, 'open', ?
      FROM bookings AS booking WHERE (booking.status='confirmed' OR (booking.status='deposit_pending' AND booking.hold_expires_at>MAX(?, CAST(unixepoch('subsec')*1000 AS INTEGER))))
       AND ${bookedDriverPredicate('?')}
       AND EXISTS(SELECT 1 FROM driver_operation_events WHERE id=? AND decision='suspend')`)
    .bind(eventId, eventId, now, now, driverId, driverId, eventId)]
}
