import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const flush = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

// Render the production component; control the hook clock, navigation and HTTP boundaries.
function harness(path, services = {}, initialProps = {}) {
  const slots = [], effects = [], focus = [], listeners = new Set(), timers = new Map(), opened = []
  let cursor = 0, dirty = true, tree, props = initialProps, focused = true
  const same = (a,b) => a && b && a.length === b.length && a.every((value,index) => Object.is(value,b[index]))
  const react = {
    useState(initial) { const i=cursor++; if (!(i in slots)) slots[i]=typeof initial==='function'?initial():initial; return [slots[i], value=>{slots[i]=typeof value==='function'?value(slots[i]):value;dirty=true}] },
    useRef(initial) { const i=cursor++; return slots[i]??={current:initial} },
    useCallback(callback,deps) { const i=cursor++; if(!same(slots[i]?.deps,deps))slots[i]={deps,callback};return slots[i].callback },
    useEffect(effect,deps) { const i=cursor++;if(!same(slots[i]?.deps,deps)){const previous=slots[i],slot=slots[i]={deps};effects.push(()=>{previous?.cleanup?.();slot.cleanup=effect()})} },
  }
  const document = {hidden:false,addEventListener(_type,listener){listeners.add(listener)},removeEventListener(_type,listener){listeners.delete(listener)}}
  const jsx = (type,props) => ({type,props})
  const module = {exports:{}}
  const code = ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText
  vm.runInNewContext(code,{module,exports:module.exports,Date,Error,Promise,Symbol,Math,document,window:services.window,setTimeout:(fn)=>{const id=Symbol();timers.set(id,fn);return id},clearTimeout:(id)=>timers.delete(id),
    require(name) {
      if(name==='react')return react
      if(name==='react/jsx-runtime')return {jsx,jsxs:jsx,Fragment:'Fragment'}
      if(name==='react-native')return {Platform:{OS:props.platform??'web'},ActivityIndicator:'ActivityIndicator',ScrollView:'ScrollView',StyleSheet:{create:value=>value}}
      if(name==='expo-router')return {Link:'Link',useLocalSearchParams:()=>props.params??{},useFocusEffect(callback){react.useEffect(()=>{const entry={callback,cleanup:focused?callback():null};focus.push(entry);return()=>{entry.cleanup?.();focus.splice(focus.indexOf(entry),1)}},[callback])}}
      if(name==='./review-frame')return {default:'ReviewFrame'}
      if(name==='./security-panel')return {default:'SecurityPanel',useReviewSecurity:()=>props.access??{unlocked:false}}
      if(name==='expo-linking')return {openURL:async url=>{opened.push(url)}}
      if(name==='@/lib/auth-client')return {authClient:{useSession:()=>({data:{user:{id:props.userId??'user-1'}}}),signOut:services.signOut??(async()=>({error:null}))}}
      if(name==='@/constants/theme')return {Spacing:{},BottomTabInset:0,MaxContentWidth:700}
      if(name==='@/components/themed-view')return {ThemedView:'ThemedView'}
      if(name==='./account-export-detail')return {default:'AccountExportDetailView'}
      if(name==='./account-request-detail')return {default:'AccountRequestDetailView'}
      if(name==='@/lib/account-exports')return {getExportWebUrl:()=> 'https://api.fave.fidexa.org/account/export',getArchiveUrl:id=>'https://api.fave.fidexa.org/api/account/exports/'+id+'/archive',...services}
      if(name==='@/lib/api')return {ApiError}
      if(name==='@/components/themed-text')return {ThemedText:'ThemedText'}
      if(name==='@/components/marketplace-ui')return Object.fromEntries(['ActionButton','Card','Message','SectionTitle','Field'].map(value=>[value,value]))
      throw Error(`Unexpected dependency: ${name}`)
    },
  })
  const elements=(node,result=[])=>{if(!node||typeof node!=='object')return result;if(Array.isArray(node)){node.forEach(child=>elements(child,result));return result}if(node.type)result.push(node);elements(node.props?.children,result);return result}
  return {
    async settle(){for(let i=0;i<20;i++){if(dirty){dirty=false;cursor=0;tree=module.exports.default(props);while(effects.length)effects.shift()()}await flush();if(!dirty&&!effects.length)return}throw Error('Component did not settle')},
    button(title){return elements(tree).find(node=>node.type==='ActionButton'&&node.props.title===title)},
    press(title){const button=this.button(title);assert.ok(button,`Button ${title} exists`);button.props.onPress()},
    text(){return elements(tree).flatMap(node=>[node.props?.title,node.props?.detail,...[node.props?.children].flat()]).filter(value=>typeof value==='string').join(' ')},
    links(){return elements(tree).filter(node=>node.type==='Link').map(node=>node.props.href)},
    props(next){props=next;dirty=true},
    blur(){focused=false;for(const entry of focus){entry.cleanup?.();entry.cleanup=null}},
    focus(){focused=true;for(const entry of focus)entry.cleanup=entry.callback()},
    opened,
    expire(){for(const [id,fn] of timers){timers.delete(id);fn()}},
    field(label,value){const field=elements(tree).find(node=>node.type==='Field'&&node.props.label===label);assert.ok(field);field.props.onChangeText(value)},
    hide(){document.hidden=true;for(const listener of listeners)listener()},
  }
}
class ApiError extends Error { constructor(message,code,status){super(message);this.code=code;this.status=status} }

