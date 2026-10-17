-- Retire evidence and record durable R2 cleanup in one D1 transaction. No
-- foreign key to the retired row: cleanup must survive its removal.
CREATE TABLE private_evidence_deletion_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('driver_application_document', 'vehicle_media')),
  target_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_attempt_at INTEGER,
  last_error_code TEXT CHECK (last_error_code IS NULL OR last_error_code = 'R2_DELETE_FAILED')
);
CREATE INDEX private_evidence_deletion_jobs_pending
  ON private_evidence_deletion_jobs(target_type, last_attempt_at, created_at, id);
