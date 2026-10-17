CREATE TABLE account_export_requests (
 id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
 request_key TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('requested','streaming','ready','failed')),
 requested_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 generation_id TEXT,
 generated_at INTEGER,
 needs_follow_up INTEGER NOT NULL DEFAULT 0 CHECK(needs_follow_up IN (0,1)),
 downloaded_at INTEGER,
 failure_code TEXT,
 UNIQUE(user_id,request_key)
);
CREATE INDEX account_exports_owner ON account_export_requests(user_id,requested_at,id);
CREATE INDEX account_exports_queue ON account_export_requests(requested_at,id);
CREATE TRIGGER account_export_receipt_immutable BEFORE UPDATE ON account_export_requests
 WHEN NEW.id IS NOT OLD.id OR NEW.user_id IS NOT OLD.user_id OR NEW.request_key IS NOT OLD.request_key OR NEW.requested_at IS NOT OLD.requested_at
 BEGIN SELECT RAISE(ABORT,'account export receipt is immutable'); END;
CREATE TABLE account_export_generations (
 id TEXT PRIMARY KEY NOT NULL,
 request_id TEXT NOT NULL REFERENCES account_export_requests(id) ON DELETE RESTRICT,
 started_at INTEGER NOT NULL,
 finished_at INTEGER,
 status TEXT NOT NULL CHECK(status IN ('streaming','ready','failed')),
 lease_expires_at INTEGER NOT NULL,
 coverage_json TEXT
);
CREATE INDEX account_export_generations_request ON account_export_generations(request_id);
CREATE TABLE account_export_exceptions (
 generation_id TEXT NOT NULL REFERENCES account_export_generations(id) ON DELETE RESTRICT,
 category TEXT NOT NULL,
 code TEXT NOT NULL,
 count INTEGER NOT NULL CHECK(count>0),
 PRIMARY KEY(generation_id,category,code)
);
CREATE TABLE account_export_responses (
 id TEXT PRIMARY KEY NOT NULL,
 request_id TEXT NOT NULL REFERENCES account_export_requests(id) ON DELETE RESTRICT,
 actor_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
 message TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX account_export_responses_request ON account_export_responses(request_id,created_at,id);