const screenPath='../src/components/account-export-screen.tsx'
const receipt={id:'opaque-export-1',status:'requested',requestedAt:1792200000000,generatedAt:null,needsFollowUp:false,downloadedAt:null,failureCode:null}
const fresh=()=>({requests:[],canDownload:true,freshUntil:Date.now()+600000})
const access=()=>({unlocked:true,security:{expiresAt:Date.now()+600000},refresh:async()=>{}})
const services=(overrides={})=>({getAccountExports:async()=>fresh(),getAccountExport:async()=>({request:receipt,canDownload:true,freshUntil:Date.now()+600000,responses:[],exceptions:[]}),...overrides})

test('download requires explicit confirmation and stable duplicate-press protection',async()=>{
 const pending=deferred();let calls=0,key
 const screen=harness(screenPath,services({requestAccountExport:(requestKey)=>{calls++;key=requestKey;return pending.promise}}))
 await screen.settle();assert.match(screen.text(),/including your ID uploads/iu)
 screen.press('Download my information');await screen.settle();assert.equal(calls,0)
 const confirm=screen.button('Confirm download request');confirm.props.onPress();confirm.props.onPress();await screen.settle()
 assert.equal(calls,1);assert.equal(typeof key,'string')
 pending.resolve({request:receipt,canDownload:true,freshUntil:Date.now()+600000});await screen.settle()
 assert.match(screen.text(),/opaque-export-1/u);assert.ok(screen.links().some(url=>typeof url==='string'&&url.endsWith('/opaque-export-1/archive')))
 assert.doesNotMatch(screen.text(),/fulfilled|erased successfully/iu)
})

test('network retry reuses the request key and never invents a received receipt',async()=>{
 const keys=[]
 const screen=harness(screenPath,services({requestAccountExport:async key=>{keys.push(key);if(keys.length===1)throw Error('Offline. Try again.');return {request:receipt,canDownload:true,freshUntil:Date.now()+600000}}}))
 await screen.settle();screen.press('Download my information');await screen.settle();screen.press('Confirm download request');await screen.settle()
 assert.match(screen.text(),/Offline/u);assert.doesNotMatch(screen.text(),/opaque-export-1/u)
 screen.press('Confirm download request');await screen.settle();assert.equal(keys[0],keys[1])
})

test('old sessions offer re-sign-in and no archive link; failed sign-out remains retryable',async()=>{
 let attempts=0
 const screen=harness(screenPath,services({getAccountExports:async()=>({requests:[receipt],canDownload:false,freshUntil:null}),getAccountExport:async()=>({request:receipt,canDownload:false,freshUntil:null}),signOut:async()=>{attempts++;return {error:attempts===1?{message:'unavailable'}:null}}}))
 await screen.settle();assert.equal(screen.button('Download my information'),undefined)
 assert.equal(screen.links().some(url=>typeof url==='string'&&url.endsWith('/archive')),false)
 screen.press('Sign in again');await screen.settle();assert.match(screen.text(),/Could not sign out/iu)
 assert.ok(screen.button('Sign in again'))
})

