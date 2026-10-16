ALTER TABLE notification_outbox ADD COLUMN queue_generation TEXT;
ALTER TABLE notification_outbox ADD COLUMN send_lease_token TEXT;
ALTER TABLE notification_outbox ADD COLUMN send_lease_until INTEGER;
