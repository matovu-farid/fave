import { Hono } from 'hono'
import type { AuthBindings } from './auth'
import {
  apiError,
  getSignedInUser,
  isMarketplaceAdmin,
  writeMarketplaceAudit,
} from './marketplace-auth'
import { getCurrentPolicies, hasCurrentPolicyAcceptance } from './marketplace-policies'
import { readPrivateEvidence, storePrivateEvidence, storePrivateImage } from './private-files'
import { decryptPrivateField, encryptPrivateField } from './private-fields'

type DriverApplication = {
  id: string
  user_id: string
  legal_name: string
  phone_e164: string
  national_id_number: string
  citizenship_attested_at: number | null
  submission_version: number
  status: string
  applicant_message: string | null
  reviewer_reason: string | null
  submitted_at: number | null
  retention_expires_at: number | null
  retention_policy_id: string | null
  retention_policy_version: string | null
}

type Requirement = { document_type: string; version: string }
type FormEntryValue = string | File
function currentChecklistDocumentPredicate(documentAlias: string): string {
  return `(
    EXISTS (
      SELECT 1 FROM driver_verification_requirements AS requirement
       WHERE requirement.document_type = ${documentAlias}.document_type
         AND requirement.version = ${documentAlias}.requirement_version
         AND requirement.active = 1 AND requirement.required = 1
         AND requirement.approved_at IS NOT NULL
    )
    OR (
      ${documentAlias}.document_type IN ('national_id_front', 'national_id_back', 'passport_photo')
      AND NOT EXISTS (
        SELECT 1 FROM driver_verification_requirements AS requirement
         WHERE requirement.document_type = ${documentAlias}.document_type
           AND requirement.active = 1 AND requirement.required = 1
           AND requirement.approved_at IS NOT NULL
      )
    )
)`
}

export function currentDriverEvidencePredicate(applicationAlias: string): string {
  return `EXISTS (
    SELECT 1 FROM driver_verification_requirements AS current_requirement
     WHERE current_requirement.active = 1 AND current_requirement.required = 1
       AND current_requirement.approved_at IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM driver_verification_requirements AS requirement
     WHERE requirement.active = 1 AND requirement.required = 1
       AND requirement.approved_at IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM driver_application_documents AS document
          WHERE document.application_id = ${applicationAlias}.id
            AND document.submission_version = ${applicationAlias}.submission_version
            AND document.document_type = requirement.document_type
            AND document.requirement_version = requirement.version
            AND document.review_status = 'approved'
            AND document.retention_expires_at IS NOT NULL
            AND document.retention_expires_at > ?
       )
  )
  AND (
    SELECT COUNT(DISTINCT document.document_type)
      FROM driver_application_documents AS document
     WHERE document.application_id = ${applicationAlias}.id
       AND document.submission_version = ${applicationAlias}.submission_version
       AND document.review_status = 'approved'
       AND document.retention_expires_at IS NOT NULL
       AND document.retention_expires_at > ?
       AND document.document_type IN ('national_id_front', 'national_id_back', 'passport_photo')
  ) = 3`
}

export function approvedDriverEvidencePredicate(driverApplicationId: string): string {
  return `EXISTS (
    SELECT 1 FROM driver_applications AS eligible_driver
     WHERE eligible_driver.id = ${driverApplicationId}
       AND eligible_driver.status = 'approved'
       AND eligible_driver.citizenship_attested_at IS NOT NULL
       AND eligible_driver.retention_expires_at IS NOT NULL
       AND eligible_driver.retention_expires_at > ?
       AND EXISTS (
         SELECT 1 FROM retention_policies AS retention
          WHERE retention.record_type = 'driver_application'
            AND retention.active = 1 AND retention.approved_at IS NOT NULL
       )
       AND ${currentDriverEvidencePredicate('eligible_driver')}
       AND (
         SELECT COUNT(DISTINCT acceptance.document_id)
           FROM policy_acceptances AS acceptance
           JOIN policy_documents AS policy ON policy.id = acceptance.document_id
          WHERE acceptance.user_id = eligible_driver.user_id
            AND acceptance.onboarding_context = 'driver_onboarding'
            AND policy.document_type IN ('driver_terms', 'driver_privacy')
            AND policy.language = 'en' AND policy.status = 'approved'
            AND policy.effective_at IS NOT NULL AND policy.effective_at <= ?
            AND NOT EXISTS (
              SELECT 1 FROM policy_documents AS newer
               WHERE newer.document_type = policy.document_type
                 AND newer.language = policy.language
                 AND newer.status = 'approved'
                 AND newer.effective_at IS NOT NULL AND newer.effective_at <= ?
                 AND (newer.effective_at > policy.effective_at OR
                      (newer.effective_at = policy.effective_at AND newer.id > policy.id))
            )
       ) = 2
  )`
}

function isFile(value: FormEntryValue): value is File {
  return typeof value !== 'string' && typeof value.stream === 'function'
}

async function getApplication(
  env: AuthBindings,
  userId: string,
): Promise<DriverApplication | null> {
  return env.DB.prepare(
    `SELECT application.id, application.user_id, application.legal_name, application.phone_e164,
            application.national_id_number, application.citizenship_attested_at,
            application.submission_version, application.status,
            application.applicant_message, application.reviewer_reason, application.submitted_at,
            application.retention_expires_at, application.retention_policy_id, retention.version AS retention_policy_version
       FROM driver_applications AS application
       LEFT JOIN retention_policies AS retention ON retention.id = application.retention_policy_id
      WHERE application.user_id = ? LIMIT 1`,
  )
    .bind(userId)
    .first<DriverApplication>()
}

