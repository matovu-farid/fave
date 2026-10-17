ALTER TABLE driver_applications ADD COLUMN operations_version INTEGER NOT NULL DEFAULT 0;
-- Every status path advances the version, including application review/resubmission.
CREATE TRIGGER driver_operations_version AFTER UPDATE OF status ON driver_applications
WHEN NEW.status != OLD.status
BEGIN
  UPDATE driver_applications SET operations_version = OLD.operations_version + 1 WHERE id = NEW.id;
END;
CREATE INDEX driver_operations_roster ON driver_applications(status, id);

CREATE TABLE driver_operation_events (
  id TEXT PRIMARY KEY NOT NULL,
  application_id TEXT NOT NULL REFERENCES driver_applications(id),
  version INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('suspend','restore','request_corrections')),
  prior_state TEXT NOT NULL,
  new_state TEXT NOT NULL,
  reason TEXT NOT NULL,
  applicant_message TEXT,
  actor_user_id TEXT NOT NULL REFERENCES user(id),
  created_at INTEGER NOT NULL,
  UNIQUE(application_id, version)
);
CREATE INDEX driver_operations_history ON driver_operation_events(application_id, created_at DESC, id DESC);
CREATE TRIGGER driver_operation_immutable BEFORE UPDATE ON driver_operation_events
BEGIN SELECT RAISE(ABORT, 'driver operation history is immutable'); END;

CREATE TABLE booking_review_flags (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES driver_operation_events(id),
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  association TEXT NOT NULL CHECK(association IN ('saved_driver','legacy_vehicle')),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewed')),
  created_at INTEGER NOT NULL,
  reviewed_by TEXT REFERENCES user(id),
  reviewed_at INTEGER,
  outcome_note TEXT,
  UNIQUE(event_id, booking_id),
  CHECK((status='open' AND reviewed_by IS NULL AND reviewed_at IS NULL AND outcome_note IS NULL)
    OR (status='reviewed' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND length(trim(outcome_note)) BETWEEN 4 AND 1000))
);
CREATE INDEX booking_reviews_queue ON booking_review_flags(status,created_at,id);
CREATE TRIGGER booking_review_immutable BEFORE UPDATE ON booking_review_flags
WHEN OLD.status != 'open' OR NEW.status != 'reviewed' OR NEW.id != OLD.id
 OR NEW.event_id != OLD.event_id OR NEW.booking_id != OLD.booking_id
 OR NEW.association != OLD.association OR NEW.created_at != OLD.created_at
BEGIN SELECT RAISE(ABORT, 'booking review permits one recorded outcome only'); END;
