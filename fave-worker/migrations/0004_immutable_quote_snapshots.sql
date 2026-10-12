CREATE TRIGGER IF NOT EXISTS trip_quotes_fare_snapshot_immutable
BEFORE UPDATE OF
  client_user_id,
  vehicle_id,
  policy_id,
  origin_json,
  destination_json,
  start_date,
  end_date,
  party_size,
  luggage_count,
  route_distance_meters,
  route_duration_seconds,
  quote_json,
  expires_at,
  created_at
ON trip_quotes
FOR EACH ROW
WHEN NEW.client_user_id IS NOT OLD.client_user_id
  OR NEW.vehicle_id IS NOT OLD.vehicle_id
  OR NEW.policy_id IS NOT OLD.policy_id
  OR NEW.origin_json IS NOT OLD.origin_json
  OR NEW.destination_json IS NOT OLD.destination_json
  OR NEW.start_date IS NOT OLD.start_date
  OR NEW.end_date IS NOT OLD.end_date
  OR NEW.party_size IS NOT OLD.party_size
  OR NEW.luggage_count IS NOT OLD.luggage_count
  OR NEW.route_distance_meters IS NOT OLD.route_distance_meters
  OR NEW.route_duration_seconds IS NOT OLD.route_duration_seconds
  OR NEW.quote_json IS NOT OLD.quote_json
  OR NEW.expires_at IS NOT OLD.expires_at
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'trip quote fare snapshot is immutable');
END;

CREATE TRIGGER IF NOT EXISTS bookings_fare_snapshot_immutable
BEFORE UPDATE OF quote_snapshot_json ON bookings
FOR EACH ROW
WHEN NEW.quote_snapshot_json IS NOT OLD.quote_snapshot_json
BEGIN
  SELECT RAISE(ABORT, 'booking fare snapshot is immutable');
END;