async function getRequiredDocuments(env: AuthBindings): Promise<Requirement[]> {
  const result = await env.DB.prepare(
    `SELECT document_type, version
       FROM driver_verification_requirements
      WHERE active = 1 AND required = 1 AND approved_at IS NOT NULL
      ORDER BY document_type`,
  ).all<Requirement>()
  return result.results
}

async function hasAllRequiredDocumentsApproved(
  env: AuthBindings,
  applicationId: string,
): Promise<boolean> {
  const application = await env.DB.prepare(
    'SELECT submission_version FROM driver_applications WHERE id = ? LIMIT 1',
  ).bind(applicationId).first<{ submission_version: number }>()
  if (!application) return false

  const missing = await env.DB.prepare(
    `SELECT 1 AS missing
       FROM driver_verification_requirements AS requirement
      WHERE requirement.active = 1 AND requirement.required = 1 AND requirement.approved_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM driver_application_documents AS document
           WHERE document.application_id = ?
             AND document.submission_version = ?
             AND document.document_type = requirement.document_type
             AND document.requirement_version = requirement.version
             AND document.review_status = 'approved'
             AND document.retention_expires_at IS NOT NULL
             AND document.retention_expires_at > ?
        )
      LIMIT 1`,
  )
    .bind(applicationId, application.submission_version, Date.now())
    .first<{ missing: number }>()

  const idDocuments = await env.DB.prepare(
    `SELECT COUNT(DISTINCT document_type) AS count
       FROM driver_application_documents
      WHERE application_id = ? AND review_status = 'approved'
        AND submission_version = ?
        AND retention_expires_at IS NOT NULL AND retention_expires_at > ?
        AND document_type IN ('national_id_front', 'national_id_back', 'passport_photo')`,
    )
    .bind(applicationId, application.submission_version, Date.now())
    .first<{ count: number }>()

  return missing === null && idDocuments?.count === 3
}

const driversApp = new Hono<{ Bindings: AuthBindings }>()
const adminDriversApp = new Hono<{ Bindings: AuthBindings }>()

driversApp.get('/application', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)

  const application = await getApplication(c.env, user.id)
  if (!application) return c.json({ application: null })

  const documents = await c.env.DB.prepare(
    `SELECT id, document_type, requirement_version, review_status, reviewer_reason, created_at
       FROM driver_application_documents
      WHERE application_id = ? AND submission_version = ?
        AND retention_expires_at IS NOT NULL AND retention_expires_at > ?
      ORDER BY created_at DESC`,
  )
    .bind(application.id, application.submission_version, Date.now())
    .all<{
      id: string
      document_type: string
      requirement_version: string | null
      review_status: string
      reviewer_reason: string | null
      created_at: number
    }>()

  const now = Date.now()
  let needsEvidenceRefresh = false
  let needsPolicyAcceptance = false
  if (application.status === 'approved') {
    const [currentEvidence, currentPolicies] = await Promise.all([
      c.env.DB.prepare(
        `SELECT ${currentDriverEvidencePredicate('driver_applications')} AS current
           FROM driver_applications WHERE id = ? LIMIT 1`,
      )
        .bind(now, now, application.id)
        .first<{ current: number }>(),
      getCurrentPolicies(c.env, ['driver_terms', 'driver_privacy'], 'en'),
    ])
    const acceptedCurrentPolicies = await Promise.all(
      currentPolicies.map((document) =>
        hasCurrentPolicyAcceptance(c.env, user.id, document, 'driver_onboarding'),
      ),
    )
    needsEvidenceRefresh =
      currentEvidence?.current !== 1 ||
      application.retention_expires_at === null || application.retention_expires_at <= now ||
      application.citizenship_attested_at === null
    needsPolicyAcceptance =
      currentPolicies.length !== 2 || acceptedCurrentPolicies.some((accepted) => !accepted)
  }

  return c.json({
    application: {
      id: application.id,
      legalName: application.legal_name,
      phoneNumber: application.phone_e164,
      status: application.status,
      needsCitizenshipConfirmation: application.citizenship_attested_at === null,
      needsEvidenceRefresh,
      needsPolicyAcceptance,
      nextAction:
        application.status === 'approved' && needsEvidenceRefresh
          ? 'Update your current identity evidence and resubmit for review before listing vehicles.'
          : application.status === 'approved' && needsPolicyAcceptance
            ? 'Review and accept the current driver terms and privacy notice before listing vehicles.'
            : application.status === 'needs_correction' || application.status === 'rejected'
              ? 'Update the requested information and submit again.'
              : application.status === 'pending_verification' && application.citizenship_attested_at === null
                ? 'Confirm that you are a Ugandan citizen to continue your driver application.'
                : application.status === 'pending_verification'
                ? 'Your application is being reviewed.'
                : application.status === 'approved'
                  ? 'Add your vehicle details to continue.'
                  : application.status === 'suspended'
                    ? 'Contact Fave support for the next steps.'
                    : 'Complete the application requirements and submit it.',
      applicantMessage: application.applicant_message,
      submittedAt: application.submitted_at,
      retentionExpiresAt: application.retention_expires_at,
      retentionPolicyVersion: application.retention_policy_version,
      documents: documents.results.map((document) => ({
        id: document.id,
        type: document.document_type,
        requirementVersion: document.requirement_version,
        status: document.review_status,
        submittedAt: document.created_at,
      })),
    },
  })
})

