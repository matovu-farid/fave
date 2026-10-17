import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const flush = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const request = (id = 'request-1') => ({ requestId: id, estimateId: 'estimate-1', status: 'requested', createdAt: 1,
  startDate: '2099-01-01', endDate: '2099-01-02', vehicle: { id: 'car-1', make: 'Synthetic', model: id, year: 2026 },
  route: { pickupArea: 'Kampala', destinationArea: 'Jinja' }, estimate: { currency: 'UGX', totalAmount: 100000 },
  callCount: 1, driverReached: true, calls: [], needsReview: false, quoteId: null, holdExpiresAt: null })
const queue = (items = [request()]) => ({ pendingRequests: items, confirmedRequests: [], recentRequests: [] })
const contact = { driver: { name: 'Private synthetic driver', phone: '+256700000001' } }
class ApiError extends Error { constructor(message, code, status) { super(message); this.code = code; this.status = status } }

// Execute the actual screen and any local controller. Replace only rendering,
// lifecycle scheduling and network/device boundaries, never the production logic.
function harness(overrides = {}) {
  const slots = [], effects = [], focusEffects = new Set(), appListeners = new Set(), visibilityListeners = new Set(), timers = new Map()
  let cursor = 0, dirty = true, tree, focused = true, userId = 'owner', timerId = 0
  const document = { hidden: false, addEventListener(_event, callback) { visibilityListeners.add(callback) }, removeEventListener(_event, callback) { visibilityListeners.delete(callback) } }
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; dirty = true }] },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial } },
    useCallback(callback, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, callback }; return slots[i].callback },
    useEffect(effect, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) { const previous = slots[i], slot = slots[i] = { deps }; effects.push(() => { previous?.cleanup?.(); slot.cleanup = effect() }) } },
  }
  const services = { getAdminAccess: async () => ({ operations: true, reviews: true }),
    getAdminTripOffers: async () => ({ pendingOffers: [], processingOffers: [], recentOffers: [] }),
    getAdminAvailabilityRequests: async () => queue(), getAvailabilityDriverContact: async () => contact,
    getDriverTripOfferContact: async () => contact, recordAvailabilityCall: async () => ({}),
    recordDriverTripOfferFollowUp: async () => ({}), confirmAvailabilityRequest: async () => ({}), markAvailabilityUnavailable: async () => ({}), ...overrides }
  const jsx = (type, props) => ({ type, props })
  const modules = new Map()
  const load = path => {
    if (modules.has(path)) return modules.get(path)
    const module = { exports: {} }; modules.set(path, module.exports)
    const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
    vm.runInNewContext(code, { module, exports: module.exports, Promise, Date, Error, Symbol, console, document,
      setTimeout(callback) { const id = ++timerId; timers.set(id, { callback, once: true }); return id }, clearTimeout: id => timers.delete(id),
      setInterval(callback) { const id = ++timerId; timers.set(id, { callback, once: false }); return id }, clearInterval: id => timers.delete(id),
      require(name) {
        if (name === 'react') return react
        if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' }
        if (name === 'react-native') return { ...Object.fromEntries(['ActivityIndicator', 'Pressable', 'ScrollView', 'View'].map(key => [key, key])), StyleSheet: { create: value => value }, Platform: { OS: 'web' }, AppState: { currentState: 'active', addEventListener(_event, callback) { appListeners.add(callback); return { remove: () => appListeners.delete(callback) } } } }
        if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' }
        if (name === 'expo-linking') return { openURL: overrides.openURL ?? (async () => {}) }
        if (name === 'expo-router') return { Link: 'Link', useFocusEffect(callback) { react.useEffect(() => { const entry = { callback, cleanup: focused ? callback() : null }; focusEffects.add(entry); return () => { entry.cleanup?.(); focusEffects.delete(entry) } }, [callback]) } }
        if (name === '@/lib/marketplace') return services
        if (name === '@/lib/auth-client') return { authClient: { useSession: () => ({ data: userId ? { user: { id: userId }, session: { id: `${userId}-session` } } : null }) } }
        if (name === '@/lib/api') return { ApiError }
        if (name.startsWith('@/hooks/')) return load(`../src/hooks/${name.slice('@/hooks/'.length)}.ts`)
        if (name === '@/components/marketplace-ui') return Object.fromEntries(['ActionButton', 'Card', 'Field', 'Message', 'SectionTitle'].map(key => [key, key]))
        if (name.startsWith('@/components/')) return new Proxy({}, { get: (_object, key) => key === '__esModule' ? true : key })
        if (name === '@/constants/theme') return { Spacing: {}, BottomTabInset: 0, MaxContentWidth: 700 }
        throw Error(`Unexpected dependency ${name}`)
      },
    })
    return module.exports
  }
  const screen = load('../src/app/(tabs)/admin/index.tsx').default
  function elements(node, result = []) { if (Array.isArray(node)) node.forEach(child => elements(child, result)); else if (node && typeof node === 'object') { if (node.type) result.push(node); elements(node.props?.children, result) } return result }
  function text(node) { if (Array.isArray(node)) return node.map(text).join(' '); if (node && typeof node === 'object') return text(node.props?.children); return typeof node === 'string' || typeof node === 'number' ? String(node) : '' }
  async function settle() {
    for (let i = 0; i < 30; i++) {
      if (dirty) { cursor = 0; dirty = false; tree = screen(); while (effects.length) effects.shift()() }
      for (const [id, timer] of timers) if (timer.once) { timers.delete(id); timer.callback() }
      await flush(); if (!dirty && !effects.length) return
    }
    throw Error('Operations screen did not settle')
  }
  return { settle, text: () => text(tree),
    button: title => elements(tree).find(node => ['ActionButton', 'Pressable'].includes(node.type) && (node.props.title === title || text(node).trim() === title)),
    field: label => elements(tree).find(node => node.type === 'Field' && node.props.label === label),
    blur() { focused = false; for (const entry of focusEffects) { entry.cleanup?.(); entry.cleanup = null } },
    focus() { focused = true; for (const entry of focusEffects) entry.cleanup = entry.callback() },
    hide() { document.hidden = true; for (const callback of visibilityListeners) callback() },
    show() { document.hidden = false; for (const callback of visibilityListeners) callback() },
    appState(state) { for (const callback of appListeners) callback(state) },
    user(id) { userId = id; dirty = true },
    tick() { for (const timer of [...timers.values()]) if (!timer.once) timer.callback() },
  }
}

