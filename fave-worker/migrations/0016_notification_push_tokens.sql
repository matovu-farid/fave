CREATE TABLE IF NOT EXISTS notification_push_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at INTEGER NOT NULL,
  last_registered_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS notification_push_tokens_user
  ON notification_push_tokens(user_id, last_registered_at DESC);
