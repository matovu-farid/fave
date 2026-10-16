import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {availabilityFixture} from './helpers/availability-fixture.mjs'
const require=createRequire(new URL('../fave-worker/package.json',import.meta.url))
const {build}=require('esbuild')
const directory=mkdtempSync(join(tmpdir(),'fave-review-hosting-'))
let worker

test.before(async()=>{
 const outfile=join(directory,'worker.mjs')
 await build({entryPoints:[new URL('../fave-worker/src/index.ts',import.meta.url).pathname],outfile,bundle:true,platform:'node',format:'esm',logLevel:'silent'})
 worker=(await import(pathToFileURL(outfile).href)).default
})
test.after(()=>rmSync(directory,{recursive:true,force:true}))

for(const path of ['/api/does-not-exist','/api/auth/does-not-exist','/health'])test(`${path} keeps API handling ahead of static assets`,async t=>{
 const f=availabilityFixture(t)
 let assets=0
 const response=await worker.fetch(new Request('https://fave.test'+path),{DB:f.DB,BETTER_AUTH_URL:'https://fave.test',BETTER_AUTH_SECRET:'synthetic-hosting-test-secret-32-characters',ASSETS:{fetch(){assets++;return new Response('<html>wrong fallback</html>')}}},{waitUntil(){}})
 assert.equal(response.status,path==='/health'?200:404)
 assert.match(response.headers.get('content-type'),/application\/json/)
 assert.equal(assets,0)
})

test('admin shell uses protected HTML headers and fetches no authenticated record',async t=>{
 const f=availabilityFixture(t)
 const response=await worker.fetch(new Request('https://fave.test/admin/drivers?id=opaque'),{DB:f.DB,ASSETS:{fetch(){return new Response('<html>static shell</html>',{headers:{'Content-Type':'text/html'}})}}},{waitUntil(){}})
 assert.equal(response.status,200)
 assert.equal(response.headers.get('Cache-Control'),'private, no-store')
 assert.equal(response.headers.get('X-Frame-Options'),'DENY')
 assert.match(response.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/)
 assert.equal(await response.text(),'<html>static shell</html>')
 assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM marketplace_audit_events').get().count,0)
})