test('leaving Operations clears revealed driver contact and requires another audited reveal on return', async () => {
  const screen = harness(); await screen.settle()
  screen.button('Show driver contact').props.onPress(); await screen.settle()
  assert.match(screen.text(), /\+256700000001/u)
  screen.blur(); screen.focus(); await screen.settle()
  assert.doesNotMatch(screen.text(), /\+256700000001/u)
  assert.ok(screen.button('Show driver contact'))
})

test('a delayed contact response cannot return after leaving and reopening Operations', async () => {
  const pending = deferred(), screen = harness({ getAvailabilityDriverContact: () => pending.promise }); await screen.settle()
  screen.button('Show driver contact').props.onPress(); await screen.settle()
  screen.blur(); screen.focus(); await screen.settle()
  pending.resolve(contact); await screen.settle()
  assert.doesNotMatch(screen.text(), /\+256700000001|contact access was recorded/u)
})

test('hidden browser and background app clear contact and reject late contact reads', async () => {
  for (const event of ['hide', 'background']) {
    const pending = deferred(), screen = harness({ getAvailabilityDriverContact: () => pending.promise }); await screen.settle()
    screen.button('Show driver contact').props.onPress(); await screen.settle()
    if (event === 'hide') { screen.hide(); screen.show() } else { screen.appState('background'); screen.appState('active') }
    await screen.settle(); pending.resolve(contact); await screen.settle()
    assert.doesNotMatch(screen.text(), /\+256700000001/u, event)
  }
})

