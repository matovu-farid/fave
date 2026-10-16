-- Save the fare and its complete calculation before the client asks staff to check availability.
CREATE TABLE trip_estimates (
  id TEXT PRIMARY KEY NOT NULL,
  client_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  driver_application_id TEXT NOT NULL REFERENCES driver_applications(id),
  policy_id TEXT NOT NULL REFERENCES fare_policies(id),
  origin_json TEXT NOT NULL CHECK (json_valid(origin_json)),
  destination_json TEXT NOT NULL CHECK (json_valid(destination_json)),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  party_size INTEGER NOT NULL CHECK (party_size > 0),
  luggage_count INTEGER NOT NULL CHECK (luggage_count >= 0),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  created_at INTEGER NOT NULL,
  CHECK (start_date < end_date)
);

CREATE INDEX trip_estimates_client_created ON trip_estimates(client_user_id, created_at DESC);

CREATE TRIGGER trip_estimates_snapshot_immutable
BEFORE UPDATE ON trip_estimates
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'trip estimate snapshot is immutable');
END;

CREATE TABLE availability_requests (
  id TEXT PRIMARY KEY NOT NULL,
  estimate_id TEXT NOT NULL UNIQUE REFERENCES trip_estimates(id) ON DELETE CASCADE,
  client_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  driver_application_id TEXT NOT NULL REFERENCES driver_applications(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'requested', 'confirmed', 'unavailable', 'withdrawn', 'expired', 'converted_to_booking'
  )),
  decision_actor_user_id TEXT REFERENCES user(id),
  decision_at INTEGER,
  quote_id TEXT REFERENCES trip_quotes(id),
  hold_expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (start_date < end_date),
  CHECK (
    (status IN ('confirmed', 'converted_to_booking') AND quote_id IS NOT NULL AND hold_expires_at IS NOT NULL)
    OR status NOT IN ('confirmed', 'converted_to_booking')
  )
);

CREATE INDEX availability_requests_client_status
  ON availability_requests(client_user_id, status, created_at DESC);
CREATE INDEX availability_requests_admin_queue
  ON availability_requests(status, created_at ASC);
CREATE INDEX availability_requests_vehicle_dates
  ON availability_requests(vehicle_id, status, start_date, end_date, hold_expires_at);
CREATE INDEX availability_requests_driver_dates
  ON availability_requests(driver_application_id, status, start_date, end_date, hold_expires_at);

CREATE TABLE availability_request_calls (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL REFERENCES availability_requests(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL REFERENCES user(id),
  outcome TEXT NOT NULL CHECK (outcome IN ('reached', 'no_answer', 'busy', 'voicemail', 'other')),
  note TEXT CHECK (note IS NULL OR length(note) <= 500),
  created_at INTEGER NOT NULL
);

CREATE INDEX availability_request_calls_request_created
  ON availability_request_calls(request_id, created_at DESC);
