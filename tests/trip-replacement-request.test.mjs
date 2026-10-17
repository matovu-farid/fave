import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const estimate = {
  estimateId: 'new-estimate', vehicleId: 'car-2',
  pickup: { address: 'Kampala', input: { address: 'Kampala' }, latitude: 0.3, longitude: 32.5 },
  destination: { address: 'Jinja', input: { address: 'Jinja' }, latitude: 0.4, longitude: 33.2 },
  startDate: '2099-01-05', endDate: '2099-01-07', partySize: 2, luggageCount: 1,
  vehicle: { make: 'Toyota', model: 'Other car', year: 2022 },
  quote: { currency: 'UGX', totalAmount: 484000, components: [], nights: 2 },
  route: { distanceMeters: 80000, durationSeconds: 7200 },
}
const oldRequest = { requestId: 'old-request', status: 'unavailable', estimate, needsReview: false }
const newRequest = { requestId: 'replacement-request', status: 'requested', estimate, needsReview: false, createdAt: Date.now() }

// Exercise the actual Trips component. Only hooks, routing and remote service
// boundaries are controlled; state transitions and recovery effects are real.
function tripHarness({ params = { focusTargetId: oldRequest.requestId, focusTargetType: 'availability' }, failSubmission = false } = {}) {
  const slots = [], effects = [], lookups = [], navigations = []
  let cursor = 0, dirty = true, tree
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
  const react = {
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = initial
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; dirty = true }]
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial } },
    useMemo(factory, deps) {
      const index = cursor++
      if (!same(slots[index]?.deps, deps)) slots[index] = { deps, value: factory() }
      return slots[index].value
    },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps) },
    useEffect(effect, deps) {
      const index = cursor++
      if (!same(slots[index]?.deps, deps)) {
        const previous = slots[index], slot = slots[index] = { deps }
        effects.push(() => { previous?.cleanup?.(); slot.cleanup = effect() })
      }
    },
  }
  const jsx = (type, props) => ({ type, props })
  const services = {
    async getClientPrerequisites() { return { documents: [], bookingDocuments: [], profile: { legalName: 'Synthetic client', phoneNumber: '+256700000000' } } },
    async getMyBookings() { return { bookings: [] } },
    async getCurrentTripOffer() { return { offer: null } },
    async getAvailabilityRequest(id) { lookups.push(id); return { request: id === oldRequest.requestId ? oldRequest : newRequest } },
    async getAvailableVehicles() { return { vehicles: [{ id: 'car-2', ...estimate.vehicle, photos: [] }] } },
    async createTripEstimate() { return estimate },
    async requestAvailabilityCheck(id) {
      assert.equal(id, estimate.estimateId)
      if (failSubmission) throw Error('Please retry the request.')
      return { requestId: newRequest.requestId, estimateId: id, createdAt: newRequest.createdAt }
    },
  }
  const module = { exports: {} }
  const source = readFileSync(new URL('../src/app/(tabs)/trips/index.tsx', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText
  vm.runInNewContext(code, {
    module, exports: module.exports, console, Date, Promise, Error, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
    require(name) {
      if (name === 'react') return react
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' }
      if (name === 'react-native') return { Image: 'Image', View: 'View', ScrollView: 'ScrollView', StyleSheet: { create: value => value } }
      if (name === 'expo-router') return { useLocalSearchParams: () => params, router: { setParams(next) { params = { ...params, ...next }; navigations.push({ ...params }); dirty = true } } }
      if (name === '@/lib/auth-client') return { authClient: { useSession: () => ({ data: { user: { id: 'synthetic-client' } } }) } }
      if (name === '@/lib/marketplace') return services
      if (name === '@/lib/trip-draft-storage') return { tripDraftStore: { async load() { return null }, async save() {}, async clear() {} } }
      if (name === '@/lib/api') return { ApiError: class extends Error {}, apiBaseUrl: 'https://example.test' }
      if (name === '@/constants/theme') return { Spacing: {}, BottomTabInset: 0, MaxContentWidth: 700 }
      if (name === '@/components/marketplace-ui') return { ...Object.fromEntries(['ActionButton', 'Card', 'CheckRow', 'Field', 'Message', 'SectionTitle'].map(key => [key, key])), formStyles: {} }
      if (name.startsWith('@/components/')) return new Proxy({}, { get: (_object, key) => key === '__esModule' ? true : key })
      if (name.startsWith('@/lib/')) return require(`../src/lib/${name.slice('@/lib/'.length)}.ts`)
      throw Error(`Unexpected dependency: ${name}`)
    },
  })
  const render = () => { cursor = 0; dirty = false; tree = module.exports.default(); while (effects.length) effects.shift()(); return tree }
  const elements = (node, result = []) => {
    if (Array.isArray(node)) { node.forEach(child => elements(child, result)); return result }
    if (!node || typeof node !== 'object') return result
    if (node.type) result.push(node)
    elements(node.props?.children, result); return result
  }
  async function settle() {
    for (let i = 0; i < 30; i++) { if (dirty) render(); await new Promise(resolve => setImmediate(resolve)); if (!dirty && !effects.length) return }
    throw Error('Trips did not settle')
  }
  async function click(title) {
    const button = elements(tree).find(node => node.type === 'ActionButton' && node.props.title === title)
    assert.ok(button, `Missing button: ${title}`); assert.ok(!button.props.disabled, `Disabled button: ${title}`)
    button.props.onPress(); await settle()
  }
  const messages = () => elements(tree).filter(node => node.type === 'Message').map(node => node.props.children).filter(value => typeof value === 'string')
  return { settle, click, messages, lookups, navigations, params: () => params }
}

test('a replacement request updates the old alert target and reopens the new pending request', async () => {
  const screen = tripHarness()
  await screen.settle()
  await screen.click('Find available vehicles')
  await screen.click('See price estimate')
  await screen.click('Ask Fave to book these dates')
  assert.equal(screen.params().focusTargetId, newRequest.requestId)
  assert.equal(screen.params().focusTargetType, 'availability')
  assert.ok(screen.lookups.includes(newRequest.requestId), 'parameter recovery must read the new request')
  assert.ok(!screen.messages().some(message => message.includes('could not confirm')))
  const reopened = tripHarness({ params: screen.params() })
  await reopened.settle()
  assert.deepEqual(reopened.lookups, [newRequest.requestId])
  assert.ok(reopened.messages().some(message => message.includes('No payment is due')))
})

test('a failed replacement keeps the old target and leaves the new estimate retryable', async () => {
  const screen = tripHarness({ failSubmission: true })
  await screen.settle()
  await screen.click('Find available vehicles')
  await screen.click('See price estimate')
  await screen.click('Ask Fave to book these dates')
  assert.deepEqual(screen.navigations, [])
  assert.equal(screen.params().focusTargetId, oldRequest.requestId)
  assert.ok(screen.messages().includes('Please retry the request.'))
})