test('duplicate confirmation presses create one request while the first is pending', async () => {
  let writes = 0; const pending = deferred(), screen = harness({ confirmAvailabilityRequest: () => { writes++; return pending.promise } }); await screen.settle()
  screen.button('Confirm dates').props.onPress(); await screen.settle()
  const confirm = screen.button('Send quote and hold these dates'); assert.ok(confirm)
  confirm.props.onPress(); confirm.props.onPress(); await screen.settle()
  assert.equal(writes, 1)
  pending.resolve({}); await screen.settle()
})

test('account changes clear driver contact before the next access check returns', async () => {
  let access = async () => ({ operations: true }); const pending = deferred()
  const screen = harness({ getAdminAccess: () => access() }); await screen.settle()
  screen.button('Show driver contact').props.onPress(); await screen.settle()
  assert.match(screen.text(), /\+256700000001/u)
  access = () => pending.promise; screen.user('other-staff'); await screen.settle()
  assert.doesNotMatch(screen.text(), /\+256700000001/u)
  pending.resolve({ operations: false }); await screen.settle()
})

test('an older queue response cannot replace a newer refresh', async () => {
  let reads = 0; const old = deferred(), screen = harness({ getAdminAvailabilityRequests: () => ++reads === 1 ? old.promise : Promise.resolve(queue([request('newest-request')])) })
  await screen.settle(); screen.button('Refresh').props.onPress(); await screen.settle()
  assert.match(screen.text(), /newest-request/u)
  old.resolve(queue([request('stale-request')])); await screen.settle()
  assert.match(screen.text(), /newest-request/u)
  assert.doesNotMatch(screen.text(), /stale-request/u)
})

test('lost operations access clears contact and a later grant requires a new reveal', async () => {
  let permitted = true; const screen = harness({ getAdminAccess: async () => ({ operations: permitted }) }); await screen.settle()
  screen.button('Show driver contact').props.onPress(); await screen.settle()
  permitted = false; screen.button('Refresh').props.onPress(); await screen.settle()
  assert.doesNotMatch(screen.text(), /\+256700000001/u)
  permitted = true; screen.button('Refresh').props.onPress(); await screen.settle()
  assert.doesNotMatch(screen.text(), /\+256700000001/u)
  assert.ok(screen.button('Show driver contact'))
})

test('queue failures hide stale contact and explicit refresh can recover', async () => {
  let failing = false; const screen = harness({ getAdminAvailabilityRequests: async () => { if (failing) throw Error('Queue unavailable'); return queue() } }); await screen.settle()
  screen.button('Show driver contact').props.onPress(); await screen.settle()
  failing = true; screen.button('Refresh').props.onPress(); await screen.settle()
  assert.doesNotMatch(screen.text(), /\+256700000001/u); assert.match(screen.text(), /Queue unavailable/u)
  failing = false; screen.button('Refresh').props.onPress(); await screen.settle()
  assert.ok(screen.button('Show driver contact')); assert.doesNotMatch(screen.text(), /Queue unavailable/u)
})

test('a denied contact action clears the queue rather than retaining privileged data', async () => {
  const screen = harness({ getAvailabilityDriverContact: async () => { throw new ApiError('Operations access removed', 'FORBIDDEN', 403) } }); await screen.settle()
  screen.button('Show driver contact').props.onPress(); await screen.settle()
  assert.doesNotMatch(screen.text(), /\+256700000001|Synthetic/u)
  assert.match(screen.text(), /Operations access removed/u)
})

test('call log saves once and confirmation refreshes the real resulting quote state', async () => {
  let saved = 0, decided = false; const screen = harness({
    recordAvailabilityCall: async () => { saved++ },
    confirmAvailabilityRequest: async () => { decided = true },
    getAdminAvailabilityRequests: async () => decided ? { ...queue([]), confirmedRequests: [{ ...request(), status: 'confirmed', holdExpiresAt: Date.now() + 86400000 }] } : queue(),
  }); await screen.settle()
  screen.button('Show driver contact').props.onPress(); await screen.settle()
  screen.button('Record call attempt').props.onPress(); await screen.settle()
  screen.field('Optional note').props.onChangeText('Synthetic follow-up'); await screen.settle()
  const save = screen.button('Save call attempt'); save.props.onPress(); save.props.onPress(); await screen.settle()
  assert.equal(saved, 1)
  screen.button('Confirm dates').props.onPress(); await screen.settle()
  screen.button('Send quote and hold these dates').props.onPress(); await screen.settle()
  assert.match(screen.text(), /Dates confirmed|held until/u)
  assert.doesNotMatch(screen.text(), /\+256700000001/u)
  assert.equal(screen.button('Confirm dates'), undefined)
})

