import { Hono } from 'hono'
import type { AuthBindings } from './auth'
import { approvedDriverEvidencePredicate } from './drivers'
import {
  apiError,
  getSignedInUser,
  isMarketplaceAdmin,
  writeMarketplaceAudit,
} from './marketplace-auth'
import { readPrivateEvidence, readPublicVehiclePhoto, storePrivateEvidence, storePublicVehiclePhoto } from './private-files'

type VehicleStatus = 'draft' | 'pending_review' | 'needs_correction' | 'approved' | 'rejected' | 'suspended'
type VehicleRecord = {
  id: string
  driver_application_id: string
  make: string
  model: string
  model_year: number
  passenger_capacity: number
  luggage_capacity: number
  comfort_details: string
  accessibility_details: string
  registration_number: string
  status: VehicleStatus
  reviewer_reason: string | null
  applicant_message?: string | null
}
type FormEntryValue = string | File
const allowedVehicleEvidenceTypes = new Set([
  'registration_document', 'ownership_document', 'roadworthiness_document',
  'insurance_document', 'other_document',
])

function currentVehicleRequirementPredicate(mediaAlias: string): string {
  return `(
    ${mediaAlias}.media_kind = 'client_photo'
    OR EXISTS (
      SELECT 1 FROM vehicle_verification_requirements AS requirement
       WHERE requirement.evidence_type = ${mediaAlias}.media_kind
         AND requirement.version = ${mediaAlias}.requirement_version
         AND requirement.active = 1 AND requirement.required = 1
         AND requirement.approved_at IS NOT NULL
    )
  )`
}

const vehiclesApp = new Hono<{ Bindings: AuthBindings }>()
const adminVehiclesApp = new Hono<{ Bindings: AuthBindings }>()

export function approvedVehicleEvidencePredicate(vehicleAlias: string): string {
  return `${approvedDriverEvidencePredicate(`${vehicleAlias}.driver_application_id`)}
    AND EXISTS (
      SELECT 1 FROM vehicle_verification_requirements AS requirement
       WHERE requirement.active = 1 AND requirement.required = 1
         AND requirement.approved_at IS NOT NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM vehicle_verification_requirements AS requirement
       WHERE requirement.active = 1 AND requirement.required = 1
         AND requirement.approved_at IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM vehicle_media AS evidence
            WHERE evidence.vehicle_id = ${vehicleAlias}.id
              AND evidence.media_kind = requirement.evidence_type
              AND evidence.requirement_version = requirement.version
              AND evidence.review_status = 'approved'
              AND evidence.retention_expires_at IS NOT NULL
              AND evidence.retention_expires_at > ?
         )
    )
    AND (SELECT COUNT(*) FROM vehicle_media AS photo
          WHERE photo.vehicle_id = ${vehicleAlias}.id
            AND photo.media_kind = 'client_photo'
            AND photo.review_status = 'approved') >= 2`
}

vehiclesApp.get('/requirements', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)
  const [requirements, retention] = await Promise.all([
    c.env.DB.prepare(
      `SELECT evidence_type, version FROM vehicle_verification_requirements
        WHERE active = 1 AND required = 1 AND approved_at IS NOT NULL ORDER BY evidence_type`,
    ).all<{ evidence_type: string; version: string }>(),
    c.env.DB.prepare(
      `SELECT version, retention_days FROM retention_policies
        WHERE record_type = 'vehicle_evidence' AND active = 1 AND approved_at IS NOT NULL
        ORDER BY approved_at DESC LIMIT 1`,
    ).first<{ version: string; retention_days: number }>(),
  ])
  const checklistValid = requirements.results.length > 0 &&
    requirements.results.length <= allowedVehicleEvidenceTypes.size &&
    requirements.results.every((item) => allowedVehicleEvidenceTypes.has(item.evidence_type))
  return c.json({
    requirements: requirements.results,
    retentionPolicy: retention ? { active: true, ...retention } : { active: false },
    readyToList: checklistValid && retention !== null,
  })
})

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function kampalaToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Kampala', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function dateSpan(startDate: string, endDate: string): number {
  return (Date.parse(`${endDate}T00:00:00.000Z`) - Date.parse(`${startDate}T00:00:00.000Z`)) / 86_400_000
}

function isUpload(value: FormEntryValue): value is File {
  return typeof value !== 'string' && typeof value.stream === 'function'
}

async function getApprovedApplication(
  env: AuthBindings,
  userId: string,
): Promise<{ id: string } | null> {
  return env.DB.prepare(
    `SELECT id FROM driver_applications
      WHERE user_id = ? AND ${approvedDriverEvidencePredicate('driver_applications.id')}
      LIMIT 1`,
  )
    .bind(userId, Date.now(), Date.now(), Date.now(), Date.now(), Date.now())
    .first<{ id: string }>()
}

async function getVehicle(
  env: AuthBindings,
  vehicleId: string,
): Promise<VehicleRecord | null> {
  return env.DB.prepare(
    `SELECT id, driver_application_id, make, model, model_year, passenger_capacity,
            luggage_capacity, comfort_details, accessibility_details, registration_number,
            status, reviewer_reason, applicant_message
       FROM vehicles WHERE id = ? LIMIT 1`,
  )
    .bind(vehicleId)
    .first<VehicleRecord>()
}

async function canManageVehicle(
  env: AuthBindings,
  vehicle: VehicleRecord,
  userId: string,
): Promise<boolean> {
  const owner = await env.DB.prepare(
    `SELECT 1 AS allowed FROM driver_applications
      WHERE id = ? AND user_id = ?
        AND ${approvedDriverEvidencePredicate('driver_applications.id')}
      LIMIT 1`,
  )
    .bind(
      vehicle.driver_application_id,
      userId,
      Date.now(),
      Date.now(),
      Date.now(),
      Date.now(),
      Date.now(),
    )
    .first<{ allowed: number }>()
  return owner !== null
}

