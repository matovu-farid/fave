import { Hono } from 'hono'
import type { AuthBindings } from './auth'
import {
  apiError,
  getSignedInUser,
} from './marketplace-auth'

export type CurrentPolicyDocument = {
  id: string
  document_type: string
  version: string
  language: string
  body: string
}

export async function getCurrentPolicies(
  env: AuthBindings,
  documentTypes: string[],
  language: string,
): Promise<CurrentPolicyDocument[]> {
  const now = Date.now()
  const result = await env.DB.prepare(
    `SELECT id, document_type, version, language, body
       FROM policy_documents
      WHERE document_type IN (${documentTypes.map(() => '?').join(', ')})
        AND language = ?
        AND status = 'approved'
        AND effective_at IS NOT NULL
        AND effective_at <= ?
      ORDER BY effective_at DESC, id DESC`,
  )
    .bind(...documentTypes, language, now)
    .all<CurrentPolicyDocument>()

  const current = new Map<string, CurrentPolicyDocument>()
  for (const document of result.results) {
    if (!current.has(document.document_type)) {
      current.set(document.document_type, document)
    }
  }

  return [...current.values()]
}

export async function hasCurrentPolicyAcceptance(
  env: AuthBindings,
  userId: string,
  document: CurrentPolicyDocument,
  onboardingContext: string,
): Promise<boolean> {
  const acceptance = await env.DB.prepare(
    `SELECT 1 AS accepted
       FROM policy_acceptances
      WHERE user_id = ? AND document_id = ? AND onboarding_context = ?
      LIMIT 1`,
  )
    .bind(userId, document.id, onboardingContext)
    .first<{ accepted: number }>()

  return acceptance !== null
}

export type VerifiedPhone = {
  phone_e164: string
  verified_at: number
  method: string
}

export async function getVerifiedPhone(
  env: AuthBindings,
  userId: string,
): Promise<VerifiedPhone | null> {
  return env.DB.prepare(
    'SELECT phone_e164, verified_at, method FROM phone_verifications WHERE user_id = ? LIMIT 1',
  )
    .bind(userId)
    .first<VerifiedPhone>()
}

const policiesApp = new Hono<{ Bindings: AuthBindings }>()

policiesApp.get('/driver-prerequisites', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)

  const language = c.req.query('language')?.slice(0, 16) || 'en'
  const [documents, requirements, retentionPolicy, phone] = await Promise.all([
    getCurrentPolicies(c.env, ['driver_terms', 'driver_privacy'], language),
    c.env.DB.prepare(
      `SELECT document_type, version, required
         FROM driver_verification_requirements
        WHERE active = 1 AND required = 1 AND approved_at IS NOT NULL
        ORDER BY document_type`,
    ).all<{ document_type: string; version: string; required: number }>(),
    c.env.DB.prepare(
      `SELECT version, retention_days
         FROM retention_policies
        WHERE record_type = 'driver_application' AND active = 1 AND approved_at IS NOT NULL
        ORDER BY approved_at DESC LIMIT 1`,
    ).first<{ version: string; retention_days: number }>(),
    getVerifiedPhone(c.env, user.id),
  ])

  const acceptedIds = await c.env.DB.prepare(
    `SELECT document_id FROM policy_acceptances
      WHERE user_id = ? AND onboarding_context = 'driver_onboarding'`,
  )
    .bind(user.id)
    .all<{ document_id: string }>()
  const accepted = new Set(acceptedIds.results.map((row) => row.document_id))

  return c.json({
    documents: documents.map((document) => ({
      id: document.id,
      type: document.document_type,
      version: document.version,
      language: document.language,
      body: document.body,
      accepted: accepted.has(document.id),
    })),
    phone: phone
      ? {
          verified: true,
          number: phone.phone_e164,
          verifiedAt: phone.verified_at,
          method: phone.method,
        }
      : { verified: false },
    verificationChecklist: requirements.results,
    retentionPolicy: retentionPolicy
      ? {
          active: true,
          version: retentionPolicy.version,
          retentionDays: retentionPolicy.retention_days,
        }
      : { active: false },
    readyToApply:
      documents.length === 2 &&
      phone !== null &&
      requirements.results.length > 0 &&
      retentionPolicy !== null,
  })
})