driversApp.post('/application', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)
  if (!c.env.DRIVER_FILES) {
    return c.json(apiError('PRIVATE_STORAGE_UNAVAILABLE', 'Driver document storage is not configured.'), 503)
  }

  const form = await c.req.formData().catch(() => null)
  if (!form) return c.json(apiError('INVALID_APPLICATION', 'Submit the application details and ID images.'), 400)

  const legalName = form.get('legalName')
  const phoneNumber = form.get('phoneNumber')
  const nationalIdNumber = form.get('nationalIdNumber')
  const citizenshipConfirmation = form.get('citizenshipConfirmation')
  if (
    typeof legalName !== 'string' || legalName.trim().length < 2 || legalName.trim().length > 160 ||
    typeof phoneNumber !== 'string' || !/^\+[1-9]\d{7,14}$/u.test(phoneNumber) ||
    typeof nationalIdNumber !== 'string' || !/^[\p{L}\p{N}-]{5,40}$/u.test(nationalIdNumber.trim()) ||
    citizenshipConfirmation !== 'ugandan_citizen'
  ) {
    return c.json(apiError('INVALID_APPLICATION', 'This driver application is for Ugandan citizens. Enter a legal name, contact phone number, and valid National ID, and confirm your eligibility.'), 400)
  }

  const documents = await getCurrentPolicies(c.env, ['driver_terms', 'driver_privacy'], 'en')
  const accepted = await Promise.all(
    documents.map((document) =>
      hasCurrentPolicyAcceptance(c.env, user.id, document, 'driver_onboarding'),
    ),
  )
  if (documents.length !== 2 || accepted.some((value) => !value)) {
    return c.json(apiError('POLICY_ACCEPTANCE_REQUIRED', 'Review and accept the current driver terms and privacy notice.'), 409)
  }

  const [requirements, retentionPolicy] = await Promise.all([
    getRequiredDocuments(c.env),
    c.env.DB.prepare(
      `SELECT id, version, retention_days FROM retention_policies
        WHERE record_type = 'driver_application' AND active = 1 AND approved_at IS NOT NULL
        ORDER BY approved_at DESC LIMIT 1`,
    ).first<{ id: string; version: string; retention_days: number }>(),
  ])
  if (requirements.length === 0 || !retentionPolicy) {
    return c.json(apiError('APPLICATION_POLICY_UNAVAILABLE', 'The approved verification checklist and retention policy are not available yet.'), 409)
  }

  const existing = await getApplication(c.env, user.id)
  let approvedEvidenceIsStale = false
  if (existing?.status === 'approved') {
    const now = Date.now()
    const currentEvidence = await c.env.DB.prepare(
      `SELECT ${currentDriverEvidencePredicate('driver_applications')} AS current
         FROM driver_applications WHERE id = ? LIMIT 1`,
    )
      .bind(now, now, existing.id)
      .first<{ current: number }>()
    approvedEvidenceIsStale =
      currentEvidence?.current !== 1 ||
      existing.retention_expires_at === null || existing.retention_expires_at <= now ||
      existing.citizenship_attested_at === null ||
      existing.phone_e164 !== phoneNumber
  }
  const pendingNeedsCitizenshipConfirmation =
    existing?.status === 'pending_verification' && existing.citizenship_attested_at === null
  if (existing && !['rejected', 'needs_correction', 'draft'].includes(existing.status) &&
      !(existing.status === 'approved' && approvedEvidenceIsStale) && !pendingNeedsCitizenshipConfirmation) {
    return c.json(apiError('APPLICATION_ALREADY_SUBMITTED', 'An application is already being reviewed or approved.'), 409)
  }
  const nationalId = nationalIdNumber.trim()
  const encryptedNationalId = await encryptPrivateField(c.env.DRIVER_ID_ENCRYPTION_KEY, nationalId)
  if (!encryptedNationalId) {
    return c.json(apiError('PRIVATE_ENCRYPTION_UNAVAILABLE', 'Secure national ID storage is not configured.'), 503)
  }

  const expectedTypes = new Set([
    ...requirements.map((requirement) => requirement.document_type),
    'national_id_front',
    'national_id_back',
    'passport_photo',
  ])
  const fileByType = new Map<string, File>()
  for (const [key, value] of form.entries()) {
    if (!key.startsWith('evidence:')) continue
    const documentType = key.slice('evidence:'.length)
    if (!expectedTypes.has(documentType) || !isFile(value) || fileByType.has(documentType)) {
      return c.json(apiError('INVALID_EVIDENCE', 'Upload each required ID image once.'), 400)
    }
    fileByType.set(documentType, value)
  }

  if ([...expectedTypes].some((documentType) => !fileByType.has(documentType))) {
    return c.json(apiError('EVIDENCE_REQUIRED', 'Upload both sides of the national ID, a passport-style photo, and every required verification document.'), 400)
  }

  const storedFiles: Array<{
    id: string
    documentType: string
    requirementVersion: string | null
    objectKey: string
    contentType: string
    byteSize: number
  }> = []
  for (const [documentType, file] of fileByType) {
    let stored: Awaited<ReturnType<typeof storePrivateEvidence>>
    try {
      stored = documentType === 'national_id_front' || documentType === 'national_id_back' || documentType === 'passport_photo'
        ? await storePrivateImage(c.env, 'driver-documents', file)
        : await storePrivateEvidence(c.env, 'driver-documents', file)
    } catch {
      await Promise.all(storedFiles.map((item) => c.env.DRIVER_FILES?.delete(item.objectKey)))
      return c.json(apiError('PRIVATE_STORAGE_UNAVAILABLE', 'Could not store private driver evidence. Try again.'), 503)
    }
    if (!stored) {
      await Promise.all(storedFiles.map((item) => c.env.DRIVER_FILES?.delete(item.objectKey)))
      const message = documentType === 'national_id_front' || documentType === 'national_id_back' || documentType === 'passport_photo'
        ? 'Identity images must be JPEG, PNG, or WebP images smaller than 8 MB.'
        : 'Driver evidence must be JPEG, PNG, WebP, or PDF files smaller than 8 MB.'
      return c.json(apiError('INVALID_EVIDENCE', message), 400)
    }
    storedFiles.push({
      id: crypto.randomUUID(),
      documentType,
      requirementVersion: requirements.find((requirement) => requirement.document_type === documentType)?.version ?? null,
      ...stored,
    })
  }

  const now = Date.now()
  const applicationId = existing?.id ?? crypto.randomUUID()
  const submissionVersion = existing ? existing.submission_version + 1 : 1
  const submissionAuditId = crypto.randomUUID()
  const normalizedName = legalName.trim().replace(/\s+/gu, ' ')
  const retentionExpiresAt = now + retentionPolicy.retention_days * 86_400_000
  const statements = [
    ...(existing
      ? [
        c.env.DB.prepare(
          `UPDATE driver_applications
              SET legal_name = ?, phone_e164 = ?, national_id_number = ?, national_id_last4 = ?,
                  citizenship_attested_at = ?,
                  status = 'pending_verification', applicant_message = NULL, reviewer_reason = NULL,
                  reviewed_at = NULL, reviewed_by = NULL, submitted_at = ?,
                  retention_expires_at = ?, retention_policy_id = ?, submission_version = ?, updated_at = ?
            WHERE id = ? AND user_id = ? AND (
                status IN ('rejected', 'needs_correction', 'draft')
                OR (status = 'pending_verification' AND citizenship_attested_at IS NULL)
                OR (status = 'approved' AND (
                  NOT (${currentDriverEvidencePredicate('driver_applications')})
                  OR retention_expires_at IS NULL OR retention_expires_at <= ?
                ))
              )
              AND submission_version = ?`,
        ).bind(
          normalizedName,
          phoneNumber,
          encryptedNationalId,
          nationalId.slice(-4),
          now,
          now,
          retentionExpiresAt,
          retentionPolicy.id,
          submissionVersion,
          now,
          applicationId,
          user.id,
          now,
          now,
          now,
          existing.submission_version,
        ),
      ]
      : [c.env.DB.prepare(
          `INSERT INTO driver_applications
            (id, user_id, legal_name, phone_e164, national_id_number, national_id_last4,
             citizenship_attested_at,
             status, submitted_at, retention_expires_at, retention_policy_id,
             submission_version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_verification', ?, ?, ?, ?, ?, ?)`,
        ).bind(
          applicationId,
          user.id,
          normalizedName,
          phoneNumber,
          encryptedNationalId,
          nationalId.slice(-4),
          now,
          now,
          retentionExpiresAt,
          retentionPolicy.id,
          submissionVersion,
          now,
          now,
        )]),
    c.env.DB.prepare(
      `INSERT INTO marketplace_audit_events
        (id, actor_user_id, actor_type, action, target_type, target_id,
         prior_state, new_state, created_at)
       SELECT ?, ?, 'user', ?, 'driver_application', ?, ?, 'pending_verification', ?
        WHERE changes() = 1`,
    ).bind(
      submissionAuditId,
      user.id,
      existing ? 'driver_application_resubmitted' : 'driver_application_submitted',
      applicationId,
      existing?.status ?? null,
      now,
    ),
    ...(existing
      ? [c.env.DB.prepare(
          `UPDATE driver_application_documents SET retention_expires_at = ?
            WHERE application_id = ? AND submission_version < ?
              AND EXISTS (SELECT 1 FROM marketplace_audit_events WHERE id = ?)`,
        ).bind(now, applicationId, submissionVersion, submissionAuditId)]
      : []),
    ...storedFiles.map((file) =>
      c.env.DB.prepare(
        `INSERT INTO driver_application_documents
          (id, application_id, document_type, object_key, content_type, byte_size,
           submission_version, retention_expires_at, retention_policy_id, requirement_version, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM marketplace_audit_events WHERE id = ?)
            AND EXISTS (SELECT 1 FROM driver_applications
                         WHERE id = ? AND submission_version = ? AND status = 'pending_verification')`,
      ).bind(file.id, applicationId, file.documentType, file.objectKey, file.contentType,
        file.byteSize, submissionVersion, retentionExpiresAt, retentionPolicy.id, file.requirementVersion, now,
        submissionAuditId, applicationId, submissionVersion),
    ),
  ]

  try {
    const result = await c.env.DB.batch(statements)
    if ((result[0]?.meta.changes ?? 0) !== 1) {
      await Promise.all(storedFiles.map((file) => c.env.DRIVER_FILES?.delete(file.objectKey)))
      return c.json(apiError('APPLICATION_ALREADY_UPDATED', 'This application changed while you were submitting it. Refresh its status and try again.'), 409)
    }
  } catch {
    await Promise.all(storedFiles.map((file) => c.env.DRIVER_FILES?.delete(file.objectKey)))
    return c.json(apiError('APPLICATION_SAVE_FAILED', 'We could not save the application. Try again.'), 503)
  }

  return c.json({ applicationId, status: 'pending_verification' }, existing ? 200 : 201)
})

