-- Better Auth 1.7.5 passkey and twoFactor schemas; no roles are provisioned here.
ALTER TABLE user ADD COLUMN twoFactorEnabled INTEGER DEFAULT 0;
CREATE TABLE passkey (
 id TEXT PRIMARY KEY NOT NULL, name TEXT, publicKey TEXT NOT NULL,
 userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 credentialID TEXT NOT NULL UNIQUE, counter INTEGER NOT NULL,
 deviceType TEXT NOT NULL, backedUp INTEGER NOT NULL, transports TEXT,
 createdAt INTEGER, aaguid TEXT
);
CREATE INDEX passkey_user ON passkey(userId);
CREATE TABLE twoFactor (
 id TEXT PRIMARY KEY NOT NULL, secret TEXT NOT NULL, backupCodes TEXT NOT NULL,
 userId TEXT NOT NULL UNIQUE REFERENCES user(id) ON DELETE CASCADE,
 verified INTEGER DEFAULT 1, failedVerificationCount INTEGER DEFAULT 0, lockedUntil INTEGER
);
CREATE INDEX twoFactor_secret ON twoFactor(secret);
CREATE TABLE review_memberships (
 user_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 granted_at INTEGER NOT NULL, granted_by TEXT REFERENCES user(id)
);
CREATE TABLE review_session_proofs (
 session_id TEXT PRIMARY KEY NOT NULL REFERENCES session(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 source_session_id TEXT NOT NULL,
 origin TEXT NOT NULL, method TEXT NOT NULL CHECK(method IN ('passkey','totp')),
 credential_id TEXT NOT NULL, verified_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE review_auth_attempts (
 user_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 window_start INTEGER NOT NULL, attempts INTEGER NOT NULL
);
CREATE TABLE review_used_codes (
 digest TEXT PRIMARY KEY NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE review_webauthn_challenges (
 challenge TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
 generation INTEGER NOT NULL, origin TEXT NOT NULL, ceremony TEXT NOT NULL CHECK(ceremony IN ('registration','authentication')),
 expires_at INTEGER NOT NULL
);
-- Enforce the last-method rule at the actual mutation, including concurrent requests.
-- Operator recovery must revoke reviewer membership before deleting all methods.
CREATE TRIGGER review_keep_last_passkey BEFORE DELETE ON passkey
WHEN EXISTS (SELECT 1 FROM review_memberships WHERE user_id=OLD.userId AND active=1)
 AND (SELECT COUNT(*) FROM passkey WHERE userId=OLD.userId) <= 1
 AND NOT EXISTS (SELECT 1 FROM twoFactor JOIN user ON user.id=twoFactor.userId
   WHERE twoFactor.userId=OLD.userId AND verified=1 AND user.twoFactorEnabled=1)
BEGIN SELECT RAISE(ABORT, 'REVIEW_LAST_METHOD'); END;
CREATE TRIGGER review_keep_last_totp BEFORE UPDATE OF twoFactorEnabled ON user
WHEN OLD.twoFactorEnabled=1 AND NEW.twoFactorEnabled=0
 AND EXISTS (SELECT 1 FROM review_memberships WHERE user_id=OLD.id AND active=1)
 AND EXISTS (SELECT 1 FROM twoFactor WHERE userId=OLD.id AND verified=1)
 AND NOT EXISTS (SELECT 1 FROM passkey WHERE userId=OLD.id)
BEGIN SELECT RAISE(ABORT, 'REVIEW_LAST_METHOD'); END;
CREATE TRIGGER review_keep_last_totp_record BEFORE DELETE ON twoFactor
WHEN OLD.verified=1 AND EXISTS (SELECT 1 FROM user WHERE id=OLD.userId AND twoFactorEnabled=1)
 AND EXISTS (SELECT 1 FROM review_memberships WHERE user_id=OLD.userId AND active=1)
 AND NOT EXISTS (SELECT 1 FROM passkey WHERE userId=OLD.userId)
BEGIN SELECT RAISE(ABORT, 'REVIEW_LAST_METHOD'); END;

-- Lock generations survive session rotation during an in-flight ceremony.
CREATE TABLE review_session_locks (
 session_id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 generation INTEGER NOT NULL DEFAULT 0, locked_at INTEGER NOT NULL
);