policiesApp.post('/driver-policy-acceptance', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)

  const body: unknown = await c.req.json().catch(() => null)
  if (
    typeof body !== 'object' ||
    body === null ||
    Array.isArray(body) ||
    (body as Record<string, unknown>).accepted !== true ||
    !Array.isArray((body as Record<string, unknown>).documentIds)
  ) {
    return c.json(apiError('INVALID_ACCEPTANCE', 'Review and accept the current documents to continue.'), 400)
  }

  const documentIds = (body as { documentIds: unknown[] }).documentIds
  if (
    documentIds.length !== 2 ||
    documentIds.some((id) => typeof id !== 'string' || id.length > 80)
  ) {
    return c.json(apiError('INVALID_ACCEPTANCE', 'The current driver documents are required.'), 400)
  }

  const documents = await getCurrentPolicies(c.env, ['driver_terms', 'driver_privacy'], 'en')
  const expectedIds = new Set(documents.map((document) => document.id))
  const suppliedIds = new Set(documentIds as string[])
  if (
    documents.length !== 2 ||
    suppliedIds.size !== documentIds.length ||
    suppliedIds.size !== expectedIds.size ||
    [...expectedIds].some((id) => !suppliedIds.has(id))
  ) {
    return c.json(
      apiError('POLICY_UNAVAILABLE', 'Current driver terms and privacy notice are not available.'),
      409,
    )
  }

  const acceptedAt = Date.now()
  const statements = documents.map((document) =>
    c.env.DB.prepare(
      `INSERT INTO policy_acceptances (id, user_id, document_id, onboarding_context, accepted_at)
       SELECT ?, ?, ?, 'driver_onboarding', ?
        WHERE EXISTS (
          SELECT 1 FROM policy_documents
           WHERE id = ? AND status = 'approved' AND effective_at <= ?
        )`,
    ).bind(crypto.randomUUID(), user.id, document.id, acceptedAt, document.id, acceptedAt),
  )
  const auditStatement = c.env.DB.prepare(
    `INSERT INTO marketplace_audit_events
      (id, actor_user_id, actor_type, action, target_type, target_id, reason, created_at)
     SELECT ?, ?, 'user', 'driver_policy_acceptance_recorded', 'user', ?,
            'Driver accepted the current terms and privacy notice.', ?
      WHERE (SELECT COUNT(DISTINCT acceptance.document_id)
               FROM policy_acceptances AS acceptance
               JOIN policy_documents AS document ON document.id = acceptance.document_id
              WHERE acceptance.user_id = ?
                AND acceptance.onboarding_context = 'driver_onboarding'
                AND acceptance.accepted_at = ?
                AND acceptance.document_id IN (?, ?)
                AND document.status = 'approved'
                AND document.effective_at IS NOT NULL
                AND document.effective_at <= ?) = 2`,
  ).bind(
    crypto.randomUUID(),
    user.id,
    user.id,
    acceptedAt,
    user.id,
    acceptedAt,
    documents[0].id,
    documents[1].id,
    acceptedAt,
  )

  try {
    const result = await c.env.DB.batch([...statements, auditStatement])
    if ((result[result.length - 1]?.meta.changes ?? 0) !== 1) {
      return c.json(apiError('POLICY_UNAVAILABLE', 'Current driver documents changed before acceptance could be recorded.'), 409)
    }
  } catch {
    return c.json(apiError('POLICY_UNAVAILABLE', 'Could not record document acceptance.'), 409)
  }

  return c.json({ accepted: true, acceptedAt })
})

