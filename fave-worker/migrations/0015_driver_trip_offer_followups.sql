CREATE TABLE IF NOT EXISTS driver_trip_offer_followups (
  id TEXT PRIMARY KEY NOT NULL,
  offer_id TEXT NOT NULL REFERENCES driver_trip_offers(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  outcome TEXT NOT NULL CHECK (outcome IN ('reached', 'no_answer', 'busy', 'voicemail', 'other')),
  note TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS driver_trip_offer_followups_offer
  ON driver_trip_offer_followups(offer_id, created_at DESC);
