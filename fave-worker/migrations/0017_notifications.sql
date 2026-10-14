CREATE TABLE notification_events (
  id TEXT PRIMARY KEY NOT NULL,
  event_type TEXT NOT NULL,
  event_version INTEGER NOT NULL CHECK (event_version > 0),
  domain_type TEXT NOT NULL,
  domain_id TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  expires_at INTEGER,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  CHECK (expires_at IS NULL OR expires_at > occurred_at)
);

CREATE INDEX notification_events_domain
  ON notification_events(domain_type, domain_id, occurred_at DESC);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES notification_events(id) ON DELETE RESTRICT,
  recipient_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  template_key TEXT NOT NULL,
  route_key TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('ordinary', 'urgent', 'time_sensitive')),
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  UNIQUE (event_id, recipient_user_id)
);

CREATE INDEX notifications_recipient_newest
  ON notifications(recipient_user_id, created_at DESC, id DESC);

CREATE INDEX notifications_recipient_unread
  ON notifications(recipient_user_id, created_at DESC, id DESC)
  WHERE read_at IS NULL;

CREATE TABLE notification_outbox (
  delivery_id TEXT PRIMARY KEY NOT NULL,
  notification_id TEXT NOT NULL UNIQUE REFERENCES notifications(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES notification_events(id) ON DELETE RESTRICT,
  recipient_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN (
    'pending', 'queued', 'processing', 'complete', 'failed', 'dead_lettered', 'expired', 'suppressed'
  )),
  not_before INTEGER NOT NULL,
  expires_at INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_until INTEGER,
  queued_at INTEGER,
  last_attempt_at INTEGER,
  last_error_category TEXT,
  created_at INTEGER NOT NULL,
  CHECK (expires_at IS NULL OR expires_at > created_at)
);

CREATE INDEX notification_outbox_due
  ON notification_outbox(status, not_before, lease_until, created_at);

CREATE INDEX notification_outbox_admin_status
  ON notification_outbox(status, last_attempt_at DESC, created_at DESC);

CREATE TABLE notification_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  delivery_id TEXT NOT NULL REFERENCES notification_outbox(delivery_id) ON DELETE CASCADE,
  push_token_id TEXT REFERENCES notification_push_tokens(id) ON DELETE SET NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  status TEXT NOT NULL CHECK (status IN (
    'queued', 'sending', 'expo_accepted', 'receipt_ok', 'device_unregistered', 'retrying', 'failed', 'dead_lettered'
  )),
  expo_ticket_id TEXT UNIQUE,
  receipt_status TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_category TEXT,
  last_attempt_at INTEGER,
  receipt_checked_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (delivery_id, push_token_id)
);

CREATE INDEX notification_deliveries_outbox
  ON notification_deliveries(delivery_id, status);

CREATE INDEX notification_deliveries_receipts
  ON notification_deliveries(status, last_attempt_at, expo_ticket_id)
  WHERE status = 'expo_accepted' AND expo_ticket_id IS NOT NULL;

CREATE TABLE notification_retry_audit (
  id TEXT PRIMARY KEY NOT NULL,
  delivery_id TEXT REFERENCES notification_outbox(delivery_id) ON DELETE SET NULL,
  actor_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('queued', 'expired', 'suppressed', 'rejected', 'failed')),
  created_at INTEGER NOT NULL
);

CREATE INDEX notification_retry_audit_delivery
  ON notification_retry_audit(delivery_id, created_at DESC);