adminDriversApp.get('/pending', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)
  if (!(await isMarketplaceAdmin(c.env, user.id))) {
    return c.json(apiError('FORBIDDEN', 'You are not authorized to review driver applications.'), 403)
  }

  const applications = await c.env.DB.prepare(
    `SELECT id, legal_name, phone_e164, citizenship_attested_at, status, submitted_at, submission_version
       FROM driver_applications
      WHERE status IN ('pending_verification', 'needs_correction')
        AND retention_expires_at IS NOT NULL AND retention_expires_at > ?
      ORDER BY submitted_at ASC`,
  ).bind(Date.now()).all<{
    id: string
    legal_name: string
    phone_e164: string
    citizenship_attested_at: number | null
    status: string
    submitted_at: number | null
    submission_version: number
  }>()

  const pending = await Promise.all(applications.results.map(async (application) => {
    const documents = await c.env.DB.prepare(
      `SELECT id, document_type, review_status, reviewer_reason, created_at
         FROM driver_application_documents AS document
        WHERE application_id = ? AND submission_version = ?
          AND retention_expires_at IS NOT NULL AND retention_expires_at > ?
          AND ${currentChecklistDocumentPredicate('document')}
        ORDER BY document_type`,
    )
      .bind(application.id, application.submission_version, Date.now())
      .all<{
        id: string
        document_type: string
        review_status: string
        reviewer_reason: string | null
        created_at: number
      }>()

    return {
      id: application.id,
      legal_name: application.legal_name,
      phone_e164: application.phone_e164,
      citizenship_confirmed: application.citizenship_attested_at !== null,
      status: application.status,
      submitted_at: application.submitted_at,
      documents: documents.results.map((document) => ({
        id: document.id,
        type: document.document_type,
        status: document.review_status,
        reason: document.reviewer_reason,
        submittedAt: document.created_at,
      })),
    }
  }))

  return c.json({ applications: pending })
})

