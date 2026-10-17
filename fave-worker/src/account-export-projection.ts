import type { AuthBindings } from './auth'
import type { ExportCoverage, ExportEntry, PreparedAccountExport } from './account-export-types'
import { decryptPrivateField } from './private-fields'
import { safeNotificationCopy } from './notification-delivery'
import { accountExportSources, originalSources, type ExportSource } from './account-export-sources'
import { parseStoredProjection, projectBenchmarkBasis, projectFareRules, projectLocation, projectQuote, projectTerms, selectFields } from './account-export-snapshots'

type Row = Record<string, unknown> & { _cursor: string }
const PAGE_SIZE = 16
const encoder = new TextEncoder()

function exception(coverage: ExportCoverage, category: string, code: string, count = 1) {
  coverage.complete = false
  const existing = coverage.exceptions.find((entry) => entry.category === category && entry.code === code)
  if (existing) existing.count += count
  else coverage.exceptions.push({ category, code, count })
}
function bytesStream(chunks: AsyncIterable<string>): ReadableStream<Uint8Array> {
  const iterator = chunks[Symbol.asyncIterator]()
  return new ReadableStream({
    async pull(controller) {
      try {
        const next = await iterator.next()
        if (next.done) controller.close()
        else controller.enqueue(encoder.encode(next.value))
      } catch (error) { controller.error(error) }
    },
    async cancel() { await iterator.return?.() },
  }, { highWaterMark: 0 })
}
function textEntry(name: string, text: string): ExportEntry {
  return { name, stream: bytesStream((async function* () { yield text })()) }
}
async function* pages(env: AuthBindings, userId: string, source: Pick<ExportSource, 'from' | 'columns' | 'key' | 'own'>): AsyncGenerator<Row> {
  let cursor = ''
  for (;;) {
    const result = await env.DB.prepare(`WITH subject AS (SELECT ? AS id)
      SELECT ${source.key} AS _cursor, ${source.columns} FROM ${source.from}
      WHERE (${source.own}) AND ${source.key} > ? ORDER BY ${source.key} ASC LIMIT ?`)
      .bind(userId, cursor, PAGE_SIZE).all<Row>()
    if (!result.success) throw new Error('ACCOUNT_EXPORT_SOURCE_FAILED')
    for (const row of result.results) { cursor = row._cursor; yield row }
    if (result.results.length < PAGE_SIZE) return
  }
}
async function projectRow(env: AuthBindings, source: ExportSource, row: Row, coverage: ExportCoverage) {
  const projected = selectFields(row, source.fields)
  if (source.category === 'notifications') {
    const copy = safeNotificationCopy(String(row.template_key))
    projected.title = copy.title
    projected.body = copy.body
  }
  if (source.category === 'notifications' || source.category === 'notification_events') {
    const allowedDomains = new Set(['trip_offer', 'availability_request', 'booking', 'trip', 'payment', 'incident', 'support'])
    const typeAllowed = allowedDomains.has(String(row.notification_domain_type))
    if (typeAllowed) projected.domain_type = row.notification_domain_type
    if (typeAllowed && typeof row.notification_domain_id === 'string') {
      projected.domain_id = row.notification_domain_id
      if (source.category === 'notifications') projected.targetId = row.notification_domain_id
    } else exception(coverage, source.category, 'DOMAIN_REFERENCE_ACCESS_REVIEW')
  }
  const driverOnly = row.own_client === 0
  if (row.own_client !== undefined) projected.purpose = driverOnly ? 'driver_work' : 'client_trip'
  if (driverOnly) {
    // Counts and itinerary dates describe this driver's work. Exact client
    // pickup/destination and client contact/consent details do not belong here.
    delete projected.contact_share_consented_at
  }
  for (const [field, shape] of Object.entries(source.nested ?? {})) {
    if (row[field] === null || row[field] === undefined) continue
    if (driverOnly && (shape === 'location' || shape === 'terms')) continue
    const project = shape === 'location' ? projectLocation : shape === 'terms' ? projectTerms :
      shape === 'benchmark' ? projectBenchmarkBasis : shape === 'fare' ? projectFareRules :
        (value: unknown) => projectQuote(value, driverOnly)
    const value = parseStoredProjection(row[field], project)
    if (value === null) exception(coverage, source.category, 'SNAPSHOT_REQUIRES_REVIEW')
    else projected[field.replace(/_json$/u, '')] = value
  }
  let needsAccessReview = source.notes?.filter((field) => source.category !== 'marketplace_audit_events' || field === 'reason').some((field) => typeof row[field] === 'string' && row[field] !== '') ?? false
  if (source.category === 'marketplace_audit_events') {
    if (row.target_type === 'review_session') delete projected.target_id
    const states = new Set(['draft', 'requested', 'pending_verification', 'needs_correction', 'approved', 'rejected', 'suspended', 'pending', 'pending_review', 'confirmed', 'unavailable', 'withdrawn', 'expired', 'converted_to_booking', 'deposit_pending', 'cancelled', 'stored', 'deletion_pending', 'deleted', 'ready', 'streaming', 'failed'])
    for (const field of ['prior_state', 'new_state']) {
      if (row[field] == null) continue
      if (states.has(String(row[field]))) projected[field] = row[field]
      else needsAccessReview = true
    }
  }
  if (needsAccessReview) {
    exception(coverage, source.category, 'MIXED_PERSON_ACCESS_REVIEW')
  }
  if (source.category === 'passkey' && row.transports != null) {
    delete projected.transports
    const transports = parseStoredProjection(row.transports, (value) => Array.isArray(value) && value.every((entry) => ['usb', 'nfc', 'ble', 'internal', 'hybrid', 'smart-card'].includes(entry)) ? value : null)
    if (transports === null) exception(coverage, source.category, 'SNAPSHOT_REQUIRES_REVIEW')
    else projected.transports = transports
  }
  if (source.nationalId) {
    let nationalId: string | null = null
    try {
      nationalId = typeof row.national_id_number === 'string'
        ? await decryptPrivateField(env.DRIVER_ID_ENCRYPTION_KEY, row.national_id_number) : null
    } catch { /* An encrypted field failure is explicit follow-up, not lost data. */ }
    if (nationalId === null) exception(coverage, source.category, 'PRIVATE_FIELD_UNAVAILABLE')
    else projected.national_id_number = nationalId
  }
  return projected
}
function categoryEntry(env: AuthBindings, userId: string, source: ExportSource, coverage: ExportCoverage): ExportEntry {
  coverage.counts[source.category] = 0
  return { name: `data/${source.category}.json`, stream: bytesStream((async function* () {
    yield '[\n'
    let first = true
    for await (const row of pages(env, userId, source)) {
      const projected = await projectRow(env, source, row, coverage)
      yield `${first ? '' : ',\n'}${JSON.stringify(projected)}`
      first = false
      coverage.counts[source.category]++
    }
    yield '\n]\n'
  })()) }
}

