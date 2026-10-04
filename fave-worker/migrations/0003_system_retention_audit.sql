CREATE TABLE marketplace_audit_events_next (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT REFERENCES user(id),
  actor_type TEXT NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user', 'system')),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT,
  prior_state TEXT,
  new_state TEXT,
  created_at INTEGER NOT NULL
);

INSERT INTO marketplace_audit_events_next
  (id, actor_user_id, actor_type, action, target_type, target_id, reason, prior_state, new_state, created_at)
SELECT id, actor_user_id, 'user', action, target_type, target_id, reason, prior_state, new_state, created_at
  FROM marketplace_audit_events;

DROP TABLE marketplace_audit_events;
ALTER TABLE marketplace_audit_events_next RENAME TO marketplace_audit_events;

CREATE INDEX marketplace_audit_target
  ON marketplace_audit_events(target_type, target_id, created_at DESC);
