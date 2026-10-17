import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const flush = () => new Promise(resolve => setImmediate(resolve))
const application = status => ({ id: 'application', legalName: 'Synthetic driver', phoneNumber: '+256700000001', lodgingRateUgx: 42000, status, nextAction: `Next: ${status}`, documents: [], applicantMessage: status === 'needs_correction' ? 'Replace the test portrait.' : null })
const prerequisites = () => ({ documents: [{ id: 'terms-v1', type: 'driver_terms', version: 'v1', body: 'Synthetic non-binding terms' }, { id: 'privacy-v1', type: 'driver_privacy', version: 'v1', body: 'Synthetic non-binding notice' }], readyToApply: true, retentionPolicy: { active: true }, verificationChecklist: [] })

// Render the production Driver screen. Only lifecycle and service boundaries are
// controlled; read ordering, draft fields, status and consent transitions are real.
function driverHarness({ load = async () => ({ application: application('pending_verification') }), requirements = async () => prerequisites(), offers = async () => ({ offers: [] }) } = {}) {
  const slots = [], effects = [], listeners = new Set(), timers = new Map()
  let cursor = 0, dirty = true, tree, focusCallback, focusCleanup, focused = true, reads = 0, writes = 0
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; dirty = true; writes++ }] },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial } },
    useCallback(callback, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, callback }; return slots[i].callback },
    useEffect(effect, deps) {
      const i = cursor++
      if (!same(slots[i]?.deps, deps)) { const previous = slots[i], slot = slots[i] = { deps }; effects.push(() => { previous?.cleanup?.(); slot.cleanup = effect() }) }
    },
  }
  const jsx = (type, props) => ({ type, props })
  const module = { exports: {} }
  const source = readFileSync(new URL('../src/app/(tabs)/driver/index.tsx', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  vm.runInNewContext(code, {
    module, exports: module.exports, Promise, Date, Error, console,
    setInterval(callback) { const id = Symbol(); timers.set(id, callback); return id }, clearInterval(id) { timers.delete(id) },
    require(name) {
      if (name === 'react') return react
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' }
      if (name === 'react-native') return { View: 'View', ScrollView: 'ScrollView', Image: 'Image', StyleSheet: { create: value => value }, AppState: { addEventListener(_event, listener) { listeners.add(listener); return { remove: () => listeners.delete(listener) } } } }
      if (name === 'expo-router') return { useLocalSearchParams: () => ({}), useFocusEffect(callback) {
        react.useEffect(() => { focusCallback = callback; if (focused) focusCleanup = callback(); return () => { focusCleanup?.(); focusCleanup = undefined } }, [callback])
      } }
      if (name === '@/lib/marketplace') return {
        getDriverPrerequisites: requirements,
        getDriverApplication() { reads++; return load() },
        async getMyVehicles() { return { vehicles: [] } },
        getDriverTripOffers: offers,
      }
      if (name === '@/components/marketplace-ui') return { ...Object.fromEntries(['ActionButton', 'Card', 'CheckRow', 'Field', 'Message', 'SectionTitle'].map(key => [key, key])), formStyles: {} }
      if (name.startsWith('@/components/')) return new Proxy({}, { get: (_object, key) => key === '__esModule' ? true : key })
      if (name === '@/constants/theme') return { Spacing: {}, BottomTabInset: 0, MaxContentWidth: 700 }
      if (name.startsWith('expo-')) return {}
      throw Error(`Unexpected dependency: ${name}`)
    },
  })
  function elements(node, result = []) {
    if (Array.isArray(node)) { node.forEach(child => elements(child, result)); return result }
    if (!node || typeof node !== 'object') return result
    if (node.type) result.push(node)
    elements(node.props?.children, result); return result
  }
  function text(node) {
    if (Array.isArray(node)) return node.map(text).join('')
    if (node && typeof node === 'object') return text(node.props?.children)
    return typeof node === 'string' || typeof node === 'number' ? String(node) : ''
  }
  async function settle() {
    for (let i = 0; i < 25; i++) {
      if (dirty) { cursor = 0; dirty = false; tree = module.exports.default(); while (effects.length) effects.shift()() }
      await flush(); if (!dirty && !effects.length) return
    }
    throw Error('Driver screen did not settle')
  }
  return {
    settle, text: () => text(tree), reads: () => reads, writes: () => writes,
    button: title => elements(tree).find(node => node.type === 'ActionButton' && node.props.title === title),
    field: label => elements(tree).find(node => node.type === 'Field' && node.props.label === label),
    checkbox: () => elements(tree).find(node => node.type === 'CheckRow' && node.props.title.startsWith('I agree')),
    errors: () => elements(tree).filter(node => node.type === 'Message' && node.props.error),
    blur() { focused = false; focusCleanup?.(); focusCleanup = undefined },
    focus() { focused = true; focusCleanup = focusCallback?.() },
    foreground() { for (const listener of listeners) listener('active') },
    tick() { for (const callback of timers.values()) callback() },
    listeners: () => listeners.size,
  }
}

test('returning to Driver loads staff approval and its next action', async () => {
  let status = 'pending_verification'
  const screen = driverHarness({ load: async () => ({ application: application(status) }) })
  await screen.settle(); assert.match(screen.text(), /pending verification/u)
  screen.blur(); status = 'approved'; screen.focus(); await screen.settle()
  assert.match(screen.text(), /Next: approved/u)
  assert.doesNotMatch(screen.text(), /pending verification/u)
  assert.equal(screen.reads(), 2)
})

test('foreground refresh shows correction instructions and removes its listener on blur', async () => {
  let status = 'pending_verification'
  const screen = driverHarness({ load: async () => ({ application: application(status) }) })
  await screen.settle()
  status = 'needs_correction'; screen.foreground(); await screen.settle()
  assert.match(screen.text(), /Replace the test portrait/u)
  assert.equal(screen.listeners(), 1)
  screen.blur(); assert.equal(screen.listeners(), 0)
  screen.foreground(); await screen.settle(); assert.equal(screen.reads(), 2)
})

test('failed refresh hides stale approval and allows explicit retry', async () => {
  let failing = false
  const screen = driverHarness({ load: async () => { if (failing) throw Error('private server details'); return { application: application('approved') } } })
  await screen.settle(); assert.match(screen.text(), /Next: approved/u)
  failing = true; screen.foreground(); await screen.settle()
  assert.doesNotMatch(screen.text(), /Next: approved|private server details/u)
  assert.equal(screen.errors().length, 1)
  const retry = screen.button('Refresh driver status'); assert.ok(retry)
  failing = false; retry.props.onPress(); await screen.settle()
  assert.match(screen.text(), /Next: approved/u)
  assert.equal(screen.errors().length, 0)
})

test('focus refresh preserves unsaved form edits and resets consent for changed documents', async () => {
  let documents = prerequisites()
  const screen = driverHarness({ load: async () => ({ application: application('needs_correction') }), requirements: async () => documents })
  await screen.settle()
  screen.field('Legal name').props.onChangeText('Unsaved correction')
  screen.checkbox().props.onPress(); await screen.settle()
  screen.blur(); screen.focus(); await screen.settle()
  assert.equal(screen.field('Legal name').props.value, 'Unsaved correction')
  assert.equal(screen.checkbox().props.checked, true)
  documents = { ...prerequisites(), documents: [{ id: 'terms-v2', type: 'driver_terms', version: 'v1', body: 'Synthetic non-binding terms' }, { id: 'privacy-v1', type: 'driver_privacy', version: 'v1', body: 'Synthetic non-binding notice' }] }
  screen.foreground(); await screen.settle()
  assert.equal(screen.checkbox().props.checked, false)
})

test('old reads cannot overwrite a newer focus result or write after blur', async () => {
  let resolveOld, resolveHidden, calls = 0
  const screen = driverHarness({ load: () => {
    calls++
    if (calls === 1) return new Promise(resolve => { resolveOld = resolve })
    if (calls === 3) return new Promise(resolve => { resolveHidden = resolve })
    return Promise.resolve({ application: application('approved') })
  } })
  await screen.settle(); screen.blur(); screen.focus(); await screen.settle()
  assert.match(screen.text(), /Next: approved/u)
  resolveOld({ application: application('pending_verification') }); await screen.settle()
  assert.match(screen.text(), /Next: approved/u)
  screen.foreground(); await screen.settle(); screen.blur()
  const writes = screen.writes()
  resolveHidden({ application: application('needs_correction') }); await screen.settle()
  assert.equal(screen.writes(), writes)
})

test('legacy offer polls neither load nor write while Driver is blurred', async () => {
  let calls = 0, resolvePoll
  const screen = driverHarness({ load: async () => ({ application: application('approved') }), offers: () => {
    calls++
    return calls === 2 ? new Promise(resolve => { resolvePoll = resolve }) : Promise.resolve({ offers: [] })
  } })
  await screen.settle(); screen.tick(); await screen.settle()
  screen.blur(); const writes = screen.writes()
  resolvePoll({ offers: [] }); await screen.settle()
  assert.equal(screen.writes(), writes)
  screen.tick(); await screen.settle()
  assert.equal(calls, 2)
})
