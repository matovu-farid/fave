import type { AuthBindings } from './auth'
import { freshSessionSql, liveSessionSql, sessionArgs, type ExportIdentity } from './account-export-access'
import type { ExportCoverage } from './account-export-types'

export const receiptColumns = `id,status,requested_at AS requestedAt,generated_at AS generatedAt,
 needs_follow_up AS needsFollowUp,downloaded_at AS downloadedAt,failure_code AS failureCode`
export type ExportReceipt = {id:string;status:string;requestedAt:number;generatedAt:number|null;needsFollowUp:number|boolean;downloadedAt:number|null;failureCode:string|null}
export function receipt(row: ExportReceipt) { return { ...row, needsFollowUp: !!row.needsFollowUp } }
export async function findReceipt(env: AuthBindings, userId: string, id: string) {
  const row = await env.DB.prepare(`SELECT ${receiptColumns} FROM account_export_requests WHERE id=? AND user_id=?`).bind(id,userId).first<ExportReceipt>()
  return row ? receipt(row) : null
}
export async function exportExceptions(env: AuthBindings,id:string) {
  return (await env.DB.prepare(`SELECT e.category,e.code,MAX(e.count) AS count FROM account_export_exceptions e
    JOIN account_export_generations g ON g.id=e.generation_id WHERE g.request_id=? GROUP BY e.category,e.code ORDER BY e.category,e.code`).bind(id).all()).results
}
export async function exportResponses(env: AuthBindings,id:string) {
  return (await env.DB.prepare(`SELECT id,message,created_at AS createdAt FROM account_export_responses WHERE request_id=? ORDER BY created_at,id`).bind(id).all()).results
}
export async function createExportRequest(env:AuthBindings, identity:ExportIdentity,key:string) {
  const now=Date.now(), id=crypto.randomUUID()
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO account_export_requests(id,user_id,request_key,status,requested_at,updated_at)
      SELECT ?,?,?,'requested',?,? WHERE EXISTS (${freshSessionSql})
      AND (SELECT COUNT(*) FROM account_export_requests WHERE user_id=? AND requested_at>?)<5
      ON CONFLICT(user_id,request_key) DO NOTHING`)
      .bind(id,identity.userId,key,now,now,...sessionArgs(identity,true,now),identity.userId,now-600000),
    env.DB.prepare(`INSERT INTO marketplace_audit_events(id,actor_user_id,actor_type,action,target_type,target_id,created_at)
      SELECT ?,?,'user','account_export_requested','account_export_request',?,? WHERE changes()=1`)
      .bind(crypto.randomUUID(),identity.userId,id,now),
  ])
  const row=await env.DB.prepare(`SELECT ${receiptColumns} FROM account_export_requests WHERE user_id=? AND request_key=?`).bind(identity.userId,key).first<ExportReceipt>()
  return row ? receipt(row) : null
}
export async function claimGeneration(env:AuthBindings,identity:ExportIdentity,requestId:string) {
  const now=Date.now(),generationId=crypto.randomUUID()
  const results=await env.DB.batch([
    env.DB.prepare(`INSERT INTO account_export_generations(id,request_id,started_at,status,lease_expires_at)
      SELECT ?,id,?,'streaming',? FROM account_export_requests r WHERE id=? AND user_id=?
      AND EXISTS (${freshSessionSql}) AND NOT EXISTS (SELECT 1 FROM account_export_generations g
        WHERE g.request_id=r.id AND g.status='streaming' AND g.lease_expires_at>?)`)
      .bind(generationId,now,now+900000,requestId,identity.userId,...sessionArgs(identity,true,now),now),
    env.DB.prepare(`UPDATE account_export_requests SET status='streaming',generation_id=?,updated_at=?,failure_code=NULL
      WHERE id=? AND EXISTS (SELECT 1 FROM account_export_generations WHERE id=?)`).bind(generationId,now,requestId,generationId),
    env.DB.prepare(`INSERT INTO marketplace_audit_events(id,actor_user_id,actor_type,action,target_type,target_id,created_at)
      SELECT ?,?,'user','account_export_download_started','account_export_request',?,? WHERE EXISTS(SELECT 1 FROM account_export_generations WHERE id=?)`)
      .bind(crypto.randomUUID(),identity.userId,requestId,now,generationId),
  ])
  return results[0].meta.changes===1 ? generationId : null
}
export async function finishGeneration(env:AuthBindings,identity:ExportIdentity,id:string,generationId:string,coverage:ExportCoverage|null,success=coverage!==null) {
  const now=Date.now(),status=success?'ready':'failed'
  const statements=[
    env.DB.prepare(`UPDATE account_export_generations SET status=?,finished_at=?,coverage_json=? WHERE id=? AND status='streaming' AND (?=0 OR EXISTS (${liveSessionSql}))`)
      .bind(status,now,coverage?JSON.stringify(coverage):null,generationId,success?1:0,...sessionArgs(identity,false,now)),
    env.DB.prepare(`UPDATE account_export_requests SET status=?,generated_at=CASE WHEN ?='ready' THEN ? ELSE generated_at END,
      needs_follow_up=MAX(needs_follow_up,?),updated_at=?,failure_code=?
      WHERE id=? AND generation_id=? AND EXISTS(SELECT 1 FROM account_export_generations WHERE id=? AND status=?)`).bind(status,status,now,coverage&&!coverage.complete?1:0,now,success?null:'EXPORT_GENERATION_FAILED',id,generationId,generationId,status),
    env.DB.prepare(`INSERT INTO marketplace_audit_events(id,actor_user_id,actor_type,action,target_type,target_id,created_at)
      SELECT ?,?,'user',?,'account_export_request',?,? WHERE changes()=1`).bind(crypto.randomUUID(),identity.userId,success?'account_export_generated':'account_export_failed',id,now),
  ]
  for(const e of coverage?.exceptions??[]) statements.push(env.DB.prepare(`INSERT OR IGNORE INTO account_export_exceptions(generation_id,category,code,count) VALUES(?,?,?,?)`).bind(generationId,e.category,e.code,e.count))
  const result=await env.DB.batch(statements)
  if(success && result[0].meta.changes!==1)throw new Error('Export session ended before completion')
}

// A terminated Worker cannot execute its stream failure callback. Reconcile a
// stale lease before returning status so the client can retry the same receipt.
export async function reconcileExportLeases(env:AuthBindings,userId:string) {
  const now=Date.now()
  await env.DB.batch([
    env.DB.prepare(`UPDATE account_export_generations SET status='failed',finished_at=?
      WHERE status='streaming' AND lease_expires_at<=? AND request_id IN
      (SELECT id FROM account_export_requests WHERE user_id=?)`).bind(now,now,userId),
    env.DB.prepare(`INSERT INTO marketplace_audit_events(id,actor_user_id,actor_type,action,target_type,target_id,created_at)
      SELECT lower(hex(randomblob(16))),?,'user','account_export_interrupted','account_export_request',id,?
      FROM account_export_requests r WHERE r.user_id=? AND r.status='streaming'
      AND EXISTS(SELECT 1 FROM account_export_generations g WHERE g.id=r.generation_id AND g.status='failed')`).bind(userId,now,userId),
    env.DB.prepare(`UPDATE account_export_requests SET status='failed',failure_code='EXPORT_GENERATION_FAILED',updated_at=?
      WHERE user_id=? AND status='streaming' AND EXISTS(SELECT 1 FROM account_export_generations g
      WHERE g.id=account_export_requests.generation_id AND g.status='failed')`).bind(now,userId),
  ])
}
