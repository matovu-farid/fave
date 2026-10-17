import test from 'node:test'
import assert from 'node:assert/strict'
import { availabilityFixture } from './helpers/availability-fixture.mjs'

const base='/api/account/exports'
function setup(t,{failStream=false,followUp=false,project}={}) {
  const f=availabilityFixture(t,{modules:{'account-export-projection':{
    prepareAccountExport:()=>{
      if(project)return project(f)
      const coverage={complete:!followUp,counts:{account:1},exceptions:followUp?[{category:'review',code:'mixed_person_record',count:1}]:[]}
      return {coverage,entries:(async function*(){
        yield {name:'account.json',stream:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"name":"Synthetic"}'));c.close()}})}
        if(failStream)throw Error('synthetic private storage outage; never report contents')
        yield {name:'manifest.json',stream:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(JSON.stringify(coverage)));c.close()}})}
      })()}
    },
  }}})
  const worker=f.loadWorkerModule('index').default
  f.api=async(method,path,{user='client-1',body,headers={},raw=false}={})=>{
    const response=await worker.fetch(new Request(`https://fave.test${path}`,{
      method,headers:{origin:'https://fave.test','content-type':'application/json',...(user?{'x-test-user':user}:{}),...headers},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),
    }),{DB:f.DB,BETTER_AUTH_URL:'https://fave.test'},{waitUntil(){}})
    if(raw)return response
    return {status:response.status,headers:response.headers,body:await response.json()}
  }
  f.create=(key='first')=>f.api('POST',base,{body:{confirmed:true,requestKey:key}})
  return f
}

test('automatic export receipt is confirmed, fresh-session-owned, idempotent and audited once',async t=>{
  const f=setup(t)
  assert.equal((await f.api('GET',base,{user:null})).status,401)
  assert.equal((await f.create()).status,200)
  const first=await f.create()
  assert.equal(first.body.request.status,'requested')
  assert.equal((await f.create()).body.request.id,first.body.request.id)
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM marketplace_audit_events WHERE action='account_export_requested'").get().n,1)
  assert.equal((await f.api('GET',base,{user:'client-2'})).body.requests.length,0)
  assert.equal((await f.api('GET',`${base}/${first.body.request.id}`,{user:'client-2'})).status,404)
  assert.equal((await f.api('POST',base,{body:{confirmed:false,requestKey:'bad'}})).status,400)
  assert.equal((await f.api('POST',base,{body:{confirmed:true,requestKey:'bad'},headers:{origin:'https://evil.test'}})).status,403)
  assert.equal((await f.api('POST',base,{body:{confirmed:true,requestKey:'bad'},headers:{'content-type':'text/plain'}})).status,415)
  assert.match(first.headers.get('cache-control'),/no-store/)
  assert.throws(()=>f.sql.exec('UPDATE account_export_requests SET requested_at=0'),/immutable/)
})

test('old sessions can see receipts but must sign in again before requesting or downloading an archive',async t=>{
  const f=setup(t)
  const saved=await f.create()
  assert.equal(saved.status,200)
  f.clock.now+=600001
  const list=await f.api('GET',base)
  assert.equal(list.status,200)
  assert.equal(list.body.canDownload,false)
  assert.equal((await f.create('second')).status,428)
  assert.equal((await f.api('GET',`${base}/${saved.body.request.id}/archive`)).status,428)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM account_export_generations').get().n,0)
})

test('deletion request does not prevent private export; generation and receipt acknowledgement remain distinct',async t=>{
  const f=setup(t)
  assert.equal((await f.api('POST','/api/account/deletion-request',{body:{confirmed:true}})).status,200)
  const saved=await f.create()
  assert.equal(saved.status,200)
  const path=`${base}/${saved.body.request.id}`
  assert.equal((await f.api('GET',`${path}/archive`,{user:'client-2'})).status,404)
  const archive=await f.api('GET',`${path}/archive`,{raw:true})
  assert.equal(archive.status,200)
  assert.match(archive.headers.get('content-disposition'),/^attachment;/)
  assert.match(archive.headers.get('cache-control'),/private, no-store/)
  const bytes=new Uint8Array(await archive.arrayBuffer())
  assert.equal(bytes[0],0x50);assert.equal(bytes[1],0x4b)
  const detail=await f.api('GET',path)
  assert.equal(detail.body.request.status,'ready')
  assert.equal(detail.body.request.downloadedAt,null)
  assert.equal((await f.api('POST',`${path}/acknowledge`,{body:{}})).status,200)
  assert.equal((await f.api('GET',path)).body.request.downloadedAt,f.clock.now)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM account_deletion_requests').get().n,1)
})

