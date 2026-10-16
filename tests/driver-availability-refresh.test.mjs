import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const empty = () => ({ unavailable: [], holdsAndBookings: [] })
const held = () => ({ unavailable: [], holdsAndBookings: [{ start_date: '2099-01-05', end_date: '2099-01-07', status: 'quote_hold', hold_expires_at: 4071258000000 }] })
const flush = () => new Promise(resolve => setImmediate(resolve))

// Run the real private AvailabilityCard with controlled hooks, focus and AppState.
function availabilityHarness(load) {
  const slots = []
  const effects = []
  const listeners = new Set()
  let cursor = 0
  let focused = true
  let focusCallback
  let focusCleanup
  let writes = 0
  let requests = 0
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
  const jsx = (type, props) => ({ type, props })
  const react = {
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = initial
      return [slots[index], value => { writes++; slots[index] = typeof value === 'function' ? value(slots[index]) : value }]
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial } },
    useCallback(callback, deps) {
      const index = cursor++
      if (!same(slots[index]?.deps, deps)) slots[index] = { deps, callback }
      return slots[index].callback
    },
    useEffect(effect, deps) {
      const index = cursor++
      if (!same(slots[index]?.deps, deps)) {
        const previous = slots[index]
        const slot = slots[index] = { deps }
        effects.push(() => { previous?.cleanup?.(); slot.cleanup = effect() })
      }
    },
  }
  const module = { exports: {} }
  const source = readFileSync(new URL('../src/app/(tabs)/driver/index.tsx', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText
  vm.runInNewContext(code + '\nmodule.exports.AvailabilityCard = AvailabilityCard', {
    module, exports: module.exports, console, Promise,
    require(name) {
      if (name === 'react') return react
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' }
      if (name === 'react-native') return { Image: 'Image', View: 'View', ScrollView: 'ScrollView', StyleSheet: { create: value => value }, AppState: { addEventListener(_event, callback) { listeners.add(callback); return { remove: () => listeners.delete(callback) } } } }
      if (name === 'expo-router') return { useFocusEffect(callback) {
        react.useEffect(() => {
          focusCallback = callback
          if (focused) focusCleanup = callback()
          return () => { focusCleanup?.(); focusCleanup = undefined; focusCallback = undefined }
        }, [callback])
      } }
      if (name === 'expo-image-picker' || name === 'expo-document-picker') return {}
      if (name === '@/components/marketplace-ui') return Object.fromEntries(['ActionButton', 'Card', 'CheckRow', 'Field', 'Message', 'SectionTitle'].map(name => [name, name]))
      if (name === '@/components/themed-text') return { ThemedText: 'ThemedText' }
      if (name === '@/components/themed-view') return { ThemedView: 'ThemedView' }
      if (name === '@/constants/theme') return { Spacing: {}, BottomTabInset: 0, MaxContentWidth: 700 }
      if (name === '@/lib/marketplace') return { getVehicleAvailability: async id => { requests++; assert.equal(id, 'car-1'); return load() } }
      throw Error(`Unexpected module: ${name}`)
    },
  })
  const props = { vehicle: { id: 'car-1', make: 'Toyota', model: 'car-1' }, start: '2099-01-05', end: '2099-01-07', setStart() {}, setEnd() {} }
  function render() { cursor = 0; const tree = module.exports.AvailabilityCard(props); while (effects.length) effects.shift()(); return tree }
  function elements(node, result = []) {
    if (Array.isArray(node)) { node.forEach(child => elements(child, result)); return result }
    if (!node || typeof node !== 'object') return result
    if (node.type) result.push(node)
    elements(node.props?.children, result)
    return result
  }
  function text(node) {
    if (Array.isArray(node)) return node.map(text).join('')
    if (node && typeof node === 'object') return text(node.props?.children)
    return typeof node === 'string' || typeof node === 'number' ? String(node) : ''
  }
  return {
    render, text: () => text(render()), button: title => elements(render()).find(node => node.type === 'ActionButton' && node.props.title === title),
    errors: () => elements(render()).filter(node => node.type === 'Message' && node.props.error),
    blur() { focused = false; focusCleanup?.(); focusCleanup = undefined },
    focus() { focused = true; focusCleanup = focusCallback?.() },
    foreground() { for (const callback of listeners) callback('active') },
    listeners: () => listeners.size, writes: () => writes, requests: () => requests,
  }
}

test('returning to Driver refreshes holds instead of retaining the initial empty availability', async () => {
  let data = empty()
  const card = availabilityHarness(async () => data)
  card.render(); await flush()
  assert.doesNotMatch(card.text(), /Held while client reviews quote/u)
  card.blur(); data = held(); card.focus(); await flush()
  assert.match(card.text(), /Held while client reviews quote/u)
  assert.equal(card.requests(), 2)
})

test('a failed availability load disables changes until explicit refresh succeeds', async () => {
  let failing = true
  const card = availabilityHarness(async () => { if (failing) throw Error('private upstream details'); return held() })
  card.render(); await flush()
  assert.equal(card.button('Mark dates unavailable').props.disabled, true)
  assert.equal(card.errors().length, 1)
  assert.doesNotMatch(card.text(), /private upstream details/u)
  failing = false
  const refresh = card.button('Refresh availability')
  assert.ok(refresh)
  refresh.props.onPress(); await flush()
  assert.equal(card.errors().length, 0)
  assert.equal(card.button('Mark dates unavailable').props.disabled, false)
  assert.match(card.text(), /Held while client reviews quote/u)
})

test('foreground refresh drops expired holds and cleans up its subscription on blur', async () => {
  let data = held()
  const card = availabilityHarness(async () => data)
  card.render(); await flush()
  assert.match(card.text(), /Held while client reviews quote/u)
  assert.equal(card.listeners(), 1)
  data = empty(); card.foreground(); await flush()
  assert.doesNotMatch(card.text(), /Held while client reviews quote/u)
  card.blur()
  assert.equal(card.listeners(), 0)
  card.foreground(); await flush()
  assert.equal(card.requests(), 2)
})

test('a stale request cannot replace a newer focus result or write state after blur', async () => {
  let finishOld
  let calls = 0
  const card = availabilityHarness(() => ++calls === 1 ? new Promise(resolve => { finishOld = resolve }) : Promise.resolve(held()))
  card.render(); await flush()
  card.blur(); card.focus(); await flush()
  assert.match(card.text(), /Held while client reviews quote/u)
  const before = card.writes()
  finishOld(empty()); await flush()
  assert.equal(card.writes(), before)
  assert.match(card.text(), /Held while client reviews quote/u)
})

test('an availability request finishing after blur cannot update hidden state', async () => {
  let rejectLoad
  const card = availabilityHarness(() => new Promise((_resolve, reject) => { rejectLoad = reject }))
  card.render(); await flush()
  card.blur()
  const before = card.writes()
  rejectLoad(Error('late offline response')); await flush()
  assert.equal(card.writes(), before)
  assert.equal(card.listeners(), 0)
})
