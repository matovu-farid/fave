import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => {resolve=yes;reject=no}); return {promise,resolve,reject} }
function harness(overrides={}) {
  const slots=[], effects=[], focuses=new Set(), listeners=new Set(), appListeners=new Set(); let cursor=0,dirty=true,value,active=true,user='owner',session='session-1',id='driver-app',status='approved',unlocked=true
  const document={hidden:false,addEventListener(_e,cb){listeners.add(cb)},removeEventListener(_e,cb){listeners.delete(cb)}}
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]))
  const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;dirty=true}]},useRef(initial){return slots[cursor++]??={current:initial}},useCallback(cb,deps){const i=cursor++;if(!same(slots[i]?.deps,deps))slots[i]={deps,cb};return slots[i].cb},useEffect(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps)){const old=slots[i],slot=slots[i]={deps};effects.push(()=>{old?.cleanup?.();slot.cleanup=fn()})}}}
  react.useLayoutEffect=react.useEffect
  class ApiError extends Error { constructor(message,code,status){super(message);this.status=status} }
  const services={getOperationsPage:async()=>({items:[{id:'driver-app',label:'Driver'}],nextCursor:null}),getOperationsDetail:async()=>({driver:{id:'driver-app',label:'Private driver',version:0},reason:'Private internal reason'}),...overrides}
  const access={unlocked:true,security:{expiresAt:Date.now()+600000},clear(){unlocked=false;dirty=true},async refresh(){}}
  const module={exports:{}}
  const code=ts.transpileModule(readFileSync(new URL('../src/hooks/use-private-operations.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText
  vm.runInNewContext(code,{module,exports:module.exports,console,Date,Error,Promise,Symbol,document,require(name){
    if(name==='react')return react
    if(name==='expo-router')return {useFocusEffect(cb){react.useEffect(()=>{const entry={cb,cleanup:active?cb():null};focuses.add(entry);return ()=>{entry.cleanup?.();focuses.delete(entry)}},[cb])}}
    if(name==='react-native')return {Platform:{OS:'web'},AppState:{currentState:'active',addEventListener(_e,cb){appListeners.add(cb);return {remove(){appListeners.delete(cb)}}}}}
    if(name==='@/lib/auth-client')return {authClient:{useSession:()=>({data:user?{user:{id:user},session:{id:session}}:null})}}
    if(name==='@/lib/driver-operations')return services
    if(name==='@/lib/api')return {ApiError}
    if(name==='@/lib/staff-review')return {lockReviews:async()=>{}}
    throw Error(name)
  }})
  async function settle(){for(let i=0;i<25;i++){if(dirty){cursor=0;dirty=false;access.unlocked=unlocked;value=module.exports.usePrivateOperations('drivers',status,id,access);while(effects.length)effects.shift()()}await new Promise(r=>setImmediate(r));if(!dirty)return}throw Error('did not settle')}
  return {settle,get v(){return value},blur(){active=false;for(const f of focuses){f.cleanup?.();f.cleanup=null}},focus(){active=true;for(const f of focuses)f.cleanup=f.cb()},hide(){document.hidden=true;for(const cb of listeners)cb()},show(){document.hidden=false;for(const cb of listeners)cb()},background(){for(const cb of appListeners)cb('background')},user(u,s=session){user=u;session=s;dirty=true},lock(){unlocked=false;dirty=true},select(next){id=next;dirty=true},filter(next){status=next;dirty=true},ApiError}
}

test('private operational detail and drafts clear on blur and cannot return from a late read',async()=>{
  const pending=deferred(),h=harness({getOperationsDetail:()=>pending.promise});await h.settle()
  h.v.open();await h.settle();h.v.setField('reason','Private draft');h.blur();h.focus();await h.settle()
  pending.resolve({reason:'Late private detail'});await h.settle()
  assert.equal(h.v.detail,null);assert.equal(h.v.draft.reason,'')
})
for(const event of ['hide','background','lock','user','session','select','filter'])test(`${event} invalidates operational detail and drafts`,async()=>{
  const h=harness();await h.settle();h.v.open();await h.settle();assert.ok(h.v.detail)
  h.v.setField('reason','Private draft');await h.settle()
  if(event==='user')h.user('other');else if(event==='session')h.user('owner','session-2');else if(event==='select')h.select('another');else if(event==='filter')h.filter('suspended');else h[event]()
  await h.settle();assert.equal(h.v.detail,null);assert.equal(h.v.draft.reason,'')
})
test('duplicate operational action presses send one write and stale completion stays hidden after lock',async()=>{
  const pending=deferred(),h=harness();await h.settle();h.v.open();await h.settle();let writes=0
  const action=()=>{writes++;return pending.promise};h.v.submit(action);h.v.submit(action);await h.settle();assert.equal(writes,1)
  h.lock();await h.settle();pending.resolve({});await h.settle();assert.equal(h.v.detail,null);assert.equal(h.v.message,'')
})
test('conflicts discard stale decision context and require explicit detail refresh',async()=>{
  const h=harness();await h.settle();h.v.open();await h.settle();h.v.setField('reason','Draft reason');await h.settle()
  await h.v.submit(async()=>{throw new h.ApiError('Refresh before deciding again.','CONFLICT',409)});await h.settle()
  assert.equal(h.v.detail,null);assert.equal(h.v.draft.reason,'');assert.match(h.v.error,/Refresh/)
})
test('safe queue pagination rejects an older page after a newer filter',async()=>{
  const pending=deferred();let reads=0
  const h=harness({getOperationsPage:()=>++reads===1?pending.promise:Promise.resolve({items:[{id:'new-filter'}],nextCursor:null})});h.select('');await h.settle()
  h.filter('suspended');await h.settle();pending.resolve({items:[{id:'old-filter'}],nextCursor:null});await h.settle()
  assert.deepEqual(Array.from(h.v.items,x=>x.id),['new-filter'])
})