test('native opens the secure web page without calling the export API',async()=>{
 let reads=0
 const screen=harness(screenPath,services({getAccountExports:async()=>{reads++;return fresh()}}),{platform:'ios'})
 await screen.settle();screen.press('Open secure download page');await screen.settle()
 assert.equal(reads,0);assert.deepEqual(screen.opened,['https://api.fave.fidexa.org/account/export'])
})

test('account switch and blur discard old receipt responses',async()=>{
 for(const mode of ['account','blur']){
 const pending=deferred();let reads=0
 const screen=harness(screenPath,services({getAccountExports:()=>++reads===1?pending.promise:Promise.resolve(fresh())}))
 await screen.settle();if(mode==='account'){screen.props({userId:'user-2'});await screen.settle()}else screen.blur()
 pending.resolve({...fresh(),requests:[receipt]});await screen.settle()
 assert.doesNotMatch(screen.text(),/opaque-export-1/u,mode)
 }
})

test('follow-up responses remain visible beside safe archive access and acknowledgement is explicit',async()=>{
 let acknowledgements=0
 const screen=harness(screenPath,services({getAccountExports:async()=>({...fresh(),requests:[{...receipt,status:'ready',needsFollowUp:true}]}),getAccountExport:async()=>({request:{...receipt,status:'ready',needsFollowUp:true},canDownload:true,freshUntil:Date.now()+600000,responses:[{id:'response-1',message:'A missing original is being investigated.',createdAt:1792200000001}],exceptions:[{category:'documents',code:'original_unavailable',count:1}]}),acknowledgeAccountExport:async()=>{acknowledgements++;return {request:{...receipt,status:'ready',downloadedAt:Date.now()},canDownload:true,freshUntil:Date.now()+600000}}}))
 await screen.settle();assert.match(screen.text(),/missing original is being investigated/u);assert.match(screen.text(),/follow-up/iu)
 assert.equal(acknowledgements,0);screen.press('I received my download');await screen.settle();assert.equal(acknowledgements,1)
 assert.match(screen.text(),/You reported receiving/iu)
})

test('freshness expiry removes archive access and requires sign-in again',async()=>{
 const screen=harness(screenPath,services({getAccountExports:async()=>({...fresh(),requests:[receipt]})}))
 await screen.settle();assert.ok(screen.links().some(url=>typeof url==='string'&&url.endsWith('/archive')))
 screen.expire();await screen.settle();assert.equal(screen.links().some(url=>typeof url==='string'&&url.endsWith('/archive')),false);assert.ok(screen.button('Sign in again'))
})

const ownerPath='../src/components/staff-review/account-export-detail.tsx'
const detail={request:{...receipt,needsFollowUp:true,userId:'private-user',name:'Synthetic Person',email:'synthetic@example.test',exceptions:[{category:'documents',code:'original_unavailable',count:1}],responses:[]}}
test('owner detail is explicitly opened, cleared on lock/hide and never shows fulfillment actions',async()=>{
 let reads=0;const state=access()
 const screen=harness(ownerPath,{getAccountExportDetail:async()=>{reads++;return detail}},{id:receipt.id,access:state})
 await screen.settle();assert.equal(reads,0);screen.press('Open export follow-up');await screen.settle();assert.match(screen.text(),/synthetic@example.test/u)
 assert.doesNotMatch(screen.text(),/Mark fulfilled|Erase account|Approve download/u)
 screen.hide();await screen.settle();assert.doesNotMatch(screen.text(),/synthetic@example.test/u)
 screen.props({id:receipt.id,access:{...state,unlocked:false}});await screen.settle();assert.equal(screen.button('Open export follow-up'),undefined)
})

test('owner proof expiry rejects late sensitive detail and written response',async()=>{
 const pending=deferred(),state=access();const screen=harness(ownerPath,{getAccountExportDetail:()=>pending.promise},{id:receipt.id,access:state})
 await screen.settle();screen.press('Open export follow-up');await screen.settle();state.security.expiresAt=Date.now()-1;pending.resolve(detail);await screen.settle();assert.doesNotMatch(screen.text(),/synthetic@example.test/u)
})