test('a committed decision completing after blur is recovered by queue refresh without restoring old contact', async () => {
  let decided = false; const pending = deferred(), screen = harness({
    confirmAvailabilityRequest: () => pending.promise.then(() => { decided = true }),
    getAdminAvailabilityRequests: async () => decided ? { ...queue([]), confirmedRequests: [{ ...request(), status: 'confirmed', holdExpiresAt: Date.now() + 86400000 }] } : queue(),
  }); await screen.settle()
  screen.button('Confirm dates').props.onPress(); await screen.settle()
  screen.button('Send quote and hold these dates').props.onPress(); await screen.settle()
  screen.blur(); pending.resolve(); await screen.settle(); screen.focus(); await screen.settle()
  assert.match(screen.text(), /held until/u); assert.doesNotMatch(screen.text(), /Dates confirmed|\+256700000001/u)
})

test('legacy offers can record a call after returning from the native dialer', async () => {
  const offer = { offerId: 'legacy-offer', status: 'pending', expiresAt: Date.now() + 900000, createdAt: 1, startDate: '2099-01-01', endDate: '2099-01-02', vehicle: { make: 'Synthetic', model: 'Legacy' }, route: { pickupArea: 'Kampala', destinationArea: 'Jinja' }, followUpCount: 0 }
  const screen = harness({ getAdminAvailabilityRequests: async () => queue([]), getAdminTripOffers: async () => ({ pendingOffers: [offer], processingOffers: [], recentOffers: [] }) }); await screen.settle()
  screen.button('Show driver contact').props.onPress(); await screen.settle()
  screen.button('Call driver').props.onPress(); screen.appState('background'); await screen.settle()
  screen.appState('active'); await screen.settle()
  screen.button('Show driver contact').props.onPress(); await screen.settle()
  const record = screen.button('Record call attempt'); assert.ok(record, 'legacy follow-up remains reachable without reopening the dialer')
  record.props.onPress(); await screen.settle(); assert.ok(screen.button('Save call attempt'))
})

test('starting a local call cannot discard a same-account operations-access denial', async () => {
  const pending = deferred(); let access = async () => ({ operations: true })
  const screen = harness({ getAdminAccess: () => access() }); await screen.settle()
  screen.button('Show driver contact').props.onPress(); await screen.settle()
  access = () => pending.promise; screen.button('Refresh').props.onPress(); await screen.settle()
  screen.button('Call driver').props.onPress(); await screen.settle()
  pending.resolve({ operations: false }); await screen.settle()
  assert.doesNotMatch(screen.text(), /\+256700000001|Synthetic/u)
})

test('a decision settling after foreground refresh immediately reconciles its saved state', async () => {
  const pending = deferred(); let decided = false, reads = 0
  const screen = harness({ confirmAvailabilityRequest: () => pending.promise.then(() => { decided = true }),
    getAdminAvailabilityRequests: async () => { reads++; return decided ? { ...queue([]), confirmedRequests: [{ ...request(), status: 'confirmed', holdExpiresAt: Date.now() + 86400000 }] } : queue() },
  }); await screen.settle()
  screen.button('Confirm dates').props.onPress(); await screen.settle()
  screen.button('Send quote and hold these dates').props.onPress(); await screen.settle()
  screen.appState('background'); screen.appState('active'); await screen.settle()
  const priorReads = reads; pending.resolve(); await screen.settle()
  assert.ok(reads > priorReads, 'the settled write triggers a fresh authoritative read')
  assert.match(screen.text(), /held until/u); assert.equal(screen.button('Confirm dates'), undefined)
  assert.doesNotMatch(screen.text(), /Dates confirmed|\+256700000001/u)
})
