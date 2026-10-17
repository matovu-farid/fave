import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

test('account helpers use authenticated self-service paths, explicit confirmation and uncached audited detail access',async()=>{
  const calls=[],module={exports:{}}
  const code=ts.transpileModule(readFileSync(new URL('../src/lib/account-lifecycle.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText
  vm.runInNewContext(code,{module,exports:module.exports,JSON,encodeURIComponent,require(name){assert.equal(name,'./api');return {authenticatedFetch:async(path,init)=>{calls.push({path,init});return {requests:[]}}}}})
  const api=module.exports
  await api.getAccountDeletionRequest()
  await api.requestAccountDeletion()
  assert.deepEqual(await api.getAccountRequestQueue(),[])
  await api.getAccountRequestDetail('opaque/id')
  assert.deepEqual(calls.map(({path})=>path),['/api/account/deletion-request','/api/account/deletion-request','/api/admin/account-requests/pending','/api/admin/account-requests/opaque%2Fid/detail'])
  assert.ok(calls.every(({init})=>init.cache==='no-store'))
  assert.equal(calls[1].init.method,'POST')
  assert.deepEqual(JSON.parse(calls[1].init.body),{confirmed:true})
  assert.equal(calls[3].init.method,'POST','sensitive detail opening is an audited operation')
  assert.deepEqual(JSON.parse(calls[3].init.body),{})
})

test('account request page encodes an opaque cursor and preserves the server continuation',async()=>{
  const calls=[],module={exports:{}},page={requests:[],nextCursor:'opaque-next'}
  const code=ts.transpileModule(readFileSync(new URL('../src/lib/account-lifecycle.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText
  vm.runInNewContext(code,{module,exports:module.exports,JSON,encodeURIComponent,require(){return {authenticatedFetch:async(path,init)=>{calls.push({path,init});return page}}}})
  assert.equal(await module.exports.getAccountRequestPage('opaque/previous+id'),page)
  assert.equal(calls[0].path,'/api/admin/account-requests/pending?after=opaque%2Fprevious%2Bid')
  assert.equal(calls[0].init.cache,'no-store')
})
