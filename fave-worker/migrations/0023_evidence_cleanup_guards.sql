-- Parent cascades must not discard the only reference to an R2 object. The
-- existing retirement transaction queues a matching durable job before DELETE.
-- These guards do not authorize deletion or select a legal retention deadline.
CREATE TRIGGER driver_document_cleanup_before_delete
BEFORE DELETE ON driver_application_documents
WHEN NOT EXISTS (
  SELECT 1 FROM private_evidence_deletion_jobs
   WHERE target_type = 'driver_application_document'
     AND target_id = OLD.id AND object_key = OLD.object_key
)
BEGIN
  SELECT RAISE(ABORT, 'evidence cleanup required');
END;

-- Include original client-photo objects: publishing a derived photo does not
-- make its private source safe to orphan when a vehicle or identity is removed.
CREATE TRIGGER vehicle_media_cleanup_before_delete
BEFORE DELETE ON vehicle_media
WHEN NOT EXISTS (
  SELECT 1 FROM private_evidence_deletion_jobs
   WHERE target_type = 'vehicle_media'
     AND target_id = OLD.id AND object_key = OLD.object_key
)
BEGIN
  SELECT RAISE(ABORT, 'evidence cleanup required');
END;
