import type { AuthBindings } from './auth'

type EvidenceType = 'driver_application_document' | 'vehicle_media'
const sources = {
  driver_application_document: { table: 'driver_application_documents', guard: '', action: 'driver_document_retention' },
  vehicle_media: { table: 'vehicle_media', guard: "AND media_kind != 'client_photo'", action: 'vehicle_evidence_retention' },
} as const

// Only static, internal table/guard values enter SQL. Each object's own saved
// deadline controls retirement; an application's newer TTL cannot shorten it.
export function evidenceRetirement(
  env: AuthBindings,
  type: EvidenceType,
  evidence: { id: string; object_key: string },
  now: number,
) {
  const source = sources[type]
  const jobId = crypto.randomUUID()
  return {
    jobId,
    statements: [
      env.DB.prepare(`INSERT INTO private_evidence_deletion_jobs
        (id, target_type, target_id, object_key, created_at)
        SELECT ?, ?, id, object_key, ? FROM ${source.table}
        WHERE id = ? AND object_key = ? AND retention_expires_at IS NOT NULL
          AND retention_expires_at <= ? ${source.guard}`)
        .bind(jobId, type, now, evidence.id, evidence.object_key, now),
      env.DB.prepare(`DELETE FROM ${source.table} WHERE id = ? AND object_key = ?
        AND EXISTS (SELECT 1 FROM private_evidence_deletion_jobs WHERE id = ?)`)
        .bind(evidence.id, evidence.object_key, jobId),
      env.DB.prepare(`INSERT INTO marketplace_audit_events
        (id, actor_user_id, actor_type, action, target_type, target_id, reason, prior_state, new_state, created_at)
        SELECT ?, NULL, 'system', ?, ?, ?, 'Expired private evidence retired; object deletion pending.',
          'stored', 'deletion_pending', ? WHERE changes() = 1`)
        .bind(crypto.randomUUID(), `${source.action}_deletion_queued`, type, evidence.id, now),
    ],
  }
}

// R2 and D1 cannot commit atomically. Durable jobs keep retries possible after a
// storage error or crash, while retired evidence is no longer reviewable. R2
// deletion is idempotent; a completion audit is committed only once.
export async function deleteRetiredEvidence(env: AuthBindings, type: EvidenceType): Promise<number> {
  if (!env.DRIVER_FILES) return 0
  const jobs = await env.DB.prepare(`SELECT job.id, job.target_id, job.object_key
    FROM private_evidence_deletion_jobs AS job WHERE job.target_type = ?
      AND NOT EXISTS (SELECT 1 FROM driver_application_documents WHERE object_key = job.object_key)
      AND NOT EXISTS (SELECT 1 FROM vehicle_media WHERE object_key = job.object_key)
    ORDER BY job.last_attempt_at, job.created_at, job.id LIMIT 100`)
    .bind(type).all<{ id: string; target_id: string; object_key: string }>()
  let deleted = 0
  for (const job of jobs.results) {
    try {
      await env.DB.prepare(`UPDATE private_evidence_deletion_jobs SET attempts = attempts + 1,
        last_attempt_at = ?, last_error_code = NULL WHERE id = ?`).bind(Date.now(), job.id).run()
      try {
        await env.DRIVER_FILES.delete(job.object_key)
      } catch {
        await env.DB.prepare(`UPDATE private_evidence_deletion_jobs SET last_error_code = 'R2_DELETE_FAILED'
          WHERE id = ?`).bind(job.id).run()
        continue
      }
      const result = await env.DB.batch([
        env.DB.prepare('DELETE FROM private_evidence_deletion_jobs WHERE id = ?').bind(job.id),
        env.DB.prepare(`INSERT INTO marketplace_audit_events
          (id, actor_user_id, actor_type, action, target_type, target_id, reason, prior_state, new_state, created_at)
          SELECT ?, NULL, 'system', ?, ?, ?, 'Expired private evidence object deletion confirmed.',
            'deletion_pending', 'deleted', ? WHERE changes() = 1`)
          .bind(crypto.randomUUID(), `${sources[type].action}_expired`, type, job.target_id, Date.now()),
      ])
      deleted += result[0]?.meta.changes === 1 ? 1 : 0
    } catch {
      // Leave the durable job for another sweep. Never copy storage errors or
      // private object keys into routine logs.
    }
  }
  return deleted
}
