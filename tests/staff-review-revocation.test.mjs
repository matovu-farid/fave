import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { availabilityFixture } from './helpers/availability-fixture.mjs'
const {Hono}=createRequire(new URL('../fave-worker/package.json',import.meta.url))('hono')
function setup(t,handler){
 const f=availabilityFixture(t);f.grantReview()
 const app=new Hono();app.use('*',f.loadWorkerModule('review-access').reviewAccess);app.get('/private',c=>handler(c,f))
 f.response=()=>app.request('https://fave.test/private',{headers:{origin:'https://fave.test','x-test-user':'staff'}},{DB:f.DB,BETTER_AUTH_URL:'https://fave.test'})
 return f
}
test('a lock during private detail lookup prevents private response disclosure',async t=>{
 const f=setup(t,(c,f)=>{f.sql.exec('DELETE FROM review_session_proofs');return c.json({privateValue:'SYNTHETIC-PRIVATE'})})
 const response=await f.response();assert.equal(response.status,428)
 assert.doesNotMatch(await response.text(),/SYNTHETIC-PRIVATE/)
})
test('a later unlock cannot revive a private request that began before the lock',async t=>{
 const f=setup(t,(c,f)=>{
  f.insert('review_session_locks',{session_id:'staff-session',user_id:'staff',generation:1,locked_at:f.clock.now})
  return c.json({privateValue:'SYNTHETIC-PRIVATE'})
 })
 const response=await f.response();assert.equal(response.status,428)
 assert.doesNotMatch(await response.text(),/SYNTHETIC-PRIVATE/)
})
test('a retained private file stream stops after reviewer access is revoked and releases its source',async t=>{
 let cancelled=0,pulls=0
 const f=setup(t,()=>new Response(new ReadableStream({pull(c){c.enqueue(new TextEncoder().encode(`PRIVATE-${++pulls}`))},cancel(){cancelled++}},{highWaterMark:0})))
 const response=await f.response();assert.equal(response.status,200)
 const reader=response.body.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/PRIVATE-1/)
 f.sql.exec('DELETE FROM review_session_proofs')
 await assert.rejects(()=>reader.read())
 assert.equal(cancelled,1)
})
test('revocation while a private storage read is awaiting prevents that chunk from escaping',async t=>{
 let cancelled=0,produced=false
 const f=setup(t,(_c,f)=>new Response(new ReadableStream({pull(c){if(produced){c.close();return}produced=true;f.sql.exec('DELETE FROM review_session_proofs');c.enqueue(new TextEncoder().encode('PRIVATE-AFTER-LOCK'))},cancel(){cancelled++}},{highWaterMark:0})))
 const response=await f.response()
 if(response.status===428){assert.doesNotMatch(await response.text(),/PRIVATE-AFTER-LOCK/)}
 else await assert.rejects(()=>response.text())
 assert.equal(cancelled,1)
})

test('an unavailable final authorization check closes the private source and returns no private details',async t=>{
 let cancelled=0
 const f=setup(t,()=>new Response(new ReadableStream({cancel(){cancelled++}},{highWaterMark:0})))
 const prepare=f.DB.prepare.bind(f.DB)
 f.DB.prepare=query=>{
  const statement=prepare(query)
  if(query.includes('AND proof.verified_at=?'))statement.first=async()=>{throw Error('Synthetic private database failure')}
  return statement
 }
 const response=await f.response()
 assert.equal(response.status,503)
 assert.equal(cancelled,1)
 assert.doesNotMatch(await response.text(),/Synthetic private database failure/)
})
