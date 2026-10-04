-- Driver onboarding, private evidence, vehicle listings, availability, and trip holds.
-- Sensitive evidence is stored in the private R2 binding; this database stores
-- opaque object keys and reviewer-controlled metadata only.

CREATE TABLE IF NOT EXISTS admin_memberships (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  granted_by TEXT REFERENCES user(id),
  granted_at INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS policy_documents (
  id TEXT PRIMARY KEY NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN (
    'driver_terms', 'driver_privacy', 'client_terms', 'client_privacy',
    'booking_policy', 'payment_policy', 'cancellation_policy', 'safety_policy'
  )),
  version TEXT NOT NULL,
  language TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'retired')),
  effective_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (document_type, version, language)
);

CREATE INDEX IF NOT EXISTS policy_documents_current
  ON policy_documents(document_type, language, status, effective_at);

CREATE TABLE IF NOT EXISTS policy_acceptances (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES policy_documents(id),
  onboarding_context TEXT NOT NULL,
  accepted_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS policy_acceptances_user_document
  ON policy_acceptances(user_id, document_id, accepted_at DESC);

CREATE TABLE IF NOT EXISTS phone_verifications (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  phone_e164 TEXT NOT NULL,
  verified_at INTEGER NOT NULL,
  method TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS client_profiles (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  legal_name TEXT NOT NULL,
  phone_e164 TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS driver_verification_requirements (
  id TEXT PRIMARY KEY NOT NULL,
  document_type TEXT NOT NULL,
  version TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  approved_by TEXT REFERENCES user(id),
  approved_at INTEGER,
  UNIQUE (document_type, version)
);

CREATE TABLE IF NOT EXISTS vehicle_verification_requirements (
  id TEXT PRIMARY KEY NOT NULL,
  evidence_type TEXT NOT NULL,
  version TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  approved_by TEXT REFERENCES user(id),
  approved_at INTEGER,
  UNIQUE (evidence_type, version)
);

CREATE TABLE IF NOT EXISTS retention_policies (
  id TEXT PRIMARY KEY NOT NULL,
  record_type TEXT NOT NULL,
  version TEXT NOT NULL,
  retention_days INTEGER NOT NULL CHECK (retention_days > 0),
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  approved_by TEXT REFERENCES user(id),
  approved_at INTEGER,
  UNIQUE (record_type, version)
);

CREATE TABLE IF NOT EXISTS driver_applications (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL UNIQUE REFERENCES user(id) ON DELETE CASCADE,
  legal_name TEXT NOT NULL,
  phone_e164 TEXT NOT NULL,
  national_id_number TEXT NOT NULL,
  national_id_last4 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'pending_verification', 'needs_correction', 'approved', 'rejected', 'suspended')),
  applicant_message TEXT,
  reviewer_reason TEXT,
  submitted_at INTEGER,
  reviewed_at INTEGER,
  reviewed_by TEXT REFERENCES user(id),
  retention_expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS driver_application_documents (
  id TEXT PRIMARY KEY NOT NULL,
  application_id TEXT NOT NULL REFERENCES driver_applications(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected')),
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  reviewed_by TEXT REFERENCES user(id)
);

CREATE INDEX IF NOT EXISTS driver_application_documents_app
  ON driver_application_documents(application_id, document_type, review_status);

CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY NOT NULL,
  driver_application_id TEXT NOT NULL REFERENCES driver_applications(id) ON DELETE CASCADE,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  model_year INTEGER NOT NULL,
  passenger_capacity INTEGER NOT NULL CHECK (passenger_capacity > 0),
  luggage_capacity INTEGER NOT NULL CHECK (luggage_capacity >= 0),
  comfort_details TEXT NOT NULL,
  accessibility_details TEXT NOT NULL DEFAULT '',
  registration_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_review', 'needs_correction', 'approved', 'rejected', 'suspended')),
  reviewer_reason TEXT,
  reviewed_by TEXT REFERENCES user(id),
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS vehicles_driver_state
  ON vehicles(driver_application_id, status);

CREATE TABLE IF NOT EXISTS vehicle_media (
  id TEXT PRIMARY KEY NOT NULL,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  media_kind TEXT NOT NULL CHECK (media_kind IN ('client_photo', 'registration_document', 'ownership_document', 'roadworthiness_document', 'insurance_document', 'other_document')),
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected')),
  reviewer_reason TEXT,
  reviewed_by TEXT REFERENCES user(id),
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS vehicle_media_public
  ON vehicle_media(vehicle_id, media_kind, review_status);

CREATE TABLE IF NOT EXISTS vehicle_unavailability (
  id TEXT PRIMARY KEY NOT NULL,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  driver_application_id TEXT NOT NULL REFERENCES driver_applications(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK (start_date < end_date)
);

CREATE INDEX IF NOT EXISTS vehicle_unavailability_dates
  ON vehicle_unavailability(vehicle_id, start_date, end_date);

CREATE TABLE IF NOT EXISTS fare_policies (
  id TEXT PRIMARY KEY NOT NULL,
  version TEXT NOT NULL UNIQUE,
  currency TEXT NOT NULL,
  rules_json TEXT NOT NULL,
  quote_ttl_seconds INTEGER NOT NULL CHECK (quote_ttl_seconds > 0),
  hold_ttl_seconds INTEGER NOT NULL CHECK (hold_ttl_seconds > 0),
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  approved_by TEXT REFERENCES user(id),
  approved_at INTEGER,
  effective_at INTEGER
);

CREATE TABLE IF NOT EXISTS trip_quotes (
  id TEXT PRIMARY KEY NOT NULL,
  client_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  policy_id TEXT NOT NULL REFERENCES fare_policies(id),
  origin_json TEXT NOT NULL,
  destination_json TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  party_size INTEGER NOT NULL CHECK (party_size > 0),
  luggage_count INTEGER NOT NULL CHECK (luggage_count >= 0),
  route_distance_meters INTEGER NOT NULL,
  route_duration_seconds INTEGER NOT NULL,
  quote_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK (start_date < end_date)
);

CREATE INDEX IF NOT EXISTS trip_quotes_client_expiry
  ON trip_quotes(client_user_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY NOT NULL,
  client_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  quote_id TEXT NOT NULL UNIQUE REFERENCES trip_quotes(id),
  origin_json TEXT NOT NULL,
  destination_json TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  party_size INTEGER NOT NULL CHECK (party_size > 0),
  luggage_count INTEGER NOT NULL CHECK (luggage_count >= 0),
  quote_snapshot_json TEXT NOT NULL,
  terms_snapshot_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('deposit_pending', 'confirmed', 'cancelled', 'expired')),
  hold_expires_at INTEGER NOT NULL,
  contact_share_consented_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (start_date < end_date)
);

CREATE INDEX IF NOT EXISTS bookings_vehicle_dates
  ON bookings(vehicle_id, status, start_date, end_date, hold_expires_at);

CREATE TABLE IF NOT EXISTS booking_contact_consents (
  id TEXT PRIMARY KEY NOT NULL,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  client_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  consented_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE IF NOT EXISTS marketplace_audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES user(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT,
  prior_state TEXT,
  new_state TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS marketplace_audit_target
  ON marketplace_audit_events(target_type, target_id, created_at DESC);
