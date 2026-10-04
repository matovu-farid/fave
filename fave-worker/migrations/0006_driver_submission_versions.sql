ALTER TABLE driver_applications
  ADD COLUMN submission_version INTEGER NOT NULL DEFAULT 1 CHECK (submission_version > 0);

ALTER TABLE driver_application_documents
  ADD COLUMN submission_version INTEGER NOT NULL DEFAULT 1 CHECK (submission_version > 0);

CREATE INDEX driver_application_documents_submission
  ON driver_application_documents(application_id, submission_version, document_type, review_status);