test('request audit failure rolls back receipt and retry never claims unsaved success',async t=>{
  const f=setup(t)
  f.sql.exec("CREATE TRIGGER fail_export_audit BEFORE INSERT ON marketplace_audit_events WHEN NEW.action='account_export_requested' BEGIN SELECT RAISE(ABORT,'outage'); END")
  assert.equal((await f.create()).status,503)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM account_export_requests').get().n,0)
})

test('failed archive stream is not marked ready or acknowledged',async t=>{
  const f=setup(t,{failStream:true})
  const saved=await f.create();assert.equal(saved.status,200)
  const path=`${base}/${saved.body.request.id}`
  const response=await f.api('GET',`${path}/archive`,{raw:true})
  assert.equal(response.status,200)
  await assert.rejects(()=>response.arrayBuffer())
  const detail=await f.api('GET',path)
  assert.equal(detail.body.request.status,'failed')
  assert.equal(detail.body.request.failureCode,'EXPORT_GENERATION_FAILED')
  assert.equal(detail.body.request.downloadedAt,null)
  assert.equal((await f.api('POST',`${path}/acknowledge`,{body:{}})).status,409)
  assert.equal(JSON.stringify(detail.body).includes('private storage'),false)
})

test('revocation after authorization prevents generation and private bytes',async t=>{
  const f=setup(t)
  const saved=await f.create();assert.equal(saved.status,200)
  const batch=f.DB.batch.bind(f.DB)
  f.DB.batch=async statements=>{
    f.sql.exec("DELETE FROM session WHERE userId='client-1'")
    return batch(statements)
  }
  const response=await f.api('GET',`${base}/${saved.body.request.id}/archive`)
  assert.equal(response.status,401)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM account_export_generations').get().n,0)
})

test('exceptional material remains tracked; owner access and written response require current review proof',async t=>{
  const f=setup(t,{followUp:true})
  const saved=await f.create();assert.equal(saved.status,200)
  const path=`${base}/${saved.body.request.id}`
  await (await f.api('GET',`${path}/archive`,{raw:true})).arrayBuffer()
  const detail=await f.api('GET',path)
  assert.equal(detail.body.request.status,'ready')
  assert.equal(detail.body.request.needsFollowUp,true)
  assert.equal(detail.body.exceptions[0].code,'mixed_person_record')
  const admin='/api/admin/account-exports'
  assert.equal((await f.api('GET',`${admin}/pending`,{user:'staff'})).status,403)
  f.grantReview()
  const queue=await f.api('GET',`${admin}/pending`,{user:'staff'})
  assert.equal(queue.status,200)
  assert.equal(queue.body.requests[0].email,undefined)
  const staffPath=`${admin}/${saved.body.request.id}`
  assert.equal((await f.api('POST',`${staffPath}/detail`,{user:'staff'})).status,200)
  const message='We are reviewing the mixed-person record and will send a written access decision.'
  assert.equal((await f.api('POST',`${staffPath}/decision`,{user:'staff',body:{message}})).status,200)
  assert.equal((await f.api('GET',path)).body.responses[0].message,message)
  f.sql.exec('DELETE FROM review_session_proofs')
  assert.equal((await f.api('POST',`${staffPath}/detail`,{user:'staff'})).status,428)
  assert.equal((await f.api('POST',`${staffPath}/decision`,{user:'staff',body:{message}})).status,428)
})

test('exceptions discovered before a later stream failure remain durable owner follow-up',async t=>{
  const f=setup(t,{followUp:true,failStream:true})
  const saved=await f.create()
  const path=`${base}/${saved.body.request.id}`
  await assert.rejects((await f.api('GET',`${path}/archive`,{raw:true})).arrayBuffer())
  const detail=await f.api('GET',path)
  assert.equal(detail.body.request.status,'failed')
  assert.equal(detail.body.request.needsFollowUp,true)
  assert.deepEqual(detail.body.exceptions,[{category:'review',code:'mixed_person_record',count:1}])
  f.grantReview()
  const owner=await f.api('POST',`/api/admin/account-exports/${saved.body.request.id}/detail`,{user:'staff'})
  assert.equal(owner.status,200)
  assert.equal(owner.body.request.exceptions[0].code,'mixed_person_record')
})