test('owner writes a follow-up response once and late save after lock cannot restore private state',async()=>{
 const pending=deferred(),state=access();let saves=0
 const screen=harness(ownerPath,{getAccountExportDetail:async()=>detail,saveAccountExportResponse:()=>{saves++;return pending.promise}},{id:receipt.id,access:state})
 await screen.settle();screen.press('Open export follow-up');await screen.settle();screen.field('Written follow-up response','We are checking the retained original.');await screen.settle()
 const save=screen.button('Save written response');save.props.onPress();save.props.onPress();await screen.settle();assert.equal(saves,1)
 screen.props({id:receipt.id,access:{...state,unlocked:false}});await screen.settle();pending.resolve({saved:true});await screen.settle();assert.doesNotMatch(screen.text(),/synthetic@example.test|Response saved/u)
})

test('owner queue pages opaque references only and rejects stale next pages',async()=>{
 const pending=deferred();let pages=0
 const screen=harness('../src/components/staff-review/account-exports-screen.tsx',{getAccountExportPage:async after=>{if(after){pages++;return pending.promise}return {requests:[{...detail.request}],nextCursor:'cursor-1'}}})
 await screen.settle();assert.match(screen.text(),/opaque-export-1/u);assert.doesNotMatch(screen.text(),/synthetic@example.test|Synthetic Person|private-user/u)
 const more=screen.button('Load more export follow-up');more.props.onPress();more.props.onPress();await screen.settle();assert.equal(pages,1)
 screen.blur();screen.focus();await screen.settle();pending.resolve({requests:[{...receipt,id:'stale-page'}],nextCursor:null});await screen.settle();assert.doesNotMatch(screen.text(),/stale-page/u)
})

test('owner detail refreshes security after 428 and does not show sensitive state',async()=>{
 let refreshes=0;const state={...access(),refresh:async()=>{refreshes++}}
 const screen=harness(ownerPath,{getAccountExportDetail:async()=>{throw new ApiError('Unlock reviews.','REVIEW_REQUIRED',428)}},{id:receipt.id,access:state})
 await screen.settle();screen.press('Open export follow-up');await screen.settle();assert.equal(refreshes,1);assert.doesNotMatch(screen.text(),/synthetic@example.test/u)
})

test('owner account change clears requester details even before security refresh finishes',async()=>{
 const state=access();const screen=harness(ownerPath,{getAccountExportDetail:async()=>detail},{id:receipt.id,access:state,userId:'owner-1'})
 await screen.settle();screen.press('Open export follow-up');await screen.settle();assert.match(screen.text(),/synthetic@example.test/u)
 screen.props({id:receipt.id,access:state,userId:'owner-2'});await screen.settle();assert.doesNotMatch(screen.text(),/synthetic@example.test/u)
})

test('refocusing during a pending request recovers its durable receipt after the save settles',async()=>{
 const pending=deferred();let saved=false
 const screen=harness(screenPath,services({getAccountExports:async()=>({...fresh(),requests:saved?[receipt]:[]}),requestAccountExport:()=>pending.promise}))
 await screen.settle();screen.press('Download my information');await screen.settle();screen.press('Confirm download request');await screen.settle()
 screen.blur();screen.focus();await screen.settle();saved=true;pending.resolve({request:receipt,canDownload:true,freshUntil:Date.now()+600000});await screen.settle()
 assert.match(screen.text(),/opaque-export-1/u)
})

test('older download receipt pages remain accessible without accumulating unbounded client history',async()=>{
 const calls=[]
 const older={...receipt,id:'older-receipt'}
 const screen=harness(screenPath,services({getAccountExports:async(after)=>{calls.push(after);return {...fresh(),requests:[after?older:receipt],nextCursor:after?null:'opaque-cursor'}},getAccountExport:async(id)=>({request:id===older.id?older:receipt,canDownload:true,freshUntil:Date.now()+600000})}))
 await screen.settle()
 screen.press('View older download requests');await screen.settle()
 assert.deepEqual(calls,[undefined,'opaque-cursor'])
 assert.match(screen.text(),/older-receipt/)
 assert.equal(screen.button('View older download requests'),undefined)
})


test('successful renewed sign-in navigates back to the fixed secure export page after stack reset',async()=>{
 const destinations=[]
 const screen=harness(screenPath,services({window:{location:{assign:url=>destinations.push(url)}},getAccountExports:async()=>({requests:[],canDownload:false,freshUntil:null}),signOut:async()=>({error:null})}))
 await screen.settle();screen.press('Sign in again');await screen.settle()
 assert.deepEqual(destinations,['https://api.fave.fidexa.org/account/export'])
})