async function getVehicleEvidenceReady(
  env: AuthBindings,
  vehicleId: string,
): Promise<boolean> {
  const missing = await env.DB.prepare(
    `SELECT 1 AS missing
       FROM vehicle_verification_requirements AS requirement
      WHERE requirement.active = 1 AND requirement.required = 1
        AND requirement.approved_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM vehicle_media AS evidence
           WHERE evidence.vehicle_id = ?
             AND evidence.media_kind = requirement.evidence_type
             AND evidence.requirement_version = requirement.version
             AND evidence.review_status = 'approved'
             AND evidence.retention_expires_at IS NOT NULL
             AND evidence.retention_expires_at > ?
        )
      LIMIT 1`,
  )
    .bind(vehicleId, Date.now())
    .first<{ missing: number }>()

  const approvedPhotos = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM vehicle_media
      WHERE vehicle_id = ? AND media_kind = 'client_photo' AND review_status = 'approved'`,
  )
    .bind(vehicleId)
    .first<{ count: number }>()

  const activeChecklist = await env.DB.prepare(
    `SELECT 1 AS active FROM vehicle_verification_requirements
      WHERE active = 1 AND required = 1 AND approved_at IS NOT NULL LIMIT 1`,
  ).first<{ active: number }>()

  return missing === null && activeChecklist !== null && (approvedPhotos?.count ?? 0) >= 2
}

function safeVehicle(vehicle: VehicleRecord) {
  return {
    id: vehicle.id,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.model_year,
    passengerCapacity: vehicle.passenger_capacity,
    luggageCapacity: vehicle.luggage_capacity,
    comfortDetails: vehicle.comfort_details,
    accessibilityDetails: vehicle.accessibility_details,
  }
}

vehiclesApp.get('/mine', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)

  const application = await c.env.DB.prepare(
    `SELECT id FROM driver_applications WHERE user_id = ? LIMIT 1`,
  )
    .bind(user.id)
    .first<{ id: string }>()
  if (!application) return c.json({ vehicles: [] })

  const vehicles = await c.env.DB.prepare(
    `SELECT id, driver_application_id, make, model, model_year, passenger_capacity,
            luggage_capacity, comfort_details, accessibility_details, registration_number,
            status, reviewer_reason, applicant_message
       FROM vehicles WHERE driver_application_id = ? ORDER BY created_at DESC`,
  )
    .bind(application.id)
    .all<VehicleRecord>()

  const listing = await Promise.all(
    vehicles.results.map(async (vehicle) => {
      const media = await c.env.DB.prepare(
        `SELECT id, media_kind, requirement_version, review_status, reviewer_reason, applicant_message, retention_expires_at, created_at
           FROM vehicle_media WHERE vehicle_id = ? ORDER BY created_at DESC`,
      )
        .bind(vehicle.id)
        .all<{
          id: string
          media_kind: string
          requirement_version: string | null
          review_status: string
          reviewer_reason: string | null
          applicant_message: string | null
          retention_expires_at: number | null
          created_at: number
        }>()

      return {
        ...safeVehicle(vehicle),
        registrationNumber: vehicle.registration_number,
        status: vehicle.status,
        applicantMessage: vehicle.applicant_message,
        media: media.results.map((item) => ({
          id: item.id,
          type: item.media_kind,
          requirementVersion: item.requirement_version,
          status: item.review_status,
          applicantMessage: item.applicant_message,
          retentionExpiresAt: item.retention_expires_at,
          submittedAt: item.created_at,
        })),
      }
    }),
  )

  return c.json({ vehicles: listing })
})

vehiclesApp.post('/', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)
  if (!c.env.DRIVER_FILES) {
    return c.json(apiError('PRIVATE_STORAGE_UNAVAILABLE', 'Vehicle evidence storage is not configured.'), 503)
  }
  const application = await getApprovedApplication(c.env, user.id)
  if (!application) {
    return c.json(apiError('DRIVER_NOT_APPROVED', 'Only approved drivers can list a vehicle.'), 403)
  }

  const form = await c.req.formData().catch(() => null)
  if (!form) return c.json(apiError('INVALID_VEHICLE', 'Submit the vehicle details and photos.'), 400)
  const textField = (key: string) => form.get(key)
  const make = textField('make')
  const model = textField('model')
  const yearText = textField('year')
  const passengersText = textField('passengerCapacity')
  const luggageText = textField('luggageCapacity')
  const comfort = textField('comfortDetails')
  const accessibility = textField('accessibilityDetails')
  const registration = textField('registrationNumber')
  const modelYear = typeof yearText === 'string' ? Number(yearText) : Number.NaN
  const passengerCapacity = typeof passengersText === 'string' ? Number(passengersText) : Number.NaN
  const luggageCapacity = typeof luggageText === 'string' ? Number(luggageText) : Number.NaN

  if (
    typeof make !== 'string' || make.trim().length < 2 || make.trim().length > 80 ||
    typeof model !== 'string' || model.trim().length < 1 || model.trim().length > 80 ||
    !Number.isInteger(modelYear) || modelYear < 1980 || modelYear > new Date().getUTCFullYear() + 1 ||
    !Number.isInteger(passengerCapacity) || passengerCapacity < 1 || passengerCapacity > 20 ||
    !Number.isInteger(luggageCapacity) || luggageCapacity < 0 || luggageCapacity > 20 ||
    typeof comfort !== 'string' || comfort.trim().length < 3 || comfort.trim().length > 500 ||
    typeof accessibility !== 'string' || accessibility.trim().length > 500 ||
    typeof registration !== 'string' || registration.trim().length < 3 || registration.trim().length > 40
  ) {
    return c.json(apiError('INVALID_VEHICLE', 'Check the make, model, year, capacity, comfort, accessibility, and registration details.'), 400)
  }

  const activeRequirements = await c.env.DB.prepare(
    `SELECT evidence_type, version FROM vehicle_verification_requirements
      WHERE active = 1 AND required = 1 AND approved_at IS NOT NULL`,
  ).all<{ evidence_type: string; version: string }>()
  if (activeRequirements.results.length === 0) {
    return c.json(apiError('VEHICLE_CHECKLIST_UNAVAILABLE', 'The approved vehicle evidence checklist is not available yet.'), 409)
  }
  if (activeRequirements.results.length > allowedVehicleEvidenceTypes.size ||
      activeRequirements.results.some((item) => !allowedVehicleEvidenceTypes.has(item.evidence_type))) {
    return c.json(apiError('VEHICLE_CHECKLIST_INVALID', 'The vehicle evidence checklist contains unsupported document types.'), 409)
  }
  const retentionPolicy = await c.env.DB.prepare(
    `SELECT id, retention_days FROM retention_policies
      WHERE record_type = 'vehicle_evidence' AND active = 1 AND approved_at IS NOT NULL
      ORDER BY approved_at DESC LIMIT 1`,
  ).first<{ id: string; retention_days: number }>()
  if (!retentionPolicy) {
    return c.json(apiError('VEHICLE_POLICY_UNAVAILABLE', 'An approved vehicle evidence retention policy is not available yet.'), 409)
  }

  const photos: File[] = []
  const evidenceFiles = new Map<string, File>()
  for (const [key, value] of form.entries()) {
    if (key === 'photo' && isUpload(value)) photos.push(value)
    if (key.startsWith('evidence:')) {
      const evidenceType = key.slice('evidence:'.length)
      if (
        !activeRequirements.results.some((requirement) => requirement.evidence_type === evidenceType) ||
        !isUpload(value) || evidenceFiles.has(evidenceType)
      ) {
        return c.json(apiError('INVALID_VEHICLE_EVIDENCE', 'Upload each required vehicle document once.'), 400)
      }
      evidenceFiles.set(evidenceType, value)
    }
  }

  if (
    photos.length < 2 || photos.length > 8 ||
    activeRequirements.results.some((requirement) => !evidenceFiles.has(requirement.evidence_type))
  ) {
    return c.json(apiError('VEHICLE_EVIDENCE_REQUIRED', 'Upload between two and eight current vehicle photos and every required vehicle document.'), 400)
  }

  const vehicleId = crypto.randomUUID()
  const stored: Array<{
    id: string
    mediaKind: string
    requirementVersion: string | null
    objectKey: string
    contentType: string
    byteSize: number
  }> = []
  for (const photo of photos) {
    let file: Awaited<ReturnType<typeof storePublicVehiclePhoto>>
    try {
      file = await storePublicVehiclePhoto(c.env, photo)
    } catch {
      await Promise.all(stored.map((item) => c.env.DRIVER_FILES?.delete(item.objectKey)))
      return c.json(apiError('PRIVATE_STORAGE_UNAVAILABLE', 'Could not store vehicle photos. Try again.'), 503)
    }
    if (!file) {
      await Promise.all(stored.map((item) => c.env.DRIVER_FILES?.delete(item.objectKey)))
      return c.json(apiError('INVALID_PHOTO', 'Photos must be JPEG, PNG, or WebP images smaller than 8 MB.'), 400)
    }
    stored.push({ id: crypto.randomUUID(), mediaKind: 'client_photo', requirementVersion: null, ...file })
  }
  for (const [evidenceType, photo] of evidenceFiles) {
    let file: Awaited<ReturnType<typeof storePrivateEvidence>>
    try {
      file = await storePrivateEvidence(c.env, 'vehicle-documents', photo)
    } catch {
      await Promise.all(stored.map((item) => c.env.DRIVER_FILES?.delete(item.objectKey)))
      return c.json(apiError('PRIVATE_STORAGE_UNAVAILABLE', 'Could not store vehicle evidence. Try again.'), 503)
    }
    if (!file) {
      await Promise.all(stored.map((item) => c.env.DRIVER_FILES?.delete(item.objectKey)))
      return c.json(apiError('INVALID_VEHICLE_EVIDENCE', 'Vehicle documents must be JPEG, PNG, WebP, or PDF files smaller than 8 MB.'), 400)
    }
    stored.push({
      id: crypto.randomUUID(),
      mediaKind: evidenceType,
      requirementVersion: activeRequirements.results.find((requirement) => requirement.evidence_type === evidenceType)?.version ?? null,
      ...file,
    })
  }

  const now = Date.now()
  const evidenceExpiresAt = now + retentionPolicy.retention_days * 86_400_000
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO vehicles
          (id, driver_application_id, make, model, model_year, passenger_capacity,
           luggage_capacity, comfort_details, accessibility_details, registration_number,
           status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', ?, ?)`,
      ).bind(
        vehicleId,
        application.id,
        make.trim(),
        model.trim(),
        modelYear,
        passengerCapacity,
        luggageCapacity,
        comfort.trim(),
        accessibility.trim(),
        registration.trim().toUpperCase(),
        now,
        now,
      ),
      ...stored.map((item) =>
        c.env.DB.prepare(
          `INSERT INTO vehicle_media
            (id, vehicle_id, media_kind, object_key, content_type, byte_size,
             retention_policy_id, retention_expires_at, requirement_version, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          item.id,
          vehicleId,
          item.mediaKind,
          item.objectKey,
          item.contentType,
          item.byteSize,
          item.mediaKind === 'client_photo' ? null : retentionPolicy.id,
          item.mediaKind === 'client_photo' ? null : evidenceExpiresAt,
          item.requirementVersion,
          now,
        ),
      ),
      c.env.DB.prepare(
        `INSERT INTO marketplace_audit_events
          (id, actor_user_id, actor_type, action, target_type, target_id,
           new_state, created_at)
         VALUES (?, ?, 'user', 'vehicle_submitted_for_review', 'vehicle', ?, 'pending_review', ?)`,
      ).bind(crypto.randomUUID(), user.id, vehicleId, now),
    ])
  } catch {
    await Promise.all(stored.map((item) => c.env.DRIVER_FILES?.delete(item.objectKey)))
    return c.json(apiError('VEHICLE_SAVE_FAILED', 'We could not save this listing. Try again.'), 503)
  }

  return c.json({ vehicleId, status: 'pending_review' }, 201)
})

vehiclesApp.post('/:vehicleId/corrections', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)
  if (!c.env.DRIVER_FILES) {
    return c.json(apiError('PRIVATE_STORAGE_UNAVAILABLE', 'Vehicle evidence storage is not configured.'), 503)
  }
  const vehicle = await getVehicle(c.env, c.req.param('vehicleId'))
  if (!vehicle || !(await canManageVehicle(c.env, vehicle, user.id))) {
    return c.json(apiError('NOT_FOUND', 'Vehicle listing was not found.'), 404)
  }
  const evidenceReady = vehicle.status === 'approved'
    ? await getVehicleEvidenceReady(c.env, vehicle.id)
    : false
  if (!['pending_review', 'needs_correction', 'rejected'].includes(vehicle.status) &&
      !(vehicle.status === 'approved' && !evidenceReady)) {
    return c.json(apiError('INVALID_VEHICLE_STATE', 'This listing is not open for review corrections.'), 409)
  }

  const form = await c.req.formData().catch(() => null)
  if (!form) return c.json(apiError('INVALID_CORRECTION', 'Upload replacement photos or vehicle evidence.'), 400)
  const requirements = await c.env.DB.prepare(
    `SELECT evidence_type, version FROM vehicle_verification_requirements
      WHERE active = 1 AND required = 1 AND approved_at IS NOT NULL`,
  ).all<{ evidence_type: string; version: string }>()
  const retentionPolicy = await c.env.DB.prepare(
    `SELECT id, retention_days FROM retention_policies
      WHERE record_type = 'vehicle_evidence' AND active = 1 AND approved_at IS NOT NULL
      ORDER BY approved_at DESC LIMIT 1`,
  ).first<{ id: string; retention_days: number }>()
  if (!retentionPolicy) {
    return c.json(apiError('VEHICLE_POLICY_UNAVAILABLE', 'An approved vehicle evidence retention policy is not available yet.'), 409)
  }
  const allowedEvidence = new Set(requirements.results.map((item) => item.evidence_type))
  if (requirements.results.length === 0 || [...allowedEvidence].some((type) => !allowedVehicleEvidenceTypes.has(type))) {
    return c.json(apiError('VEHICLE_CHECKLIST_UNAVAILABLE', 'The approved vehicle evidence checklist is not available yet.'), 409)
  }

  const photos: File[] = []
  const evidence = new Map<string, File>()
  for (const [key, value] of form.entries()) {
    if (key === 'photo' && isUpload(value)) photos.push(value)
    if (key.startsWith('evidence:')) {
      const type = key.slice('evidence:'.length)
      if (!allowedEvidence.has(type) || !isUpload(value) || evidence.has(type)) {
        return c.json(apiError('INVALID_VEHICLE_EVIDENCE', 'Upload one valid replacement file for this checklist item.'), 400)
      }
      evidence.set(type, value)
    }
  }
  if (photos.length + evidence.size === 0 || photos.length > 8) {
    return c.json(apiError('INVALID_CORRECTION', 'Choose at least one replacement photo or evidence file.'), 400)
  }

  const stored: Array<{
    id: string
    mediaKind: string
    requirementVersion: string | null
    objectKey: string
    contentType: string
    byteSize: number
  }> = []
  for (const photo of photos) {
    let file: Awaited<ReturnType<typeof storePublicVehiclePhoto>>
    try {
      file = await storePublicVehiclePhoto(c.env, photo)
    } catch {
      await Promise.all(stored.map((item) => c.env.DRIVER_FILES?.delete(item.objectKey)))
      return c.json(apiError('PRIVATE_STORAGE_UNAVAILABLE', 'Could not store replacement photos. Try again.'), 503)
    }
    if (!file) {
      await Promise.all(stored.map((item) => c.env.DRIVER_FILES?.delete(item.objectKey)))
      return c.json(apiError('INVALID_PHOTO', 'Photos must be JPEG, PNG, or WebP images smaller than 8 MB.'), 400)
    }
    stored.push({ id: crypto.randomUUID(), mediaKind: 'client_photo', requirementVersion: null, ...file })
  }
  for (const [type, photo] of evidence) {
    let file: Awaited<ReturnType<typeof storePrivateEvidence>>
    try {
      file = await storePrivateEvidence(c.env, 'vehicle-documents', photo)
    } catch {
      await Promise.all(stored.map((item) => c.env.DRIVER_FILES?.delete(item.objectKey)))
      return c.json(apiError('PRIVATE_STORAGE_UNAVAILABLE', 'Could not store replacement evidence. Try again.'), 503)
    }
    if (!file) {
      await Promise.all(stored.map((item) => c.env.DRIVER_FILES?.delete(item.objectKey)))
      return c.json(apiError('INVALID_VEHICLE_EVIDENCE', 'Vehicle evidence must be JPEG, PNG, WebP, or PDF files smaller than 8 MB.'), 400)
    }
    stored.push({
      id: crypto.randomUUID(),
      mediaKind: type,
      requirementVersion: requirements.results.find((requirement) => requirement.evidence_type === type)?.version ?? null,
      ...file,
    })
  }

  const now = Date.now()
  const evidenceExpiresAt = now + retentionPolicy.retention_days * 86_400_000
  try {
    const result = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE vehicles SET status = 'pending_review', reviewer_reason = NULL, applicant_message = NULL, updated_at = ?
          WHERE id = ? AND driver_application_id = ? AND status = ?`,
      ).bind(now, vehicle.id, vehicle.driver_application_id, vehicle.status),
      c.env.DB.prepare(
        `INSERT INTO marketplace_audit_events
          (id, actor_user_id, action, target_type, target_id, reason, prior_state, new_state, created_at)
         SELECT ?, ?, 'vehicle_corrections_submitted', 'vehicle', ?,
                'Driver submitted replacement review evidence.', ?, 'pending_review', ?
          WHERE changes() = 1`,
      ).bind(crypto.randomUUID(), user.id, vehicle.id, vehicle.status, now),
      ...stored.map((item) => c.env.DB.prepare(
        `INSERT INTO vehicle_media
          (id, vehicle_id, media_kind, object_key, content_type, byte_size,
           retention_policy_id, retention_expires_at, requirement_version, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM vehicles
                         WHERE id = ? AND driver_application_id = ?
                           AND status = 'pending_review' AND updated_at = ?)`,
      ).bind(
        item.id,
        vehicle.id,
        item.mediaKind,
        item.objectKey,
        item.contentType,
        item.byteSize,
        item.mediaKind === 'client_photo' ? null : retentionPolicy.id,
        item.mediaKind === 'client_photo' ? null : evidenceExpiresAt,
        item.requirementVersion,
        now,
        vehicle.id,
        vehicle.driver_application_id,
        now,
      )),
    ])
    if (result[0]?.meta.changes !== 1 || stored.some((_, index) => result[index + 2]?.meta.changes !== 1)) {
      await Promise.all(stored.map((item) => c.env.DRIVER_FILES?.delete(item.objectKey)))
      return c.json(apiError('INVALID_VEHICLE_STATE', 'This vehicle changed before the replacement evidence could be saved. Refresh and try again.'), 409)
    }
  } catch {
    await Promise.all(stored.map((item) => c.env.DRIVER_FILES?.delete(item.objectKey)))
    return c.json(apiError('CORRECTION_SAVE_FAILED', 'We could not save the replacement evidence. Try again.'), 503)
  }
  return c.json({ vehicleId: vehicle.id, status: 'pending_review' }, 201)
})