const formatNotes = {
  collection: 'Records are collected by independent paged reads during this generation, not a transactionally consistent database snapshot.',
  privateArchive: 'Contains private information, including your own retained identity uploads. Store securely.',
  redactions: [
    'OAuth, session, push, OTP, passkey and TOTP credentials, reusable security proofs, raw object keys and ciphertext are excluded.',
    'Other people\'s identity/contact details and client locations in driver work records are not disclosed.',
    'Mixed-person free text and private review/audit descriptions require individual access assessment; internal opinions are not categorically exempt.',
    'Driver work projections identify your work, rate and state facts without disclosing unrelated client contact or locations.',
  ],
  sourceScope: [
    { source: 'device_drafts', status: 'on_your_device_not_collected_by_this_module' },
    { source: 'external_processors_and_backups', status: 'controller_follow_up_required' },
    { source: 'payment_incident_completion_ledgers', status: 'not_implemented_in_this_module' },
    { source: 'notification_copy', status: 'rendered_from_the_same_current_fixed_templates_as_the_inbox_historical_rendered_text_not_separately_stored' },
    { source: 'historical_sessions', status: 'only_currently_retained_session_rows_are_available' },
    { source: 'retired_evidence_cleanup_jobs', status: 'retired_rows_have_no_surviving_owner_join_controller_reconciliation_required' },
  ],
  exceptionExplanations: {
    DOMAIN_REFERENCE_ACCESS_REVIEW: 'An inbox event refers to a domain record whose ownership or export shape is not established. Its reference needs an individual access decision.',
    MIXED_PERSON_ACCESS_REVIEW: 'These records may contain your information and information about other people or confidential sources. They need an individual access and redaction decision.',
    PRIVATE_FIELD_UNAVAILABLE: 'An encrypted identity field could not be decrypted. The access request remains open for recovery or a written explanation.',
    SNAPSHOT_REQUIRES_REVIEW: 'A stored structured field has an unsupported or malformed shape. Its contents need a separate projection or access decision.',
    ORIGINAL_UNAVAILABLE: 'An uploaded original referenced by a retained record was unavailable from storage.',
    ORIGINAL_STORAGE_UNAVAILABLE: 'Storage could not be reached for an uploaded original; retry or controller follow-up is needed.',
    ORIGINAL_SOURCE_CHANGED: 'An upload ownership/source record changed during collection. A new collection or individual review is needed.',
    CONTROLLER_SOURCE_REVIEW_REQUIRED: 'The controller must check separately controlled processors, backups and other sources outside this module before treating the rights request as fulfilled.',
    RETIRED_HISTORY_OWNERSHIP_RECONCILIATION_REQUIRED: 'Retired upload cleanup rows do not retain an owner join. Reconcile retention/removal history separately without disclosing another person\'s jobs.',
    UNREVIEWED_SOURCE_TABLE: 'New database sources have not yet received an export scope decision. They are not silently included or treated as searched.',
  },
  followUp: 'Exceptions remain open for a separate access decision. Downloading or acknowledging this archive does not close them. Use the support route in your accepted privacy notice; the applicable complaint route remains available.',
}

