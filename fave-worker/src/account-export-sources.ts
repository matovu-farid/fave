/** SQL is static and every ownership predicate derives from the one subject CTE. */
export type ExportSource = { category: string; from: string; key: string; columns: string; own: string; fields: string; nested?: Record<string, string>; notes?: string[]; nationalId?: boolean }
const subject = '(SELECT id FROM subject)'
const driver = `SELECT id FROM driver_applications WHERE user_id=${subject}`
const vehicle = `SELECT v.id FROM vehicles v WHERE v.driver_application_id IN (${driver})`
const tripOwn = `(x.client_user_id=${subject} OR x.vehicle_id IN (${vehicle}))`
const offer = `SELECT x.id FROM driver_trip_offers x WHERE ${tripOwn}`
const request = `SELECT x.id FROM availability_requests x WHERE ${tripOwn}`
const notification = `SELECT id FROM notifications WHERE recipient_user_id=${subject}`
const outbox = `SELECT delivery_id FROM notification_outbox WHERE recipient_user_id=${subject} AND notification_id IN (${notification})`
const driverOperation = `SELECT id FROM driver_operation_events WHERE application_id IN (${driver})`
const bookingReview = `SELECT flag.id FROM booking_review_flags flag JOIN bookings booking ON booking.id=flag.booking_id WHERE booking.client_user_id=${subject} OR flag.event_id IN (${driverOperation})`
const exportRequest = `SELECT id FROM account_export_requests WHERE user_id=${subject}`
function withNotificationDomain(item: ExportSource, eventAlias: string): ExportSource {
  // An inbox recipient may be staff. Receiving a notification does not make
  // another person's domain record part of their account export.
  const ownedDomain = `(${eventAlias}.domain_type='availability_request' AND ${eventAlias}.domain_id IN (${request}))
    OR (${eventAlias}.domain_type='trip_offer' AND ${eventAlias}.domain_id IN (${offer}))
    OR (${eventAlias}.domain_type='booking' AND ${eventAlias}.domain_id IN (SELECT x.id FROM bookings x WHERE ${tripOwn}))`
  return { ...item, columns: `${item.columns}, ${eventAlias}.domain_type AS notification_domain_type,
    CASE WHEN ${ownedDomain} THEN ${eventAlias}.domain_id ELSE NULL END AS notification_domain_id` }
}
function source(category: string, from: string, key: string, fields: string, own: string, extra: Partial<ExportSource> = {}): ExportSource {
  return { category, from, key, columns: fields.split(' ').map((field) => `x.${field}`).join(', '), own, fields, ...extra }
}
function own(category: string, fields: string, owner = 'user_id', key = 'x.id') {
  return source(category, `${category} x`, key, fields, `x.${owner}=${subject}`)
}
const tripFields = 'id vehicle_id start_date end_date party_size luggage_count created_at'
function trip(category: string, fields: string, nested: Record<string, string> = {}) {
  const baseFields = category === 'availability_requests' ? 'id vehicle_id start_date end_date created_at' : tripFields
  return source(category, `${category} x`, 'x.id', `${baseFields} ${fields}`, tripOwn, {
    columns: [...`${baseFields} ${fields}`.trim().split(' ').map((field) => `x.${field}`), `CASE WHEN x.client_user_id=${subject} THEN 1 ELSE 0 END AS own_client`, ...Object.keys(nested).map((key) => `x.${key}`)].join(', '), nested,
  })
}
export function accountExportSources(): ExportSource[] {
  const sources: ExportSource[] = [
    own('user', 'id name email emailVerified image createdAt updatedAt twoFactorEnabled', 'id'),
    own('account', 'providerId accountId scope createdAt updatedAt', 'userId'),
    own('session', 'createdAt updatedAt expiresAt ipAddress userAgent', 'userId'),
    own('client_profiles', 'legal_name phone_e164 created_at updated_at', 'user_id', 'x.user_id'),
    own('phone_verifications', 'phone_e164 verified_at method', 'user_id', 'x.user_id'),
    { ...own('driver_applications', 'id legal_name phone_e164 national_id_last4 status applicant_message submitted_at reviewed_at retention_expires_at created_at updated_at submission_version retention_policy_id citizenship_attested_at lodging_rate_ugx'), nationalId: true,
      columns: 'x.id, x.legal_name, x.phone_e164, x.national_id_last4, x.status, x.applicant_message, x.submitted_at, x.reviewed_at, x.retention_expires_at, x.created_at, x.updated_at, x.submission_version, x.retention_policy_id, x.citizenship_attested_at, x.lodging_rate_ugx, x.national_id_number, x.reviewer_reason', notes: ['reviewer_reason'] },
    source('driver_application_documents', 'driver_application_documents x', 'x.id', 'id application_id document_type content_type byte_size review_status created_at reviewed_at submission_version retention_expires_at retention_policy_id requirement_version', `x.application_id IN (${driver})`, { notes: ['reviewer_reason'] }),
    source('vehicles', 'vehicles x', 'x.id', 'id make model model_year passenger_capacity luggage_capacity comfort_details accessibility_details registration_number status reviewed_at created_at updated_at applicant_message benchmark_amount_ugx benchmark_derivation_version', `x.driver_application_id IN (${driver})`, { notes: ['reviewer_reason'], nested: { benchmark_basis_json: 'benchmark' } }),
    source('vehicle_media', 'vehicle_media x', 'x.id', 'id vehicle_id media_kind content_type byte_size review_status reviewed_at created_at retention_policy_id retention_expires_at requirement_version applicant_message', `x.vehicle_id IN (${vehicle})`, { notes: ['reviewer_reason'] }),
    source('vehicle_unavailability', 'vehicle_unavailability x', 'x.id', 'id vehicle_id start_date end_date created_at', `x.vehicle_id IN (${vehicle}) AND x.driver_application_id IN (${driver})`),
    own('policy_acceptances', 'id document_id onboarding_context accepted_at'),
    source('policy_documents', 'policy_documents x', 'x.id', 'id document_type version language body status effective_at created_at', `x.id IN (SELECT document_id FROM policy_acceptances WHERE user_id=${subject})`),
    trip('trip_estimates', 'policy_id', { origin_json: 'location', destination_json: 'location', snapshot_json: 'quote' }),
    trip('trip_quotes', 'policy_id route_distance_meters route_duration_seconds expires_at contact_share_consented_at', { origin_json: 'location', destination_json: 'location', quote_json: 'quote', terms_snapshot_json: 'terms' }),
    trip('bookings', 'quote_id status hold_expires_at contact_share_consented_at updated_at', { origin_json: 'location', destination_json: 'location', quote_snapshot_json: 'quote', terms_snapshot_json: 'terms' }),
    source('booking_contact_consents', 'booking_contact_consents x', 'x.id', 'id booking_id consented_at revoked_at', `x.client_user_id=${subject}`),
    trip('availability_requests', 'estimate_id status decision_at quote_id hold_expires_at updated_at'),
    source('availability_request_calls', 'availability_request_calls x', 'x.id', 'id request_id outcome created_at', `x.request_id IN (${request})`, { notes: ['note'] }),
    trip('driver_trip_offers', 'status quote_id expires_at responded_at', { origin_json: 'location', destination_json: 'location' }),
    source('driver_trip_offer_followups', 'driver_trip_offer_followups x', 'x.id', 'id offer_id outcome created_at', `x.offer_id IN (${offer})`, { notes: ['note'] }),
    own('notification_push_tokens', 'platform created_at last_registered_at'),
    withNotificationDomain({ ...own('notifications', 'id event_id template_key route_key priority created_at read_at', 'recipient_user_id'), from: 'notifications x JOIN notification_events e ON e.id=x.event_id' }, 'e'),
    withNotificationDomain(source('notification_events', 'notification_events x', 'x.id', 'id event_type event_version occurred_at expires_at created_at', `x.id IN (SELECT event_id FROM notifications WHERE recipient_user_id=${subject})`), 'x'),
    source('notification_outbox', 'notification_outbox x', 'x.delivery_id', 'delivery_id notification_id status not_before expires_at attempt_count queued_at last_attempt_at last_error_category created_at', `x.delivery_id IN (${outbox})`),
    source('notification_deliveries', 'notification_deliveries x', 'x.id', 'id delivery_id platform status receipt_status attempt_count last_error_category last_attempt_at receipt_checked_at created_at updated_at', `x.delivery_id IN (${outbox})`),
    source('notification_retry_audit', 'notification_retry_audit x', 'x.id', 'id delivery_id result created_at', `x.delivery_id IN (${outbox})`, { notes: ['reason'] }),
    source('driver_operation_events', 'driver_operation_events x', 'x.id', 'id application_id version decision prior_state new_state applicant_message created_at', `x.application_id IN (${driver})`, { notes: ['reason'] }),
    source('booking_review_flags', 'booking_review_flags x', 'x.id', 'id event_id booking_id association status created_at reviewed_at', `x.id IN (${bookingReview})`, { notes: ['outcome_note'] }),
    own('account_deletion_requests', 'id status requested_at'),
    own('admin_memberships', 'active granted_at', 'user_id', 'x.user_id'),
    own('review_memberships', 'active granted_at', 'user_id', 'x.user_id'),
    own('passkey', 'name deviceType backedUp transports createdAt', 'userId'),
    own('twoFactor', 'verified failedVerificationCount lockedUntil', 'userId'),
    own('review_auth_attempts', 'window_start attempts', 'user_id', 'x.user_id'),
    own('review_session_locks', 'locked_at', 'user_id', 'x.session_id'),
    own('review_session_proofs', 'method verified_at expires_at', 'user_id', 'x.session_id'),
    source('review_webauthn_challenges', 'review_webauthn_challenges x', 'x.challenge', 'ceremony expires_at', `x.session_id IN (SELECT id FROM session WHERE userId=${subject})`),
    source('fare_policies', 'fare_policies x', 'x.id', 'id version currency quote_ttl_seconds hold_ttl_seconds approved_at effective_at', `x.id IN (SELECT policy_id FROM trip_quotes WHERE client_user_id=${subject} OR vehicle_id IN (${vehicle}) UNION SELECT policy_id FROM trip_estimates WHERE client_user_id=${subject} OR vehicle_id IN (${vehicle}))`, { nested: { rules_json: 'fare' } }),
    source('retention_policies', 'retention_policies x', 'x.id', 'id record_type version retention_days approved_at', `x.id IN (SELECT retention_policy_id FROM driver_applications WHERE user_id=${subject} UNION SELECT retention_policy_id FROM driver_application_documents WHERE application_id IN (${driver}) UNION SELECT retention_policy_id FROM vehicle_media WHERE vehicle_id IN (${vehicle}))`),
    source('driver_verification_requirements', 'driver_verification_requirements x', 'x.id', 'id document_type version required approved_at', `EXISTS (SELECT 1 FROM driver_application_documents d WHERE d.application_id IN (${driver}) AND d.document_type=x.document_type AND d.requirement_version=x.version)`),
    source('vehicle_verification_requirements', 'vehicle_verification_requirements x', 'x.id', 'id evidence_type version required approved_at', `EXISTS (SELECT 1 FROM vehicle_media m WHERE m.vehicle_id IN (${vehicle}) AND m.media_kind=x.evidence_type AND m.requirement_version=x.version)`),
    own('account_export_requests', 'id status requested_at updated_at generated_at needs_follow_up downloaded_at failure_code'),
    source('account_export_generations', 'account_export_generations x', 'x.id', 'id request_id started_at finished_at status', `x.request_id IN (${exportRequest})`),
    source('account_export_exceptions', 'account_export_exceptions x', "x.generation_id || ':' || x.category || ':' || x.code", 'generation_id category code count', `x.generation_id IN (SELECT id FROM account_export_generations WHERE request_id IN (${exportRequest}))`),
    source('account_export_responses', 'account_export_responses x', 'x.id', 'id request_id message created_at', `x.request_id IN (${exportRequest})`),
  ]
  const auditOwn = `(x.target_type IN ('user','reviewer') AND x.target_id=${subject})
    OR (x.target_type='review_session' AND (x.target_id IN (SELECT id FROM session WHERE userId=${subject})
      OR (x.actor_type='user' AND x.actor_user_id=${subject} AND x.action IN ('review_locked','review_unlocked_passkey','review_unlocked_totp'))))
    OR (x.target_type='notification_delivery' AND x.target_id IN (${outbox}))
    OR (x.target_type='trip_estimate' AND x.target_id IN (SELECT x.id FROM trip_estimates x WHERE ${tripOwn}))
    OR (x.target_type='trip_quote' AND x.target_id IN (SELECT x.id FROM trip_quotes x WHERE ${tripOwn}))
    OR (x.target_type='driver_application' AND x.target_id IN (${driver}))
    OR (x.target_type='driver_application_document' AND x.target_id IN (SELECT id FROM driver_application_documents WHERE application_id IN (${driver})))
    OR (x.target_type='vehicle' AND x.target_id IN (${vehicle}))
    OR (x.target_type='vehicle_media' AND x.target_id IN (SELECT id FROM vehicle_media WHERE vehicle_id IN (${vehicle})))
    OR (x.target_type='availability_request' AND x.target_id IN (${request}))
    OR (x.target_type IN ('trip_offer','driver_trip_offer') AND x.target_id IN (${offer}))
    OR (x.target_type='booking' AND x.target_id IN (SELECT x.id FROM bookings x WHERE ${tripOwn}))
    OR (x.target_type='booking_review_flag' AND x.target_id IN (${bookingReview}))
    OR (x.target_type='account_deletion_request' AND x.target_id IN (SELECT id FROM account_deletion_requests WHERE user_id=${subject}))
    OR (x.target_type='account_export_request' AND x.target_id IN (${exportRequest}))`
  sources.push(source('marketplace_audit_events', 'marketplace_audit_events x', 'x.id', 'id actor_type action target_type target_id created_at', `(${auditOwn})`, { notes: ['reason', 'prior_state', 'new_state'] }))
  return sources.map((item) => ({ ...item, columns: `${item.columns}${item.notes?.filter((key) => !item.columns.includes(`x.${key}`)).map((key) => `, x.${key}`).join('') ?? ''}${Object.keys(item.nested ?? {}).filter((key) => !item.columns.includes(`x.${key}`)).map((key) => `, x.${key}`).join('')}` }))
}

export const originalSources = [
  { category: 'driver_application_documents', from: 'driver_application_documents x', own: `x.application_id IN (${driver})` },
  { category: 'vehicle_media', from: 'vehicle_media x', own: `x.vehicle_id IN (${vehicle})` },
]
