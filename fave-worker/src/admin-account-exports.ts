import { Hono } from 'hono'
import { apiError } from './marketplace-auth'
import { reviewAccess, reviewGuardBindings, reviewGuardSelect, type ReviewEnvironment } from './review-access'
import { receipt, receiptColumns, type ExportReceipt } from './account-export-store'
const app=new Hono<ReviewEnvironment>()
app.use('*',reviewAccess)
app.get('/pending',async c=>{
  const after=c.req.query('after')
  const cursor=after?await c.env.DB.prepare('SELECT requested_at FROM account_export_requests WHERE id=?').bind(after).first<{requested_at:number}>():null
  if(after&&!cursor)return c.json(apiError('INVALID_CURSOR','Refresh the account download queue.'),400)
  const rows=await c.env.DB.prepare(`SELECT id,status,requested_at AS requestedAt,needs_follow_up AS needsFollowUp
    FROM account_export_requests ${cursor?'WHERE (requested_at,id)>(?,?)':''} ORDER BY requested_at,id LIMIT 151`)
    .bind(...(cursor?[cursor.requested_at,after!]:[])).all<{id:string;needsFollowUp:number}>()
  return c.json({requests:rows.results.slice(0,150).map(r=>({...r,needsFollowUp:!!r.needsFollowUp})),nextCursor:rows.results.length>150?rows.results[149].id:null})
})
app.post('/:id/detail',async c=>{
  const authorization=c.get('reviewAuthorization'),session=authorization.session,now=Date.now(),audit=crypto.randomUUID(),id=c.req.param('id')
  const results=await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO marketplace_audit_events(id,actor_user_id,actor_type,action,target_type,target_id,created_at)
      SELECT ?,?,'user','account_export_request_viewed','account_export_request',id,? FROM account_export_requests
      WHERE id=? AND EXISTS (${reviewGuardSelect})`).bind(audit,session.user.id,now,id,...reviewGuardBindings(authorization,now)),
    c.env.DB.prepare(`SELECT ${receiptColumns} FROM account_export_requests WHERE id=? AND EXISTS(SELECT 1 FROM marketplace_audit_events WHERE id=?)`).bind(id,audit),
    c.env.DB.prepare(`SELECT user.id AS userId,user.name,user.email FROM user JOIN account_export_requests r ON r.user_id=user.id
      WHERE r.id=? AND EXISTS(SELECT 1 FROM marketplace_audit_events WHERE id=?)`).bind(id,audit),
    c.env.DB.prepare(`SELECT e.category,e.code,MAX(e.count) AS count FROM account_export_exceptions e JOIN account_export_generations g ON g.id=e.generation_id
      WHERE g.request_id=? AND EXISTS(SELECT 1 FROM marketplace_audit_events WHERE id=?) GROUP BY e.category,e.code`).bind(id,audit),
    c.env.DB.prepare(`SELECT id,message,created_at AS createdAt FROM account_export_responses WHERE request_id=? AND EXISTS(SELECT 1 FROM marketplace_audit_events WHERE id=?) ORDER BY created_at,id`).bind(id,audit),
  ])
  const row=results[1].results[0] as ExportReceipt|undefined
  if(!row)return c.json(apiError('REVIEW_UNLOCK_REQUIRED','Unlock reviews again or refresh the queue.'),428)
  return c.json({request:{...receipt(row),...(results[2].results[0] as {userId:string;name:string;email:string}),exceptions:results[3].results,responses:results[4].results}})
})
app.post('/:id/decision',async c=>{
  if(c.req.header('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return c.json(apiError('JSON_REQUIRED','Send this response as JSON.'),415)
  const body=await c.req.json().catch(()=>null) as {message?:unknown}|null
  if(typeof body?.message!=='string'||!body.message.trim()||body.message.length>4000)return c.json(apiError('INVALID_RESPONSE','Write a response of up to 4,000 characters.'),400)
  const authorization=c.get('reviewAuthorization'),session=authorization.session,now=Date.now(),id=c.req.param('id'),responseId=crypto.randomUUID()
  const results=await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO account_export_responses(id,request_id,actor_user_id,message,created_at)
      SELECT ?,id,?,?,? FROM account_export_requests WHERE id=? AND EXISTS (${reviewGuardSelect})`)
      .bind(responseId,session.user.id,body.message.trim(),now,id,...reviewGuardBindings(authorization,now)),
    c.env.DB.prepare(`INSERT INTO marketplace_audit_events(id,actor_user_id,actor_type,action,target_type,target_id,created_at)
      SELECT ?,?,'user','account_export_response_recorded','account_export_request',?,? WHERE changes()=1`).bind(crypto.randomUUID(),session.user.id,id,now),
  ])
  if(!results[0].meta.changes)return c.json(apiError('REVIEW_UNLOCK_REQUIRED','Unlock reviews again or refresh the queue.'),428)
  return c.json({saved:true})
})
export default app