adminDriversApp.post('/:applicationId/identity-review', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)
  if (!(await isMarketplaceAdmin(c.env, user.id))) {
    return c.json(apiError('FORBIDDEN', 'You are not authorized to review identity evidence.'), 403)
  }

  const body: unknown = await c.req.json().catch(() => null)
  const reason = typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>).reason
    : null
  if (typeof reason !== 'string' || reason.trim().length < 8 || reason.trim().length > 300) {
    return c.json(apiError('REVIEW_REASON_REQUIRED', 'Enter a brief reason for opening identity details.'), 400)
  }

  const application = await c.env.DB.prepare(
    `SELECT id, user_id, legal_name, phone_e164, national_id_number, national_id_last4
       FROM driver_applications
      WHERE id = ? AND retention_expires_at IS NOT NULL AND retention_expires_at > ? LIMIT 1`,
  )
    .bind(c.req.param('applicationId'), Date.now())
    .first<{
      id: string
      user_id: string
      legal_name: string
      phone_e164: string
      national_id_number: string
      national_id_last4: string
    }>()
  if (!application) return c.json(apiError('NOT_FOUND', 'Driver application was not found.'), 404)

  await writeMarketplaceAudit(c.env, {
    actorUserId: user.id,
    action: 'driver_identity_details_accessed',
    targetType: 'driver_application',
    targetId: application.id,
    reason: reason.trim(),
  })

  const nationalIdNumber = await decryptPrivateField(c.env.DRIVER_ID_ENCRYPTION_KEY, application.national_id_number)
  if (!nationalIdNumber) {
    return c.json(apiError('PRIVATE_ENCRYPTION_UNAVAILABLE', 'Secure national ID data could not be opened.'), 503)
  }

  return c.json({
    legalName: application.legal_name,
    phoneNumber: application.phone_e164,
    nationalIdNumber,
    nationalIdLast4: application.national_id_last4,
  })
})

adminDriversApp.post('/:applicationId/documents/:documentId/access', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)
  if (!(await isMarketplaceAdmin(c.env, user.id))) {
    return c.json(apiError('FORBIDDEN', 'You are not authorized to review identity evidence.'), 403)
  }

  const body: unknown = await c.req.json().catch(() => null)
  const reason = typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>).reason
    : null
  if (typeof reason !== 'string' || reason.trim().length < 8 || reason.trim().length > 300) {
    return c.json(apiError('REVIEW_REASON_REQUIRED', 'Enter a brief reason for opening this document.'), 400)
  }

  const document = await c.env.DB.prepare(
    `SELECT document.id, document.object_key FROM driver_application_documents AS document
       JOIN driver_applications AS application ON application.id = document.application_id
      WHERE document.id = ? AND document.application_id = ?
        AND application.retention_expires_at IS NOT NULL AND application.retention_expires_at > ?
        AND document.retention_expires_at IS NOT NULL AND document.retention_expires_at > ?
        AND document.submission_version = application.submission_version
        AND ${currentChecklistDocumentPredicate('document')} LIMIT 1`,
  )
    .bind(c.req.param('documentId'), c.req.param('applicationId'), Date.now(), Date.now())
    .first<{ id: string; object_key: string }>()
  if (!document) return c.json(apiError('NOT_FOUND', 'Driver document was not found.'), 404)

  await writeMarketplaceAudit(c.env, {
    actorUserId: user.id,
    action: 'driver_identity_document_accessed',
    targetType: 'driver_application_document',
    targetId: document.id,
    reason: reason.trim(),
  })
  const response = await readPrivateEvidence(c.env, document.object_key)
  if (!response) return c.json(apiError('PRIVATE_STORAGE_UNAVAILABLE', 'The private document is unavailable.'), 503)
  return response
})