test('revocation as the projector yields an original cancels its unopened stream',async t=>{
  let cancelled=0;let returned=0;let original
  const f=setup(t,{project:fixture=>({coverage:{complete:false,exceptions:[],counts:{}},entries:(async function*(){
    try {
      original=new ReadableStream({cancel(){cancelled++}},{highWaterMark:0})
      fixture.sql.exec("DELETE FROM session WHERE userId='client-1'")
      yield {name:'originals/id.png',stream:original}
    }finally{returned++}
  })()})})
  const saved=await f.create()
  const response=await f.api('GET',`${base}/${saved.body.request.id}/archive`,{raw:true})
  await assert.rejects(response.arrayBuffer())
  assert.equal(cancelled,1)
  assert.equal(returned,1)
  assert.equal(original.locked,false)
  assert.equal(f.sql.prepare('SELECT status FROM account_export_requests').get().status,'failed')
})

test('a stalled original read reauthorizes before releasing bytes and cleans its reader on revocation',async t=>{
  let cancelled=0;let original
  const canary='PRIVATE-BYTES-ARRIVED-AFTER-REVOCATION'
  const f=setup(t,{project:fixture=>({coverage:{complete:true,exceptions:[],counts:{}},entries:(async function*(){
    original=new ReadableStream({
      async pull(controller){
        await Promise.resolve()
        fixture.clock.now+=2000
        fixture.sql.exec("DELETE FROM session WHERE userId='client-1'")
        controller.enqueue(new TextEncoder().encode(canary))
      },cancel(){cancelled++},
    },{highWaterMark:0})
    yield {name:'originals/id.png',stream:original}
  })()})})
  const saved=await f.create()
  const response=await f.api('GET',`${base}/${saved.body.request.id}/archive`,{raw:true})
  const received=[]
  await assert.rejects(async()=>{for await(const chunk of response.body)received.push(chunk)})
  assert.equal(Buffer.concat(received).includes(Buffer.from(canary)),false)
  assert.equal(cancelled,1)
  assert.equal(original.locked,false)
  assert.equal(f.sql.prepare('SELECT status FROM account_export_requests').get().status,'failed')
})

test('revocation at the completion transaction prevents ready status and generated audit',async t=>{
  const f=setup(t)
  const saved=await f.create()
  const batch=f.DB.batch.bind(f.DB)
  let revoked=false
  f.DB.batch=async statements=>{
    if(!revoked&&statements[0].query.includes('UPDATE account_export_generations SET status=')){
      revoked=true
      f.sql.exec("DELETE FROM session WHERE userId='client-1'")
    }
    return batch(statements)
  }
  const response=await f.api('GET',`${base}/${saved.body.request.id}/archive`,{raw:true})
  await assert.rejects(response.arrayBuffer())
  assert.equal(f.sql.prepare('SELECT status FROM account_export_requests').get().status,'failed')
  assert.equal(f.sql.prepare('SELECT status FROM account_export_generations').get().status,'failed')
  assert.equal(f.sql.prepare("SELECT count(*) AS n FROM marketplace_audit_events WHERE action='account_export_generated'").get().n,0)
})

test('an abandoned generation becomes retryable after its lease expires',async t=>{
  const f=setup(t)
  const saved=await f.create()
  const identity={userId:'client-1',sessionId:'client-1-session',createdAt:f.clock.now}
  await f.loadWorkerModule('account-export-store').claimGeneration({DB:f.DB},identity,saved.body.request.id)
  f.clock.now+=900001
  const list=await f.api('GET',base)
  assert.equal(list.body.requests[0].status,'failed')
  const detail=await f.api('GET',`${base}/${saved.body.request.id}`)
  assert.equal(detail.body.request.status,'failed')
})

test('own receipt history uses bounded ownership-scoped pages without dropping the older page',async t=>{
 const f=setup(t)
 for(let i=0;i<151;i++)f.insert('account_export_requests',{id:`receipt-${String(i).padStart(3,'0')}`,user_id:'client-1',request_key:`seed-${i}`,status:'requested',requested_at:f.clock.now+i,updated_at:f.clock.now+i})
 const first=await f.api('GET',base)
 assert.equal(first.body.requests.length,150)
 assert.ok(first.body.nextCursor)
 const second=await f.api('GET',`${base}?after=${first.body.nextCursor}`)
 assert.equal(second.body.requests.length,1)
 assert.equal(second.body.nextCursor,null)
 assert.equal(new Set([...first.body.requests,...second.body.requests].map(r=>r.id)).size,151)
 assert.equal((await f.api('GET',`${base}?after=${first.body.nextCursor}`,{user:'client-2'})).status,400)
})