vehiclesApp.patch('/:vehicleId', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)
  const vehicle = await getVehicle(c.env, c.req.param('vehicleId'))
  if (!vehicle || !(await canManageVehicle(c.env, vehicle, user.id))) {
    return c.json(apiError('NOT_FOUND', 'Vehicle listing was not found.'), 404)
  }
  if (!['approved', 'pending_review', 'needs_correction', 'rejected'].includes(vehicle.status)) {
    return c.json(apiError('INVALID_VEHICLE_STATE', 'This vehicle listing cannot be edited in its current state.'), 409)
  }

  const body: unknown = await c.req.json().catch(() => null)
  const input = typeof body === 'object' && body !== null && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {}
  const make = input.make
  const model = input.model
  const modelYear = input.year
  const passengerCapacity = input.passengerCapacity
  const luggageCapacity = input.luggageCapacity
  const comfort = input.comfortDetails
  const accessibility = input.accessibilityDetails
  const registration = input.registrationNumber
  if (
    typeof make !== 'string' || make.trim().length < 2 || make.trim().length > 80 ||
    typeof model !== 'string' || model.trim().length < 1 || model.trim().length > 80 ||
    !Number.isInteger(modelYear) || Number(modelYear) < 1980 || Number(modelYear) > new Date().getUTCFullYear() + 1 ||
    !Number.isInteger(passengerCapacity) || Number(passengerCapacity) < 1 || Number(passengerCapacity) > 20 ||
    !Number.isInteger(luggageCapacity) || Number(luggageCapacity) < 0 || Number(luggageCapacity) > 20 ||
    typeof comfort !== 'string' || comfort.trim().length < 3 || comfort.trim().length > 500 ||
    typeof accessibility !== 'string' || accessibility.trim().length > 500 ||
    typeof registration !== 'string' || registration.trim().length < 3 || registration.trim().length > 40
  ) {
    return c.json(apiError('INVALID_VEHICLE', 'Check the make, model, year, capacity, comfort, accessibility, and registration details.'), 400)
  }

  const updatedMake = make.trim()
  const updatedModel = model.trim()
  const updatedRegistration = registration.trim().toUpperCase()
  const identityChanged = vehicle.make !== updatedMake || vehicle.model !== updatedModel ||
    vehicle.model_year !== Number(modelYear) || vehicle.registration_number !== updatedRegistration
  const listingChanged = identityChanged || vehicle.passenger_capacity !== Number(passengerCapacity) ||
    vehicle.luggage_capacity !== Number(luggageCapacity) || vehicle.comfort_details !== comfort.trim() ||
    vehicle.accessibility_details !== accessibility.trim()
  if (!listingChanged) {
    return c.json({ vehicleId: vehicle.id, status: vehicle.status, reviewRequired: false })
  }

  const nextStatus = vehicle.status === 'approved'
    ? 'needs_correction'
    : vehicle.status === 'rejected'
      ? 'pending_review'
      : vehicle.status
  const now = Date.now()
  const result = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE vehicles SET make = ?, model = ?, model_year = ?, passenger_capacity = ?,
          luggage_capacity = ?, comfort_details = ?, accessibility_details = ?,
          registration_number = ?, status = ?, reviewer_reason = NULL, applicant_message = NULL, updated_at = ?
        WHERE id = ? AND status = ?`,
    ).bind(updatedMake, updatedModel, Number(modelYear), Number(passengerCapacity), Number(luggageCapacity),
      comfort.trim(), accessibility.trim(), updatedRegistration, nextStatus, now, vehicle.id, vehicle.status),
    c.env.DB.prepare(
      `INSERT INTO marketplace_audit_events
        (id, actor_user_id, action, target_type, target_id, reason, prior_state, new_state, created_at)
       SELECT ?, ?, 'vehicle_listing_updated', 'vehicle', ?, 'Driver updated vehicle facts.', ?, ?, ?
        WHERE changes() = 1`,
    ).bind(crypto.randomUUID(), user.id, vehicle.id, vehicle.status, nextStatus, now),
    c.env.DB.prepare(
      `UPDATE vehicle_media
          SET review_status = CASE WHEN ? = 1 THEN 'rejected' ELSE 'pending' END,
              reviewer_reason = CASE WHEN ? = 1
                THEN 'Vehicle identity changed. Submit current replacement photos and documents for review.'
                ELSE NULL END,
              reviewed_by = NULL, reviewed_at = NULL
        WHERE vehicle_id = ? AND review_status = 'approved'
          AND EXISTS (SELECT 1 FROM vehicles WHERE id = ? AND updated_at = ? AND status = ?)`,
    ).bind(identityChanged ? 1 : 0, identityChanged ? 1 : 0, vehicle.id, vehicle.id, now, nextStatus),
  ])
  if ((result[0]?.meta.changes ?? 0) !== 1) {
    return c.json(apiError('INVALID_VEHICLE_STATE', 'This vehicle listing changed before the update could be saved.'), 409)
  }
  return c.json({ vehicleId: vehicle.id, status: nextStatus, reviewRequired: true })
})

vehiclesApp.get('/catalog', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)

  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const partySize = Number(c.req.query('partySize'))
  const luggageCount = Number(c.req.query('luggageCount'))
  if (
    !isDate(startDate) || !isDate(endDate) || startDate >= endDate ||
    startDate < kampalaToday() || dateSpan(startDate, endDate) > 7 ||
    !Number.isInteger(partySize) || partySize < 1 || partySize > 20 ||
    !Number.isInteger(luggageCount) || luggageCount < 0 || luggageCount > 20
  ) {
    return c.json(apiError('INVALID_SEARCH', 'Enter valid trip dates, party size, and luggage count.'), 400)
  }

  const now = Date.now()
  const result = await c.env.DB.prepare(
    `SELECT vehicle.id, vehicle.make, vehicle.model, vehicle.model_year,
            vehicle.passenger_capacity, vehicle.luggage_capacity,
            vehicle.comfort_details, vehicle.accessibility_details
       FROM vehicles AS vehicle
       JOIN driver_applications AS driver ON driver.id = vehicle.driver_application_id
      WHERE vehicle.status = 'approved' AND driver.status = 'approved'
        AND vehicle.passenger_capacity >= ? AND vehicle.luggage_capacity >= ?
        AND NOT EXISTS (
          SELECT 1 FROM vehicle_unavailability AS unavailable
           WHERE unavailable.vehicle_id = vehicle.id
             AND unavailable.start_date < ? AND unavailable.end_date > ?
        )
        AND NOT EXISTS (
          SELECT 1 FROM bookings AS booking
           WHERE booking.vehicle_id = vehicle.id
             AND booking.start_date < ? AND booking.end_date > ?
             AND (booking.status = 'confirmed' OR
                  (booking.status = 'deposit_pending' AND booking.hold_expires_at > ?))
        )
        AND ${approvedVehicleEvidencePredicate('vehicle')}
      ORDER BY vehicle.make, vehicle.model, vehicle.model_year DESC
      LIMIT 50`,
  )
    .bind(partySize, luggageCount, endDate, startDate, endDate, startDate,
      now, now, now, now, now, now, now)
    .all<{
      id: string
      make: string
      model: string
      model_year: number
      passenger_capacity: number
      luggage_capacity: number
      comfort_details: string
      accessibility_details: string
    }>()

  const catalog = await Promise.all(
    result.results.map(async (vehicle) => {
      const photos = await c.env.DB.prepare(
        `SELECT id FROM vehicle_media
          WHERE vehicle_id = ? AND media_kind = 'client_photo' AND review_status = 'approved'
          ORDER BY created_at ASC LIMIT 5`,
      )
        .bind(vehicle.id)
        .all<{ id: string }>()

      return {
        id: vehicle.id,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.model_year,
        passengerCapacity: vehicle.passenger_capacity,
        luggageCapacity: vehicle.luggage_capacity,
        comfortDetails: vehicle.comfort_details,
        accessibilityDetails: vehicle.accessibility_details,
        photos: photos.results.map((photo) => ({
          id: photo.id,
          url: `/api/vehicles/${vehicle.id}/photos/${photo.id}`,
        })),
      }
    }),
  )

  return c.json({ vehicles: catalog })
})

vehiclesApp.get('/:vehicleId/photos/:mediaId', async (c) => {
  const vehicleId = c.req.param('vehicleId')
  const mediaId = c.req.param('mediaId')
  const photo = await c.env.DB.prepare(
    `SELECT media.object_key
       FROM vehicle_media AS media
       JOIN vehicles AS vehicle ON vehicle.id = media.vehicle_id
       JOIN driver_applications AS driver ON driver.id = vehicle.driver_application_id
      WHERE media.id = ? AND media.vehicle_id = ?
        AND media.media_kind = 'client_photo' AND media.review_status = 'approved'
        AND vehicle.status = 'approved' AND driver.status = 'approved'
        AND ${approvedVehicleEvidencePredicate('vehicle')}
      LIMIT 1`,
  )
    .bind(mediaId, vehicleId, Date.now(), Date.now(), Date.now(), Date.now(), Date.now(), Date.now())
    .first<{ object_key: string }>()
  if (!photo) return c.json(apiError('NOT_FOUND', 'Approved vehicle photo was not found.'), 404)

  let response: Response | null
  try {
    response = await readPublicVehiclePhoto(c.env, photo.object_key)
  } catch {
    return c.json(apiError('PHOTO_UNAVAILABLE', 'This photo is temporarily unavailable.'), 503)
  }
  if (!response) return c.json(apiError('PHOTO_UNAVAILABLE', 'This photo is temporarily unavailable.'), 503)
  return response
})

vehiclesApp.get('/:vehicleId/availability', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)
  const vehicle = await getVehicle(c.env, c.req.param('vehicleId'))
  if (!vehicle || !(await canManageVehicle(c.env, vehicle, user.id))) {
    return c.json(apiError('NOT_FOUND', 'Vehicle listing was not found.'), 404)
  }

  const [unavailable, bookings] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, start_date, end_date FROM vehicle_unavailability
        WHERE vehicle_id = ? AND end_date > ? ORDER BY start_date`,
    )
      .bind(vehicle.id, kampalaToday())
      .all<{ id: string; start_date: string; end_date: string }>(),
    c.env.DB.prepare(
      `SELECT start_date, end_date, status, hold_expires_at FROM bookings
        WHERE vehicle_id = ? AND end_date >= ?
          AND (status = 'confirmed' OR (status = 'deposit_pending' AND hold_expires_at > ?))
        ORDER BY start_date`,
    )
      .bind(vehicle.id, kampalaToday(), Date.now())
      .all<{ start_date: string; end_date: string; status: string; hold_expires_at: number }>(),
  ])

  return c.json({
    unavailable: unavailable.results,
    holdsAndBookings: bookings.results,
  })
})

