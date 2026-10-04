ALTER TABLE driver_application_documents ADD COLUMN retention_expires_at INTEGER;

UPDATE driver_application_documents
   SET retention_expires_at = (
         SELECT retention_expires_at FROM driver_applications
          WHERE id = driver_application_documents.application_id
       )
 WHERE retention_expires_at IS NULL;

CREATE INDEX IF NOT EXISTS driver_documents_retention_expiry
  ON driver_application_documents(retention_expires_at)
  WHERE retention_expires_at IS NOT NULL;