adminDriversApp.post('/:applicationId/documents/:documentId/decision', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)
  if (!(await isMarketplaceAdmin(c.env, user.id))) {
    return c.json(apiError('FORBIDDEN', 'You are not authorized to review driver documents.'), 403)
  }

  const body: unknown = await c.req.json().catch(() => null)
  const decision = typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>).decision
    : null
  const reason = typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>).reason
    : null
  const applicantMessage = typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>).applicantMessage
    : null
  if (
    (decision !== 'approve' && decision !== 'reject') ||
    typeof reason !== 'string' || reason.trim().length < 4 || reason.trim().length > 300 ||
    (decision === 'reject' && (typeof applicantMessage !== 'string' || applicantMessage.trim().length < 4 || applicantMessage.trim().length > 300))
  ) {
    return c.json(apiError('INVALID_REVIEW', 'Choose approve or reject, enter an internal reason, and provide a driver-facing correction message when rejecting.'), 400)
  }

  const document = await c.env.DB.prepare(
    `SELECT document.id, document.review_status FROM driver_application_documents AS document
       JOIN driver_applications AS application ON application.id = document.application_id
      WHERE document.id = ? AND document.application_id = ?
        AND application.retention_expires_at IS NOT NULL AND application.retention_expires_at > ?
        AND document.retention_expires_at IS NOT NULL AND document.retention_expires_at > ?
        AND document.submission_version = application.submission_version
        AND ${currentChecklistDocumentPredicate('document')} LIMIT 1`,
  )
    .bind(c.req.param('documentId'), c.req.param('applicationId'), Date.now(), Date.now())
    .first<{ id: string; review_status: string }>()
  if (!document || document.review_status !== 'pending') {
    return c.json(apiError('INVALID_DOCUMENT_STATE', 'This document is no longer awaiting review.'), 409)
  }

  const application = await c.env.DB.prepare(
    `SELECT status FROM driver_applications WHERE id = ? LIMIT 1`,
  )
    .bind(c.req.param('applicationId'))
    .first<{ status: string }>()
  if (!application || !['pending_verification', 'needs_correction'].includes(application.status)) {
    return c.json(apiError('INVALID_APPLICATION_STATE', 'This driver application is no longer open for document review.'), 409)
  }

  const newStatus = decision === 'approve' ? 'approved' : 'rejected'
  const now = Date.now()
  const applicationReason = `A submitted verification document needs correction: ${reason.trim()}`
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE driver_application_documents
          SET review_status = ?, reviewer_reason = ?, reviewed_by = ?, reviewed_at = ?
        WHERE id = ? AND application_id = ? AND review_status = 'pending'
          AND submission_version = (SELECT submission_version FROM driver_applications WHERE id = ?)
          AND retention_expires_at IS NOT NULL AND retention_expires_at > ?
          AND ${currentChecklistDocumentPredicate('driver_application_documents')}
          AND EXISTS (SELECT 1 FROM driver_applications
                       WHERE id = ? AND retention_expires_at IS NOT NULL AND retention_expires_at > ?)`,
    ).bind(newStatus, reason.trim(), user.id, now, document.id,
      c.req.param('applicationId'), c.req.param('applicationId'), now, c.req.param('applicationId'), now),
    c.env.DB.prepare(
      `INSERT INTO marketplace_audit_events
        (id, actor_user_id, action, target_type, target_id, reason, prior_state, new_state, created_at)
       SELECT ?, ?, 'driver_document_reviewed', 'driver_application_document', ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM driver_application_documents
          WHERE id = ? AND application_id = ? AND review_status = ? AND reviewed_by = ? AND reviewed_at = ?
            AND submission_version = (SELECT submission_version FROM driver_applications WHERE id = ?)
        )`,
    ).bind(crypto.randomUUID(), user.id, document.id, reason.trim(), document.review_status, newStatus, now,
      document.id, c.req.param('applicationId'), newStatus, user.id, now, c.req.param('applicationId')),
    c.env.DB.prepare(
      `UPDATE driver_applications
          SET status = 'needs_correction', reviewer_reason = ?, applicant_message = ?,
              reviewed_by = ?, reviewed_at = ?, updated_at = ?
        WHERE changes() = 1 AND id = ? AND status = ? AND ? = 'rejected'`,
    ).bind(applicationReason, (applicantMessage as string).trim(), user.id, now, now,
      c.req.param('applicationId'), application.status, newStatus),
    c.env.DB.prepare(
      `INSERT INTO marketplace_audit_events
        (id, actor_user_id, action, target_type, target_id, reason, prior_state, new_state, created_at)
       SELECT ?, ?, 'driver_application_needs_correction', 'driver_application', ?, ?, ?, 'needs_correction', ?
        WHERE changes() = 1`,
    ).bind(crypto.randomUUID(), user.id, c.req.param('applicationId'), applicationReason, application.status, now),
  ])

  const reviewResult = await c.env.DB.prepare(
    `SELECT document.review_status FROM driver_application_documents AS document
       JOIN driver_applications AS application ON application.id = document.application_id
      WHERE document.id = ? AND document.reviewed_by = ? AND document.reviewed_at = ?
        AND document.submission_version = application.submission_version LIMIT 1`,
  ).bind(document.id, user.id, now).first<{ review_status: string }>()
  if (!reviewResult || reviewResult.review_status !== newStatus) {
    return c.json(apiError('INVALID_DOCUMENT_STATE', 'This document changed before the review could be recorded.'), 409)
  }

  return c.json({ documentId: document.id, status: newStatus })
})

adminDriversApp.post('/:applicationId/decision', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)
  if (!(await isMarketplaceAdmin(c.env, user.id))) {
    return c.json(apiError('FORBIDDEN', 'You are not authorized to review driver applications.'), 403)
  }

  const body: unknown = await c.req.json().catch(() => null)
  const decision = typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>).decision
    : null
  const reason = typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>).reason
    : null
  const applicantMessage = typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>).applicantMessage
    : null
  if (
    !['approve', 'reject', 'suspend'].includes(String(decision)) ||
    typeof reason !== 'string' || reason.trim().length < 4 || reason.trim().length > 300 ||
    (decision === 'reject' && (typeof applicantMessage !== 'string' || applicantMessage.trim().length < 4 || applicantMessage.trim().length > 300))
  ) {
    return c.json(apiError('INVALID_DECISION', 'Choose a decision, enter an internal reason, and provide a driver-facing message when rejecting.'), 400)
  }

  const applicationId = c.req.param('applicationId')
  const application = await c.env.DB.prepare(
    'SELECT id, user_id, phone_e164, citizenship_attested_at, status FROM driver_applications WHERE id = ? LIMIT 1',
  )
    .bind(applicationId)
    .first<{ id: string; user_id: string; phone_e164: string; citizenship_attested_at: number | null; status: string }>()
  if (!application) return c.json(apiError('NOT_FOUND', 'Driver application was not found.'), 404)

  const targetState = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'suspended'
  let approvalPolicyIds: string[] = []
  if (decision === 'approve') {
    const [policies, requirements, retention, documentsApproved] = await Promise.all([
      getCurrentPolicies(c.env, ['driver_terms', 'driver_privacy'], 'en'),
      getRequiredDocuments(c.env),
      c.env.DB.prepare(
        `SELECT 1 AS active FROM retention_policies
          WHERE record_type = 'driver_application' AND active = 1 AND approved_at IS NOT NULL LIMIT 1`,
      ).first<{ active: number }>(),
      hasAllRequiredDocumentsApproved(c.env, applicationId),
    ])

    const acceptance = await Promise.all(
      policies.map((document) =>
        hasCurrentPolicyAcceptance(c.env, application.user_id, document, 'driver_onboarding'),
      ),
    )
    approvalPolicyIds = policies.map((document) => document.id)
    if (
      application.citizenship_attested_at === null ||
      policies.length !== 2 || acceptance.some((value) => !value) ||
      requirements.length === 0 || !retention || !documentsApproved
    ) {
      return c.json(apiError('APPROVAL_REQUIREMENTS_INCOMPLETE', 'Confirm current policy acceptance, active checklist, retention policy, citizenship eligibility, and each required document before approval.'), 409)
    }
  }

  if (decision === 'suspend' && application.status !== 'approved') {
    return c.json(apiError('INVALID_APPLICATION_STATE', 'Only an approved driver can be suspended.'), 409)
  }

  const allowedPriorStates = decision === 'approve' || decision === 'reject'
    ? ['pending_verification', 'needs_correction', 'rejected']
    : ['approved']
  if (!allowedPriorStates.includes(application.status)) {
    return c.json(apiError('INVALID_APPLICATION_STATE', 'This application is no longer awaiting this decision.'), 409)
  }

  const now = Date.now()
  const approvalGuard = targetState === 'approved'
    ? `
          AND driver_applications.citizenship_attested_at IS NOT NULL
          AND (
            SELECT COUNT(DISTINCT acceptance.document_id)
              FROM policy_acceptances AS acceptance
              JOIN policy_documents AS policy ON policy.id = acceptance.document_id
             WHERE acceptance.user_id = driver_applications.user_id
               AND acceptance.onboarding_context = 'driver_onboarding'
               AND policy.id IN (?, ?)
               AND policy.document_type IN ('driver_terms', 'driver_privacy')
               AND policy.language = 'en'
               AND policy.status = 'approved'
               AND policy.effective_at IS NOT NULL AND policy.effective_at <= ?
               AND NOT EXISTS (
                 SELECT 1 FROM policy_documents AS newer
                  WHERE newer.document_type = policy.document_type
                    AND newer.language = policy.language
                    AND newer.status = 'approved'
                    AND newer.effective_at IS NOT NULL AND newer.effective_at <= ?
                    AND (newer.effective_at > policy.effective_at OR
                         (newer.effective_at = policy.effective_at AND newer.id > policy.id))
               )
          ) = 2
          AND EXISTS (
            SELECT 1 FROM retention_policies AS retention
             WHERE retention.record_type = 'driver_application'
               AND retention.active = 1 AND retention.approved_at IS NOT NULL
          )
          AND EXISTS (
            SELECT 1 FROM driver_verification_requirements AS requirement
             WHERE requirement.active = 1 AND requirement.required = 1
               AND requirement.approved_at IS NOT NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM driver_verification_requirements AS requirement
             WHERE requirement.active = 1 AND requirement.required = 1
               AND requirement.approved_at IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1 FROM driver_application_documents AS document
                  WHERE document.application_id = driver_applications.id
                    AND document.submission_version = driver_applications.submission_version
                    AND document.document_type = requirement.document_type
                    AND document.requirement_version = requirement.version
                    AND document.review_status = 'approved'
                    AND document.retention_expires_at IS NOT NULL
                    AND document.retention_expires_at > ?
               )
          )
          AND (
            SELECT COUNT(DISTINCT document.document_type)
              FROM driver_application_documents AS document
             WHERE document.application_id = driver_applications.id
               AND document.submission_version = driver_applications.submission_version
               AND document.review_status = 'approved'
               AND document.retention_expires_at IS NOT NULL
               AND document.retention_expires_at > ?
               AND document.document_type IN ('national_id_front', 'national_id_back', 'passport_photo')
          ) = 3`
    : ''
  const approvalGuardBindings = targetState === 'approved'
    ? [...approvalPolicyIds, now, now, now, now]
    : []
  const result = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE driver_applications
          SET status = ?, reviewer_reason = ?, applicant_message = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
        WHERE id = ? AND status = ?
          AND (? != 'approved' OR (retention_expires_at IS NOT NULL AND retention_expires_at > ?))
          ${approvalGuard}`,
    ).bind(targetState, reason.trim(), decision === 'reject' ? (applicantMessage as string).trim() : null,
      user.id, now, now, applicationId, application.status, targetState, now,
      ...approvalGuardBindings),
    c.env.DB.prepare(
      `INSERT INTO marketplace_audit_events
        (id, actor_user_id, action, target_type, target_id, reason, prior_state, new_state, created_at)
       SELECT ?, ?, 'driver_application_decision', 'driver_application', ?, ?, ?, ?, ?
        WHERE changes() = 1`,
    ).bind(crypto.randomUUID(), user.id, applicationId, reason.trim(), application.status, targetState, now),
  ])
  if ((result[0]?.meta.changes ?? 0) !== 1) {
    return c.json(apiError('INVALID_APPLICATION_STATE', 'This application changed before the decision could be recorded.'), 409)
  }

  return c.json({ applicationId, status: targetState, decidedAt: now })
})