policiesApp.get('/client-prerequisites', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)

  const language = c.req.query('language')?.slice(0, 16) || 'en'
  const [onboardingDocuments, bookingDocuments, profile, phone] = await Promise.all([
    getCurrentPolicies(c.env, ['client_terms', 'client_privacy'], language),
    getCurrentPolicies(
      c.env,
      ['client_terms', 'client_privacy', 'booking_policy', 'payment_policy', 'cancellation_policy', 'safety_policy'],
      language,
    ),
    c.env.DB.prepare(
      `SELECT legal_name, phone_e164 FROM client_profiles WHERE user_id = ? LIMIT 1`,
    )
      .bind(user.id)
      .first<{ legal_name: string; phone_e164: string }>(),
    getVerifiedPhone(c.env, user.id),
  ])

  const acceptances = await c.env.DB.prepare(
    `SELECT document_id FROM policy_acceptances
      WHERE user_id = ? AND onboarding_context = 'client_onboarding'`,
  )
    .bind(user.id)
    .all<{ document_id: string }>()
  const acceptedIds = new Set(acceptances.results.map((row) => row.document_id))

  return c.json({
    documents: onboardingDocuments.map((document) => ({
      id: document.id,
      type: document.document_type,
      version: document.version,
      language: document.language,
      body: document.body,
      accepted: acceptedIds.has(document.id),
    })),
    bookingDocuments: bookingDocuments.map((document) => ({
      id: document.id,
      type: document.document_type,
      version: document.version,
      language: document.language,
      body: document.body,
    })),
    profile: profile
      ? { legalName: profile.legal_name, phoneNumber: profile.phone_e164 }
      : null,
    phone: phone
      ? { verified: true, number: phone.phone_e164, verifiedAt: phone.verified_at, method: phone.method }
      : { verified: false },
    bookingReady:
      onboardingDocuments.length === 2 &&
      bookingDocuments.length === 6 &&
      profile !== null &&
      phone !== null &&
      phone.phone_e164 === profile.phone_e164,
  })
})

policiesApp.post('/client-profile', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)

  const body: unknown = await c.req.json().catch(() => null)
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return c.json(apiError('INVALID_PROFILE', 'Enter your name and phone number.'), 400)
  }
  const input = body as Record<string, unknown>
  const legalName = input.legalName
  const phoneNumber = input.phoneNumber
  const documentIds = input.acceptedDocumentIds
  if (
    typeof legalName !== 'string' || legalName.trim().length < 2 || legalName.trim().length > 160 ||
    typeof phoneNumber !== 'string' || !/^\+[1-9]\d{7,14}$/u.test(phoneNumber) ||
    input.accepted !== true || !Array.isArray(documentIds) || documentIds.length !== 2 ||
    documentIds.some((id) => typeof id !== 'string' || id.length > 80)
  ) {
    return c.json(apiError('INVALID_PROFILE', 'Enter a valid name and phone number, then accept both current documents.'), 400)
  }

  const documents = await getCurrentPolicies(c.env, ['client_terms', 'client_privacy'], 'en')
  const currentIds = new Set(documents.map((document) => document.id))
  const suppliedIds = new Set(documentIds as string[])
  if (
    documents.length !== 2 || suppliedIds.size !== documentIds.length ||
    suppliedIds.size !== currentIds.size || [...currentIds].some((id) => !suppliedIds.has(id))
  ) {
    return c.json(apiError('POLICY_UNAVAILABLE', 'Current client terms and privacy notice are not available.'), 409)
  }

  const now = Date.now()
  const name = legalName.trim().replace(/\s+/gu, ' ')
  const insertProfile = c.env.DB.prepare(
    `INSERT INTO client_profiles (user_id, legal_name, phone_e164, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       legal_name = excluded.legal_name,
       phone_e164 = excluded.phone_e164,
       updated_at = excluded.updated_at`,
  ).bind(user.id, name, phoneNumber, now, now)
  const acceptances = documents.map((document) =>
    c.env.DB.prepare(
      `INSERT INTO policy_acceptances (id, user_id, document_id, onboarding_context, accepted_at)
       SELECT ?, ?, ?, 'client_onboarding', ?
        WHERE EXISTS (
          SELECT 1 FROM policy_documents
           WHERE id = ? AND status = 'approved' AND effective_at <= ?
        )`,
    ).bind(crypto.randomUUID(), user.id, document.id, now, document.id, now),
  )

  await c.env.DB.batch([
    insertProfile,
    ...acceptances,
    c.env.DB.prepare(
      `INSERT INTO marketplace_audit_events
        (id, actor_user_id, actor_type, action, target_type, target_id, created_at)
       VALUES (?, ?, 'user', 'client_profile_updated', 'user', ?, ?)`,
    ).bind(crypto.randomUUID(), user.id, user.id, now),
  ])
  return c.json({ legalName: name, phoneNumber, phoneVerified: false })
})

export default policiesApp