/** Lazily streams every owned page and retained original. Consume each entry
 * before advancing the iterator. The caller must reauthorize each entry and long
 * byte transfers; this module deliberately owns neither sessions nor receipts. */
export function prepareAccountExport(env: AuthBindings, userId: string, generatedAt: number): PreparedAccountExport {
  const coverage: ExportCoverage = { complete: false, exceptions: [], counts: { originals: 0 } }
  const sources = accountExportSources()
  const entries = (async function* (): AsyncGenerator<ExportEntry> {
    const reviewedTables = new Set([...sources.map((source) => source.category), 'verification', 'review_used_codes', 'private_evidence_deletion_jobs'])
    const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations'").all<{ name: string }>()
    if (!tables.success) throw new Error('ACCOUNT_EXPORT_SCHEMA_CHECK_FAILED')
    const unknownTables = tables.results.filter((table) => !reviewedTables.has(table.name)).length
    if (unknownTables) exception(coverage, 'schema', 'UNREVIEWED_SOURCE_TABLE', unknownTables)
    yield textEntry('README.txt', `Fave account information\nCollection started: ${new Date(generatedAt).toISOString()}\n\n${formatNotes.privateArchive}\n${formatNotes.collection}\n\nThe data/ folder contains JSON arrays. originals/ contains available retained uploads, including earlier submissions. Each file is named by a server-controlled sequence. The final manifest.json lists every category, count and unresolved exception.\n\n${formatNotes.followUp}\n`)
    yield textEntry('index.json', JSON.stringify({ formatVersion: 1, generatedAt, categories: sources.map((item) => ({ category: item.category, file: `data/${item.category}.json` })), originals: 'originals/', manifest: 'manifest.json', ...formatNotes }, null, 2))
    for (const source of sources) yield categoryEntry(env, userId, source, coverage)
    let originalNumber = 0
    for (const source of originalSources) {
      for await (const row of pages(env, userId, { ...source, key: 'x.id', columns: 'x.id, x.object_key, x.content_type' })) {
        // Rejoin owner immediately before every object read; page membership is
        // insufficient if records changed while earlier bytes were streaming.
        const current = await env.DB.prepare(`WITH subject AS (SELECT ? AS id)
          SELECT x.object_key, x.content_type FROM ${source.from} WHERE x.id=? AND (${source.own})`)
          .bind(userId, row.id).first<{ object_key: string; content_type: string }>()
        if (!current || current.object_key !== row.object_key) {
          exception(coverage, source.category, 'ORIGINAL_SOURCE_CHANGED')
          continue
        }
        let object: R2ObjectBody | null = null
        try { object = env.DRIVER_FILES ? await env.DRIVER_FILES.get(current.object_key) : null }
        catch { exception(coverage, source.category, 'ORIGINAL_STORAGE_UNAVAILABLE'); continue }
        if (!object) { exception(coverage, source.category, 'ORIGINAL_UNAVAILABLE'); continue }
        const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' } as Record<string, string>)[current.content_type] ?? 'bin'
        const name = `originals/${source.category}/${String(++originalNumber).padStart(8, '0')}.${extension}`
        yield { name, stream: object.body }
        coverage.counts.originals++
        // Small per-original association entries keep memory bounded and make
        // retained submission versions traceable without leaking object keys.
        yield textEntry(`originals/${source.category}/${String(originalNumber).padStart(8, '0')}.json`, JSON.stringify({ sourceCategory: source.category, sourceId: row.id, file: name }))
      }
    }
    exception(coverage, 'external_sources', 'CONTROLLER_SOURCE_REVIEW_REQUIRED')
    if ((coverage.counts.driver_applications ?? 0) > 0) exception(coverage, 'private_evidence_deletion_jobs', 'RETIRED_HISTORY_OWNERSHIP_RECONCILIATION_REQUIRED')
    coverage.complete = coverage.exceptions.length === 0
    yield textEntry('manifest.json', JSON.stringify({ formatVersion: 1, generatedAt, ...coverage, categories: sources.map((source) => source.category), ...formatNotes }, null, 2))
  })()
  return { entries, coverage }
}