vehiclesApp.post('/:vehicleId/unavailability', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)
  const vehicle = await getVehicle(c.env, c.req.param('vehicleId'))
  if (!vehicle || !(await canManageVehicle(c.env, vehicle, user.id))) {
    return c.json(apiError('NOT_FOUND', 'Vehicle listing was not found.'), 404)
  }
  const body: unknown = await c.req.json().catch(() => null)
  const range = typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {}
  const startDate = range.startDate
  const endDate = range.endDate
  if (!isDate(startDate) || !isDate(endDate) || startDate >= endDate || startDate < kampalaToday()) {
    return c.json(apiError('INVALID_DATES', 'Choose a valid unavailable date range.'), 400)
  }

  const blockId = crypto.randomUUID()
  const now = Date.now()
  const result = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO vehicle_unavailability
       (id, vehicle_id, driver_application_id, start_date, end_date, created_at)
     SELECT ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM bookings
         WHERE vehicle_id = ? AND start_date < ? AND end_date > ?
           AND (status = 'confirmed' OR (status = 'deposit_pending' AND hold_expires_at > ?))
      )
      AND NOT EXISTS (
        SELECT 1 FROM vehicle_unavailability
         WHERE vehicle_id = ? AND start_date < ? AND end_date > ?
      )`,
    ).bind(blockId, vehicle.id, vehicle.driver_application_id, startDate, endDate, now,
      vehicle.id, endDate, startDate, now, vehicle.id, endDate, startDate),
    c.env.DB.prepare(
      `INSERT INTO marketplace_audit_events
        (id, actor_user_id, action, target_type, target_id, prior_state, new_state, created_at)
       SELECT ?, ?, 'vehicle_marked_unavailable', 'vehicle', ?, 'available', 'unavailable', ?
        WHERE changes() = 1`,
    ).bind(crypto.randomUUID(), user.id, vehicle.id, now),
  ])
  if (result[0]?.meta.changes !== 1) {
    return c.json(apiError('DATES_UNAVAILABLE', 'These dates overlap an existing unavailable block, deposit hold, or confirmed trip.'), 409)
  }
  return c.json({ unavailabilityId: blockId, startDate, endDate }, 201)
})

vehiclesApp.delete('/:vehicleId/unavailability/:blockId', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)
  const vehicle = await getVehicle(c.env, c.req.param('vehicleId'))
  if (!vehicle || !(await canManageVehicle(c.env, vehicle, user.id))) {
    return c.json(apiError('NOT_FOUND', 'Vehicle listing was not found.'), 404)
  }

  const now = Date.now()
  const result = await c.env.DB.batch([
    c.env.DB.prepare(
      `DELETE FROM vehicle_unavailability
        WHERE id = ? AND vehicle_id = ? AND driver_application_id = ? AND end_date > ?`,
    ).bind(c.req.param('blockId'), vehicle.id, vehicle.driver_application_id, kampalaToday()),
    c.env.DB.prepare(
      `INSERT INTO marketplace_audit_events
        (id, actor_user_id, action, target_type, target_id, reason, prior_state, new_state, created_at)
       SELECT ?, ?, 'vehicle_unavailability_removed', 'vehicle', ?,
              'Driver removed an upcoming unavailable date block.', 'unavailable', 'available', ?
        WHERE changes() = 1`,
    ).bind(crypto.randomUUID(), user.id, vehicle.id, now),
  ])
  if ((result[0]?.meta.changes ?? 0) !== 1) {
    return c.json(apiError('UNAVAILABILITY_NOT_FOUND', 'This upcoming unavailable date block was not found.'), 404)
  }
  return c.json({ removed: true })
})

adminVehiclesApp.get('/pending', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)
  if (!(await isMarketplaceAdmin(c.env, user.id))) {
    return c.json(apiError('FORBIDDEN', 'You are not authorized to review vehicle listings.'), 403)
  }

  const vehicles = await c.env.DB.prepare(
    `SELECT vehicle.id, vehicle.make, vehicle.model, vehicle.model_year,
            vehicle.passenger_capacity, vehicle.luggage_capacity,
            vehicle.comfort_details, vehicle.accessibility_details,
            vehicle.status, vehicle.reviewer_reason
       FROM vehicles AS vehicle WHERE vehicle.status IN ('pending_review', 'needs_correction')
      ORDER BY vehicle.created_at ASC`,
  ).all<VehicleRecord>()

  const pending = await Promise.all(vehicles.results.map(async (vehicle) => {
    const media = await c.env.DB.prepare(
      `SELECT id, media_kind, review_status, reviewer_reason
         FROM vehicle_media AS media
        WHERE media.vehicle_id = ?
          AND ${currentVehicleRequirementPredicate('media')}
          AND (media.media_kind = 'client_photo' OR
               (media.retention_expires_at IS NOT NULL AND media.retention_expires_at > ?))
        ORDER BY media.media_kind, media.created_at`,
    )
      .bind(vehicle.id, Date.now())
      .all<{ id: string; media_kind: string; review_status: string; reviewer_reason: string | null }>()
    return {
      ...safeVehicle(vehicle),
      status: vehicle.status,
      reason: vehicle.reviewer_reason,
      media: media.results.map((item) => ({
        id: item.id,
        type: item.media_kind,
        status: item.review_status,
        reason: item.reviewer_reason,
      })),
    }
  }))

  return c.json({ vehicles: pending })
})

adminVehiclesApp.post('/:vehicleId/identity-review', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)
  if (!(await isMarketplaceAdmin(c.env, user.id))) {
    return c.json(apiError('FORBIDDEN', 'You are not authorized to review vehicle identity details.'), 403)
  }
  const body: unknown = await c.req.json().catch(() => null)
  const reason = typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>).reason
    : null
  if (typeof reason !== 'string' || reason.trim().length < 8 || reason.trim().length > 500) {
    return c.json(apiError('REVIEW_REASON_REQUIRED', 'Enter why you need to open private vehicle identity details.'), 400)
  }
  const vehicle = await c.env.DB.prepare(
    `SELECT id, registration_number, driver_application_id FROM vehicles WHERE id = ? LIMIT 1`,
  ).bind(c.req.param('vehicleId')).first<{ id: string; registration_number: string; driver_application_id: string }>()
  if (!vehicle) return c.json(apiError('NOT_FOUND', 'Vehicle listing was not found.'), 404)
  await writeMarketplaceAudit(c.env, {
    actorUserId: user.id, action: 'vehicle_identity_accessed', targetType: 'vehicle',
    targetId: vehicle.id, reason: reason.trim(),
  })
  return c.json({ vehicleId: vehicle.id, registrationNumber: vehicle.registration_number, driverApplicationId: vehicle.driver_application_id })
})

adminVehiclesApp.post('/:vehicleId/media/:mediaId/access', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)
  if (!(await isMarketplaceAdmin(c.env, user.id))) {
    return c.json(apiError('FORBIDDEN', 'You are not authorized to access vehicle evidence.'), 403)
  }
  const body: unknown = await c.req.json().catch(() => null)
  const reason = typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>).reason
    : null
  if (typeof reason !== 'string' || reason.trim().length < 8 || reason.trim().length > 500) {
    return c.json(apiError('REVIEW_REASON_REQUIRED', 'Enter why you need to open this private vehicle file.'), 400)
  }
  const media = await c.env.DB.prepare(
    `SELECT media.id, media.object_key FROM vehicle_media AS media
      WHERE media.id = ? AND media.vehicle_id = ?
        AND ${currentVehicleRequirementPredicate('media')}
        AND (media.media_kind = 'client_photo' OR
             (media.retention_expires_at IS NOT NULL AND media.retention_expires_at > ?))
      LIMIT 1`,
  ).bind(c.req.param('mediaId'), c.req.param('vehicleId'), Date.now())
    .first<{ id: string; object_key: string }>()
  if (!media) return c.json(apiError('NOT_FOUND', 'Vehicle evidence was not found.'), 404)
  await writeMarketplaceAudit(c.env, {
    actorUserId: user.id, action: 'vehicle_evidence_accessed', targetType: 'vehicle_media',
    targetId: media.id, reason: reason.trim(),
  })
  const response = await readPrivateEvidence(c.env, media.object_key)
  if (!response) return c.json(apiError('FILE_UNAVAILABLE', 'Vehicle evidence is temporarily unavailable.'), 503)
  return response
})

adminVehiclesApp.post('/:vehicleId/media/:mediaId/decision', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)
  if (!(await isMarketplaceAdmin(c.env, user.id))) {
    return c.json(apiError('FORBIDDEN', 'You are not authorized to review vehicle media.'), 403)
  }
  const body: unknown = await c.req.json().catch(() => null)
  const input = typeof body === 'object' && body !== null && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {}
  if (
    (input.decision !== 'approve' && input.decision !== 'reject') ||
    typeof input.reason !== 'string' || input.reason.trim().length < 4 || input.reason.trim().length > 300 ||
    (input.decision === 'reject' &&
      (typeof input.applicantMessage !== 'string' || input.applicantMessage.trim().length < 4 || input.applicantMessage.trim().length > 300))
  ) {
    return c.json(apiError('INVALID_REVIEW', 'Choose approve or reject, enter an internal reason, and provide a driver-facing message when rejecting.'), 400)
  }

  const media = await c.env.DB.prepare(
    `SELECT media.id, media.review_status, vehicle.status AS vehicle_status
       FROM vehicle_media AS media JOIN vehicles AS vehicle ON vehicle.id = media.vehicle_id
      WHERE media.id = ? AND media.vehicle_id = ?
        AND ${currentVehicleRequirementPredicate('media')} LIMIT 1`,
  )
    .bind(c.req.param('mediaId'), c.req.param('vehicleId'))
    .first<{ id: string; review_status: string; vehicle_status: string }>()
  if (!media || media.review_status !== 'pending') {
    return c.json(apiError('INVALID_MEDIA_STATE', 'This vehicle evidence is no longer awaiting review.'), 409)
  }

  const nextState = input.decision === 'approve' ? 'approved' : 'rejected'
  const now = Date.now()
  const result = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE vehicle_media SET review_status = ?, reviewer_reason = ?, applicant_message = ?, reviewed_by = ?, reviewed_at = ?
        WHERE id = ? AND vehicle_id = ? AND review_status = 'pending'
          AND ${currentVehicleRequirementPredicate('vehicle_media')}
          AND (media_kind = 'client_photo' OR
               (retention_expires_at IS NOT NULL AND retention_expires_at > ?))`,
    ).bind(nextState, input.reason.trim(), input.decision === 'reject' ? (input.applicantMessage as string).trim() : null,
      user.id, now, media.id, c.req.param('vehicleId'), now),
    c.env.DB.prepare(
      `INSERT INTO marketplace_audit_events
        (id, actor_user_id, action, target_type, target_id, reason, prior_state, new_state, created_at)
       SELECT ?, ?, 'vehicle_media_reviewed', 'vehicle_media', ?, ?, ?, ?, ?
        WHERE changes() = 1`,
    ).bind(crypto.randomUUID(), user.id, media.id, input.reason.trim(), media.review_status, nextState, now),
    ...(input.decision === 'reject' ? [
      c.env.DB.prepare(
        `UPDATE vehicles SET status = 'needs_correction', reviewer_reason = ?, applicant_message = ?, updated_at = ?
          WHERE id = ? AND status IN ('pending_review', 'approved')`,
      ).bind(input.reason.trim(), (input.applicantMessage as string).trim(), now, c.req.param('vehicleId')),
      c.env.DB.prepare(
        `INSERT INTO marketplace_audit_events
          (id, actor_user_id, action, target_type, target_id, reason, prior_state, new_state, created_at)
         SELECT ?, ?, 'vehicle_correction_required', 'vehicle', ?, ?, ?, 'needs_correction', ?
          WHERE changes() = 1`,
      ).bind(crypto.randomUUID(), user.id, c.req.param('vehicleId'), input.reason.trim(), media.vehicle_status, now),
    ] : []),
  ])
  if ((result[0]?.meta.changes ?? 0) !== 1) {
    return c.json(apiError('INVALID_MEDIA_STATE', 'This media changed before the review could be recorded.'), 409)
  }

  return c.json({ mediaId: media.id, status: nextState })
})

