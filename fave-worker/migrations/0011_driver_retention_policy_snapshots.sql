ALTER TABLE driver_applications
  ADD COLUMN retention_policy_id TEXT REFERENCES retention_policies(id);

ALTER TABLE driver_application_documents
  ADD COLUMN retention_policy_id TEXT REFERENCES retention_policies(id);
