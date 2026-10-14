CREATE TABLE IF NOT EXISTS driver_trip_offers (
  id TEXT PRIMARY KEY NOT NULL,
  client_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  driver_application_id TEXT NOT NULL REFERENCES driver_applications(id) ON DELETE CASCADE,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  origin_json TEXT NOT NULL,
  destination_json TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  party_size INTEGER NOT NULL CHECK (party_size > 0),
  luggage_count INTEGER NOT NULL CHECK (luggage_count >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'quoting', 'quoted', 'declined', 'expired', 'withdrawn', 'quote_failed')),
  quote_id TEXT UNIQUE REFERENCES trip_quotes(id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  responded_at INTEGER,
  CHECK (start_date < end_date)
);

CREATE INDEX IF NOT EXISTS driver_trip_offers_driver_pending
  ON driver_trip_offers(driver_application_id, status, expires_at);

CREATE INDEX IF NOT EXISTS driver_trip_offers_client_status
  ON driver_trip_offers(client_user_id, status, created_at DESC);