adminVehiclesApp.post('/:vehicleId/decision', async (c) => {
  const user = await getSignedInUser(c.env, c.req.raw)
  if (!user) return c.json(apiError('UNAUTHORIZED', 'Sign in to continue.'), 401)
  if (!(await isMarketplaceAdmin(c.env, user.id))) {
    return c.json(apiError('FORBIDDEN', 'You are not authorized to review vehicle listings.'), 403)
  }
  const body: unknown = await c.req.json().catch(() => null)
  const input = typeof body === 'object' && body !== null && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {}
  if (
    (input.decision !== 'approve' && input.decision !== 'reject') ||
    typeof input.reason !== 'string' || input.reason.trim().length < 4 || input.reason.trim().length > 300 ||
    (input.decision === 'reject' &&
      (typeof input.applicantMessage !== 'string' || input.applicantMessage.trim().length < 4 || input.applicantMessage.trim().length > 300))
  ) {
    return c.json(apiError('INVALID_REVIEW', 'Choose approve or reject, enter an internal reason, and provide a driver-facing message when rejecting.'), 400)
  }

  const vehicle = await getVehicle(c.env, c.req.param('vehicleId'))
  if (!vehicle || !['pending_review', 'needs_correction', 'rejected'].includes(vehicle.status)) {
    return c.json(apiError('INVALID_VEHICLE_STATE', 'This vehicle is no longer awaiting review.'), 409)
  }

  if (input.decision === 'approve') {
    const [driver, evidenceReady, retention] = await Promise.all([
      c.env.DB.prepare(
        `SELECT 1 AS approved FROM driver_applications
          WHERE id = ? AND status = 'approved' LIMIT 1`,
      )
        .bind(vehicle.driver_application_id)
        .first<{ approved: number }>(),
      getVehicleEvidenceReady(c.env, vehicle.id),
      c.env.DB.prepare(
        `SELECT 1 AS active FROM retention_policies
          WHERE record_type = 'vehicle_evidence' AND active = 1 AND approved_at IS NOT NULL LIMIT 1`,
      ).first<{ active: number }>(),
    ])
    if (!driver || !evidenceReady || !retention) {
      return c.json(apiError('VEHICLE_APPROVAL_REQUIREMENTS_INCOMPLETE', 'The driver, counsel-approved evidence checklist, approved photos, and retention policy must be complete before publishing.'), 409)
    }
  }

  const nextState = input.decision === 'approve' ? 'approved' : 'rejected'
  const now = Date.now()
  const approvalGuard = nextState === 'approved'
    ? `
          AND EXISTS (
            SELECT 1 FROM driver_applications AS driver
             WHERE driver.id = vehicles.driver_application_id AND driver.status = 'approved'
          )
          AND ${approvedVehicleEvidencePredicate('vehicles')}
          AND EXISTS (
            SELECT 1 FROM retention_policies AS retention
             WHERE retention.record_type = 'vehicle_evidence'
               AND retention.active = 1 AND retention.approved_at IS NOT NULL
          )`
    : ''
  const update = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE vehicles SET status = ?, reviewer_reason = ?, applicant_message = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
        WHERE id = ? AND status = ?
          ${approvalGuard}`,
    ).bind(nextState, input.reason.trim(), input.decision === 'reject' ? (input.applicantMessage as string).trim() : null,
      user.id, now, now, vehicle.id, vehicle.status,
      ...(nextState === 'approved' ? [now, now, now, now, now, now] : [])),
    c.env.DB.prepare(
      `INSERT INTO marketplace_audit_events
        (id, actor_user_id, action, target_type, target_id, reason, prior_state, new_state, created_at)
       SELECT ?, ?, 'vehicle_review_decision', 'vehicle', ?, ?, ?, ?, ?
        WHERE changes() = 1`,
    ).bind(crypto.randomUUID(), user.id, vehicle.id, input.reason.trim(), vehicle.status, nextState, now),
  ])
  if ((update[0]?.meta.changes ?? 0) !== 1) {
    return c.json(apiError('INVALID_VEHICLE_STATE', 'This vehicle changed before the review could be recorded.'), 409)
  }

  return c.json({ vehicleId: vehicle.id, status: nextState, decidedAt: now })
})

export { adminVehiclesApp, vehiclesApp }

export async function purgeExpiredVehicleEvidence(env: AuthBindings): Promise<number> {
  if (!env.DRIVER_FILES) return 0
  const now = Date.now()
  const expired = await env.DB.prepare(
    `SELECT id, vehicle_id, object_key FROM vehicle_media
      WHERE media_kind != 'client_photo'
        AND retention_expires_at IS NOT NULL AND retention_expires_at <= ?
      ORDER BY retention_expires_at ASC LIMIT 50`,
  ).bind(now).all<{ id: string; vehicle_id: string; object_key: string }>()

  let purged = 0
  for (const media of expired.results) {
    try {
      const reviewRequiredAt = Date.now()
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE vehicles
              SET status = 'needs_correction',
                  reviewer_reason = 'Private vehicle evidence expired. Submit current replacement evidence for review.',
                  applicant_message = 'Your vehicle evidence expired. Upload current replacement documents so Fave can review the listing again.',
                  updated_at = ?
            WHERE id = ? AND status = 'approved'`,
        ).bind(reviewRequiredAt, media.vehicle_id),
        env.DB.prepare(
          `INSERT INTO marketplace_audit_events
            (id, actor_user_id, actor_type, action, target_type, target_id, reason,
             prior_state, new_state, created_at)
           SELECT ?, NULL, 'system', 'vehicle_evidence_expiry_requires_review',
                  'vehicle', ?,
                  'Private vehicle evidence expired; the listing was paused pending replacement evidence.',
                  'approved', 'needs_correction', ?
            WHERE changes() = 1`,
        ).bind(crypto.randomUUID(), media.vehicle_id, reviewRequiredAt),
      ])

      await env.DRIVER_FILES.delete(media.object_key)
      const purgedAt = Date.now()
      const result = await env.DB.batch([
        env.DB.prepare(
          `DELETE FROM vehicle_media
            WHERE id = ? AND media_kind != 'client_photo'
              AND retention_expires_at IS NOT NULL AND retention_expires_at <= ?`,
        ).bind(media.id, purgedAt),
        env.DB.prepare(
          `INSERT INTO marketplace_audit_events
            (id, actor_user_id, actor_type, action, target_type, target_id, reason,
             prior_state, new_state, created_at)
           SELECT ?, NULL, 'system', 'vehicle_evidence_retention_expired',
                  'vehicle_media', ?,
                  'Approved retention period elapsed; private vehicle evidence was deleted.',
                  'stored', 'deleted', ?
            WHERE changes() = 1`,
        ).bind(crypto.randomUUID(), media.id, purgedAt),
      ])
      purged += result[0]?.meta.changes === 1 ? 1 : 0
    } catch {
      // The row and expiry stay in place so the next scheduled run retries deletion.
    }
  }

  return purged
}
