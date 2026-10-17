import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const flush = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const receipt = { request: { id: 'opaque-request-1', status: 'requested', requestedAt: 1792200000000 }, canStartNewWork: false, existingTripAccess: true }
const available = { request: null, canStartNewWork: true, existingTripAccess: true }

// Render the production component; control the hook clock, navigation and HTTP boundaries.
function harness(path, services, initialProps = {}) {
  const slots = [], effects = [], focus = [], listeners = new Set()
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
  vm.runInNewContext(code,{module,exports:module.exports,Date,Error,Promise,Symbol,document,
    require(name) {
      if(name==='react')return react
      if(name==='react/jsx-runtime')return {jsx,jsxs:jsx,Fragment:'Fragment'}
      if(name==='react-native')return {Platform:{OS:'web'},ActivityIndicator:'ActivityIndicator'}
      if(name==='expo-router')return {Link:'Link',useLocalSearchParams:()=>props.params??{},useFocusEffect(callback){react.useEffect(()=>{const entry={callback,cleanup:focused?callback():null};focus.push(entry);return()=>{entry.cleanup?.();focus.splice(focus.indexOf(entry),1)}},[callback])}}
      if(name==='./review-frame')return {default:'ReviewFrame'}
      if(name==='./security-panel')return {default:'SecurityPanel',useReviewSecurity:()=>props.access??{unlocked:false}}
      if(name==='./account-request-detail')return {default:'AccountRequestDetailView'}
      if(name==='@/lib/account-lifecycle')return services
      if(name==='@/lib/api')return {ApiError}
      if(name==='@/components/themed-text')return {ThemedText:'ThemedText'}
      if(name==='@/components/marketplace-ui')return Object.fromEntries(['ActionButton','Card','Message','SectionTitle'].map(value=>[value,value]))
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
    hide(){document.hidden=true;for(const listener of listeners)listener()},
  }
}
class ApiError extends Error { constructor(message,code,status){super(message);this.code=code;this.status=status} }
const cardPath='../src/components/account-deletion-card.tsx'

test('Account requires inline confirmation, supports cancel and preserves existing Trips/export access',async()=>{
  let saves=0
  const screen=harness(cardPath,{getAccountDeletionRequest:async()=>available,requestAccountDeletion:async()=>{saves++;return receipt}})
  await screen.settle()
  assert.match(screen.text(),/new client bookings.*driver assignments/iu)
  assert.ok(screen.links().includes('/trips'))
  assert.ok(screen.links().includes('mailto:farid@fidexa.org'))
  screen.press('Request account deletion');await screen.settle()
  assert.equal(saves,0)
  assert.match(screen.text(),/existing trips.*payments/iu)
  screen.press('Cancel');await screen.settle()
  assert.equal(screen.button('Confirm deletion request'),undefined)
  screen.press('Request account deletion');await screen.settle()
  screen.press('Confirm deletion request');await screen.settle()
  assert.equal(saves,1)
  assert.match(screen.text(),/Deletion request received/u)
  assert.match(screen.text(),/opaque-request-1/u)
  assert.match(screen.text(),/not.*erased|has not been erased/iu)
  assert.equal(screen.button('Request account deletion'),undefined)
  assert.ok(screen.links().includes('/trips'))
})

test('repeated presses submit once while pending and show the saved receipt',async()=>{
  const pending=deferred();let saves=0
  const screen=harness(cardPath,{getAccountDeletionRequest:async()=>available,requestAccountDeletion:()=>{saves++;return pending.promise}})
  await screen.settle();screen.press('Request account deletion');await screen.settle()
  const confirm=screen.button('Confirm deletion request')
  confirm.props.onPress();confirm.props.onPress();await screen.settle()
  assert.equal(saves,1)
  assert.equal(screen.button('Confirm deletion request').props.busy,true)
  pending.resolve(receipt);await screen.settle()
  assert.match(screen.text(),/opaque-request-1/u)
})

test('save failure stays retryable; focus refresh recovers the durable receipt',async()=>{
  let saved=false,attempts=0
  const screen=harness(cardPath,{getAccountDeletionRequest:async()=>saved?receipt:available,requestAccountDeletion:async()=>{attempts++;if(attempts===1)throw Error('Connection lost. Try again.');saved=true;return receipt}})
  await screen.settle();screen.press('Request account deletion');await screen.settle();screen.press('Confirm deletion request');await screen.settle()
  assert.match(screen.text(),/Connection lost/u)
  assert.doesNotMatch(screen.text(),/Deletion request received/u)
  screen.press('Confirm deletion request');await screen.settle()
  assert.equal(attempts,2)
  screen.blur();screen.focus();await screen.settle()
  assert.match(screen.text(),/opaque-request-1/u)
})

test('a receipt refresh failure never presents an unsaved request as received',async()=>{
  let retry=false
  const screen=harness(cardPath,{getAccountDeletionRequest:async()=>{if(!retry)throw Error('Offline. Refresh to retry.');return receipt}})
  await screen.settle()
  assert.match(screen.text(),/Offline/u)
  assert.equal(screen.button('Request account deletion'),undefined)
  retry=true;screen.press('Refresh request status');await screen.settle()
  assert.match(screen.text(),/Deletion request received/u)
})

const detailPath='../src/components/staff-review/account-request-detail.tsx'
const detail={request:{...receipt.request,userId:'private-user-id',name:'Synthetic Person',email:'synthetic@example.test'}}
const access=()=>({unlocked:true,security:{expiresAt:Date.now()+600000},refresh:async()=>{}})

test('owner detail needs explicit unlocked opening and clears on lock',async()=>{
  let opens=0;const state=access()
  const screen=harness(detailPath,{getAccountRequestDetail:async()=>{opens++;return detail}},{id:'opaque-request-1',access:state})
  await screen.settle();assert.equal(opens,0)
  screen.press('Open requester details');await screen.settle()
  assert.match(screen.text(),/synthetic@example.test/u)
  screen.props({id:'opaque-request-1',access:{...state,unlocked:false}});await screen.settle()
  assert.doesNotMatch(screen.text(),/synthetic@example.test/u)
  assert.equal(screen.button('Open requester details'),undefined)
})

test('hidden or unfocused detail rejects an in-flight sensitive response',async()=>{
  for(const event of ['hide','blur']){
    const pending=deferred();const state=access()
    const screen=harness(detailPath,{getAccountRequestDetail:()=>pending.promise},{id:'opaque-request-1',access:state})
    await screen.settle();screen.press('Open requester details');await screen.settle();screen[event]()
    pending.resolve(detail);await screen.settle()
    assert.doesNotMatch(screen.text(),/synthetic@example.test/u,event)
  }
})

test('expired proof responses clear details and refresh security',async()=>{
  let refreshes=0,reject=false
  const state={...access(),refresh:async()=>{refreshes++}}
  const screen=harness(detailPath,{getAccountRequestDetail:async()=>{if(reject)throw new ApiError('Unlock reviews to continue.','REVIEW_REQUIRED',428);return detail}},{id:'opaque-request-1',access:state})
  await screen.settle();screen.press('Open requester details');await screen.settle()
  assert.match(screen.text(),/synthetic@example.test/u)
  screen.press('Hide requester details');await screen.settle()
  reject=true;screen.press('Open requester details');await screen.settle()
  assert.equal(refreshes,1)
  assert.doesNotMatch(screen.text(),/synthetic@example.test/u)
})

test('returning to Account during an in-flight save refreshes its durable receipt after completion',async()=>{
  const pending=deferred();let saved=false
  const screen=harness(cardPath,{getAccountDeletionRequest:async()=>saved?receipt:available,requestAccountDeletion:()=>pending.promise})
  await screen.settle();screen.press('Request account deletion');await screen.settle();screen.press('Confirm deletion request');await screen.settle()
  screen.blur();screen.focus();await screen.settle()
  saved=true;pending.resolve(receipt);await screen.settle()
  assert.match(screen.text(),/opaque-request-1/u)
})

test('proof expiring while requester details are in flight cannot display contact',async()=>{
  const pending=deferred(),state=access()
  const screen=harness(detailPath,{getAccountRequestDetail:()=>pending.promise},{id:'opaque-request-1',access:state})
  await screen.settle();screen.press('Open requester details');await screen.settle()
  state.security.expiresAt=Date.now()-1
  pending.resolve(detail);await screen.settle()
  assert.doesNotMatch(screen.text(),/synthetic@example.test/u)
})

test('owner queue displays opaque references and times, never requester contact',async()=>{
  let reads=0
  const screen=harness('../src/components/staff-review/account-requests-screen.tsx',{getAccountRequestPage:async()=>{reads++;return {requests:[{...detail.request}],nextCursor:null}}})
  await screen.settle()
  assert.match(screen.text(),/opaque-request-1/u)
  assert.doesNotMatch(screen.text(),/synthetic@example.test|Synthetic Person|private-user-id/u)
  screen.blur();screen.focus();await screen.settle()
  assert.equal(reads,2)
})

test('owner queue denies contact access cleanly when owner membership is missing',async()=>{
  const screen=harness('../src/components/staff-review/account-requests-screen.tsx',{getAccountRequestPage:async()=>{throw new ApiError('Owner review access is required.','FORBIDDEN',403)}})
  await screen.settle()
  assert.match(screen.text(),/Owner review access is required/u)
  assert.doesNotMatch(screen.text(),/synthetic@example.test/u)
  assert.ok(screen.button('Refresh account requests'))
})

test('owner queue pages beyond its first window, deduplicates rows and preserves earlier rows on retryable page failure',async()=>{
  const first={...receipt.request,id:'first'},second={...receipt.request,id:'second'}
  let pageAttempts=0
  const cursors=[]
  const screen=harness('../src/components/staff-review/account-requests-screen.tsx',{getAccountRequestPage:async(after)=>{
    cursors.push(after)
    if(!after)return {requests:[first],nextCursor:'first'}
    pageAttempts++
    if(pageAttempts===1)throw Error('Next page unavailable. Try again.')
    return {requests:[first,second,second],nextCursor:null}
  }})
  await screen.settle();assert.ok(screen.button('Load more account requests'))
  screen.press('Load more account requests');await screen.settle()
  assert.match(screen.text(),/Next page unavailable/u)
  assert.equal(screen.links().filter(href=>href?.params?.id==='first').length,1)
  screen.press('Load more account requests');await screen.settle()
  assert.equal(screen.links().filter(href=>href?.params?.id==='first').length,1)
  assert.equal(screen.links().filter(href=>href?.params?.id==='second').length,1)
  assert.equal(screen.button('Load more account requests'),undefined)
  assert.deepEqual(cursors,[undefined,'first','first'])
})

test('old queue pages cannot append rows after focus changes and repeated load-more presses use one request',async()=>{
  const pending=deferred();let pages=0
  const screen=harness('../src/components/staff-review/account-requests-screen.tsx',{getAccountRequestPage:async(after)=>{
    if(after){pages++;return pending.promise}
    return {requests:[{...receipt.request,id:'first'}],nextCursor:'first'}
  }})
  await screen.settle()
  const button=screen.button('Load more account requests')
  button.props.onPress();button.props.onPress();await screen.settle()
  assert.equal(pages,1)
  screen.blur();screen.focus();await screen.settle()
  pending.resolve({requests:[{...receipt.request,id:'stale-page'}],nextCursor:null});await screen.settle()
  assert.equal(screen.links().filter(href=>href?.params?.id==='stale-page').length,0)
  assert.ok(screen.button('Load more account requests'))
})

test('a queue control retained before blur cannot start another page while unfocused',async()=>{
  let pages=0
  const screen=harness('../src/components/staff-review/account-requests-screen.tsx',{getAccountRequestPage:async(after)=>{if(after)pages++;return {requests:[receipt.request],nextCursor:'cursor'}}})
  await screen.settle()
  const oldButton=screen.button('Load more account requests')
  screen.blur()
  oldButton.props.onPress();await screen.settle()
  assert.equal(pages,0)
})
