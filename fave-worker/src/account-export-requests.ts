import { Hono } from 'hono'
import type { AuthBindings } from './auth'
import { apiError } from './marketplace-auth'
import { exportIdentity, exportOriginAllowed, isFresh, EXPORT_FRESH_MS, freshSessionSql, liveSessionSql, sessionArgs, requireLiveExportSession, type ExportIdentity } from './account-export-access'
import { claimGeneration, createExportRequest, exportExceptions, exportResponses, findReceipt, finishGeneration, receipt, receiptColumns, reconcileExportLeases, type ExportReceipt } from './account-export-store'
import { prepareAccountExport } from './account-export-projection'
import { createExportZip } from './account-export-zip'
import type { ExportEntry } from './account-export-types'

const app=new Hono<{Bindings:AuthBindings;Variables:{identity:ExportIdentity}}>()
app.use('*',async(c,next)=>{
  c.header('Cache-Control','private, no-store');c.header('Pragma','no-cache')
  c.header('X-Content-Type-Options','nosniff');c.header('Referrer-Policy','no-referrer')
  const identity=await exportIdentity(c.env,c.req.raw)
  if(!identity)return c.json(apiError('UNAUTHORIZED','Sign in to continue.'),401)
  c.set('identity',identity)
  if(c.req.method==='GET'&&!c.req.path.endsWith('/archive'))await reconcileExportLeases(c.env,identity.userId)
  if(c.req.method!=='GET') {
    if(c.req.header('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return c.json(apiError('JSON_REQUIRED','Send this request as JSON.'),415)
  }
  if(!exportOriginAllowed(c.env,c.req.raw))return c.json(apiError('FORBIDDEN','Use Fave to access your information.'),403)
  return next()
})
function freshness(identity:ExportIdentity) {return {canDownload:isFresh(identity),freshUntil:isFresh(identity)?identity.createdAt+EXPORT_FRESH_MS:null}}
app.get('/',async c=>{
  const identity=c.get('identity')
  const after=c.req.query('after')
  const cursor=after?await c.env.DB.prepare('SELECT requested_at FROM account_export_requests WHERE id=? AND user_id=?').bind(after,identity.userId).first<{requested_at:number}>():null
  if(after&&!cursor)return c.json(apiError('INVALID_CURSOR','Refresh your account downloads.'),400)
  const rows=await c.env.DB.prepare(`SELECT ${receiptColumns} FROM account_export_requests WHERE user_id=?
    ${cursor?'AND (requested_at,id)<(?,?)':''} ORDER BY requested_at DESC,id DESC LIMIT 151`)
    .bind(identity.userId,...(cursor?[cursor.requested_at,after!]:[])).all<ExportReceipt>()
  return c.json({requests:rows.results.slice(0,150).map(receipt),nextCursor:rows.results.length>150?rows.results[149].id:null,...freshness(identity)})
})
app.post('/',async c=>{
  const identity=c.get('identity')
  if(!isFresh(identity))return c.json(apiError('SIGN_IN_AGAIN','Sign in again to download private information.'),428)
  const body=await c.req.json().catch(()=>null) as {confirmed?:unknown;requestKey?:unknown}|null
  if(body?.confirmed!==true||typeof body.requestKey!=='string'||!/^[A-Za-z0-9_.:-]{1,128}$/.test(body.requestKey))return c.json(apiError('CONFIRMATION_REQUIRED','Confirm the download request.'),400)
  try {
    const request=await createExportRequest(c.env,identity,body.requestKey)
    if(!await c.env.DB.prepare(liveSessionSql).bind(...sessionArgs(identity)).first())return c.json(apiError('UNAUTHORIZED','Sign in to continue.'),401)
    if(!request)return c.json(apiError('EXPORT_REQUEST_LIMIT','Wait a few minutes before requesting another copy.'),429)
    return c.json({request,...freshness(identity)})
  }catch{return c.json(apiError('EXPORT_UNAVAILABLE','Your request could not be saved. Please try again.'),503)}
})
app.get('/:id',async c=>{
  const identity=c.get('identity'),request=await findReceipt(c.env,identity.userId,c.req.param('id'))
  if(!request)return c.json(apiError('NOT_FOUND','Download request not found.'),404)
  return c.json({request,...freshness(identity),responses:await exportResponses(c.env,request.id),exceptions:await exportExceptions(c.env,request.id)})
})
app.post('/:id/acknowledge',async c=>{
  const identity=c.get('identity'),id=c.req.param('id'),now=Date.now()
  const request=await findReceipt(c.env,identity.userId,id)
  if(!request)return c.json(apiError('NOT_FOUND','Download request not found.'),404)
  const results=await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE account_export_requests SET downloaded_at=COALESCE(downloaded_at,?),updated_at=? WHERE id=? AND user_id=? AND status='ready' AND EXISTS (${liveSessionSql})`).bind(now,now,id,identity.userId,...sessionArgs(identity,false,now)),
    c.env.DB.prepare(`INSERT INTO marketplace_audit_events(id,actor_user_id,actor_type,action,target_type,target_id,created_at)
      SELECT ?,?,'user','account_export_receipt_acknowledged','account_export_request',?,? WHERE changes()=1`).bind(crypto.randomUUID(),identity.userId,id,now),
  ])
  if(!results[0].meta.changes)return c.json(apiError('EXPORT_NOT_READY','Download the available archive before confirming receipt.'),409)
  return c.json({request:await findReceipt(c.env,identity.userId,id),...freshness(identity)})
})
app.get('/:id/archive',async c=>{
  const identity=c.get('identity'),id=c.req.param('id')
  if(!isFresh(identity))return c.json(apiError('SIGN_IN_AGAIN','Sign in again to download private information.'),428)
  if(!await findReceipt(c.env,identity.userId,id))return c.json(apiError('NOT_FOUND','Download request not found.'),404)
  let generationId:string|null
  try {generationId=await claimGeneration(c.env,identity,id)}catch{return c.json(apiError('EXPORT_UNAVAILABLE','The download could not start. Please try again.'),503)}
  if(!generationId) {
    if(!await c.env.DB.prepare(liveSessionSql).bind(...sessionArgs(identity)).first())return c.json(apiError('UNAUTHORIZED','Sign in to continue.'),401)
    if(!await c.env.DB.prepare(freshSessionSql).bind(...sessionArgs(identity,true)).first())return c.json(apiError('SIGN_IN_AGAIN','Sign in again to download private information.'),428)
    return c.json(apiError('EXPORT_IN_PROGRESS','This download is already being prepared. Refresh its status before retrying.'),409)
  }
  const generation=generationId
  // Revalidation also renews the bounded generation lease. Revocation wins over
  // later file reads and over the next long-transfer chunk check.
  const authorize=async()=>{
    await requireLiveExportSession(c.env,identity)
    const result=await c.env.DB.prepare(`UPDATE account_export_generations SET lease_expires_at=? WHERE id=? AND status='streaming'
      AND EXISTS(SELECT 1 FROM account_export_requests WHERE id=? AND generation_id=?)`).bind(Date.now()+900000,generation,id,generation).run()
    if(result.meta.changes!==1)throw new Error('Export generation superseded')
  }
  let prepared
  try {prepared=prepareAccountExport(c.env,identity.userId,Date.now())}catch{
    await finishGeneration(c.env,identity,id,generation,null)
    return c.json(apiError('EXPORT_UNAVAILABLE','The download could not start. Please try again.'),503)
  }
  const source=prepared
  async function* guardedEntries():AsyncIterable<ExportEntry> {
    for await(const entry of source.entries) {
      let reader:ReadableStreamDefaultReader<Uint8Array>|undefined
      let released=false
      const cleanup=async(reason?:unknown)=>{
        if(released)return
        released=true
        if(reader){try{await reader.cancel(reason)}finally{reader.releaseLock()}}
        else await entry.stream.cancel(reason)
      }
      try {
        await authorize()
        reader=entry.stream.getReader()
        let checked=Date.now(),bytes=0
        yield {name:entry.name,stream:new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              if(Date.now()-checked>=1000||bytes>=1048576){await authorize();checked=Date.now();bytes=0}
              const next=await reader!.read()
              // Storage may have stalled while sign-out revoked the session.
              if(Date.now()-checked>=1000){await authorize();checked=Date.now();bytes=0}
              if(next.done){released=true;reader!.releaseLock();controller.close()}
              else {bytes+=next.value.byteLength;controller.enqueue(next.value)}
            }catch(error){await cleanup(error);controller.error(error)}
          },
          cancel:cleanup,
        },{highWaterMark:0})}
      }finally{await cleanup()}
    }
  }
  const body=createExportZip(guardedEntries(),{
    beforeEntry:authorize,
    onComplete:async()=>{await authorize();await finishGeneration(c.env,identity,id,generation,source.coverage)},
    onFailure:async()=>{await finishGeneration(c.env,identity,id,generation,source.coverage,false)},
  })
  return new Response(body,{headers:{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="fave-information-${id}.zip"`,
    'Cache-Control':'private, no-store','Pragma':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}})
})
export default app