export { adminDriversApp, driversApp }

export async function purgeExpiredDriverEvidence(env: AuthBindings): Promise<number> {
  if (!env.DRIVER_FILES) return 0
  const now = Date.now()
  const expiredDocuments = await env.DB.prepare(
    `SELECT document.id, document.application_id, document.object_key
       FROM driver_application_documents AS document
       JOIN driver_applications AS application ON application.id = document.application_id
      WHERE document.retention_expires_at <= ? OR application.retention_expires_at <= ?
      ORDER BY COALESCE(document.retention_expires_at, application.retention_expires_at) ASC
      LIMIT 100`,
  ).bind(now, now).all<{ id: string; application_id: string; object_key: string }>()

  let purged = 0
  for (const document of expiredDocuments.results) {
    try {
      await env.DRIVER_FILES.delete(document.object_key)
      const deletedAt = Date.now()
      const result = await env.DB.batch([
        env.DB.prepare(
          `DELETE FROM driver_application_documents
            WHERE id = ? AND (retention_expires_at <= ? OR EXISTS (
              SELECT 1 FROM driver_applications
               WHERE id = ? AND retention_expires_at <= ?
            ))`,
        ).bind(document.id, deletedAt, document.application_id, deletedAt),
        env.DB.prepare(
          `INSERT INTO marketplace_audit_events
            (id, actor_user_id, actor_type, action, target_type, target_id, reason,
             prior_state, new_state, created_at)
           SELECT ?, NULL, 'system', 'driver_document_retention_expired',
                  'driver_application_document', ?,
                  'Superseded or expired private driver evidence was deleted.',
                  'stored', 'deleted', ?
            WHERE changes() = 1`,
        ).bind(crypto.randomUUID(), document.id, deletedAt),
      ])
      purged += result[0]?.meta.changes === 1 ? 1 : 0
    } catch {
      // Keep the row and expiry so the next scheduled run retries deletion.
    }
  }

  const expiredApplications = await env.DB.prepare(
    `SELECT id FROM driver_applications
      WHERE retention_expires_at IS NOT NULL AND retention_expires_at <= ?
      ORDER BY retention_expires_at ASC LIMIT 50`,
  ).bind(now).all<{ id: string }>()

  for (const application of expiredApplications.results) {
    const documents = await env.DB.prepare(
      `SELECT id, object_key FROM driver_application_documents
        WHERE application_id = ? AND (retention_expires_at <= ? OR EXISTS (
          SELECT 1 FROM driver_applications
           WHERE id = ? AND retention_expires_at <= ?
        ))`,
    ).bind(application.id, now, application.id, now).all<{ id: string; object_key: string }>()

    try {
      if (documents.results.length > 0) {
        await env.DRIVER_FILES.delete(documents.results.map((document) => document.object_key))
      }
      const now = Date.now()
      await env.DB.batch([
        ...documents.results.map((document) => env.DB.prepare(
          'DELETE FROM driver_application_documents WHERE id = ? AND application_id = ?',
        ).bind(document.id, application.id)),
        env.DB.prepare(
          `UPDATE driver_applications
              SET national_id_number = '', national_id_last4 = '',
                  status = CASE WHEN status = 'pending_verification' THEN 'needs_correction' ELSE status END,
                  reviewer_reason = CASE WHEN status = 'pending_verification'
                    THEN 'Identity evidence expired under the approved retention policy.' ELSE reviewer_reason END,
                  applicant_message = CASE
                    WHEN status = 'pending_verification'
                      THEN 'Your submitted identity evidence reached its retention deadline before review. Submit a new application with current identity details and documents.'
                    WHEN status = 'needs_correction'
                      THEN COALESCE(applicant_message || ' ', '') || 'Identity evidence reached its retention deadline; upload the required current files again.'
                    ELSE applicant_message END,
                  retention_expires_at = NULL,
                  updated_at = ?
            WHERE id = ? AND retention_expires_at IS NOT NULL AND retention_expires_at <= ?`,
        ).bind(now, application.id, now),
        env.DB.prepare(
          `INSERT INTO marketplace_audit_events
            (id, actor_user_id, actor_type, action, target_type, target_id, reason,
             prior_state, new_state, created_at)
           SELECT ?, NULL, 'system', 'driver_identity_evidence_retention_expired',
                  'driver_application', ?,
                  'Approved retention period elapsed; private ID evidence and submitted ID number were deleted.',
                  NULL, 'redacted', ?
            WHERE changes() > 0`,
        ).bind(crypto.randomUUID(), application.id, now),
      ])
      purged += 1
    } catch {
      // Keep the retention deadline intact so the next scheduled run retries deletion.
    }
  }

  return purged
}
