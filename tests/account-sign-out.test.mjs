import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)

// Render the real Account component with deterministic hooks and service boundaries.
// The action and resulting UI state are exercised; no source-text assertions.
function accountHarness({ signOut, unregisterPushNotifications = async () => {} }) {
  const state = []
  const destinations = []
  let cursor = 0
  const module = { exports: {} }
  const jsx = (type, props) => ({ type, props })
  const code = ts.transpileModule(readFileSync(new URL('../src/components/account-screen.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require(name) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' }
      if (name === 'react') return {
        useCallback: callback => callback,
        useState(initial) {
          const index = cursor++
          if (!(index in state)) state[index] = initial
          return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value }]
        },
      }
      if (name === 'react-native') return { ScrollView: 'ScrollView', StyleSheet: { create: value => value } }
      if (name === 'expo-router') return { router: { replace: path => destinations.push(path), push() {} }, useFocusEffect() {} }
      if (name === '@/components/marketplace-ui') return Object.fromEntries(['ActionButton', 'Card', 'CheckRow', 'Field', 'Message', 'SectionTitle'].map(name => [name, name]))
      if (name === '@/components/themed-text') return { ThemedText: 'ThemedText' }
      if (name === '@/components/themed-view') return { ThemedView: 'ThemedView' }
      if (name === '@/constants/theme') return { Spacing: {}, BottomTabInset: 0, MaxContentWidth: 700 }
      if (name === '@/lib/auth-client') return { authClient: { useSession: () => ({ data: { user: { email: 'synthetic@example.test' } } }), signOut } }
      if (name === '@/lib/marketplace') return {}
      if (name === '@/lib/push-notifications') return { unregisterPushNotifications }
      return require(name)
    },
  })
  function render() { cursor = 0; return module.exports.default({ onClose() {} }) }
  function elements(node, matches = []) {
    if (!node || typeof node !== 'object') return matches
    if (Array.isArray(node)) { node.forEach(child => elements(child, matches)); return matches }
    if (node.type) matches.push(node)
    elements(node.props?.children, matches)
    return matches
  }
  const button = () => elements(render()).find(node => node.type === 'ActionButton' && node.props.title === 'Sign out')
  const errors = () => elements(render()).filter(node => node.type === 'Message' && node.props.error).map(node => node.props.children)
  async function click() { button().props.onPress(); await new Promise(resolve => setImmediate(resolve)) }
  return { button, errors, click, destinations }
}

test('failed sign-out stays on Account, shows a retryable error and does not report success', async () => {
  let attempts = 0
  const screen = accountHarness({ signOut: async () => ++attempts === 1
    ? { data: null, error: { code: 'SERVICE_UNAVAILABLE', message: 'private upstream detail' } }
    : { data: { success: true }, error: null } })
  await screen.click()
  assert.deepEqual(screen.destinations, [])
  assert.equal(screen.button().props.busy, false)
  assert.equal(screen.errors().length, 1)
  assert.match(screen.errors()[0], /could not sign out|couldn't sign out/iu)
  assert.doesNotMatch(screen.errors()[0], /private upstream detail/u)
  await screen.click()
  assert.deepEqual(screen.destinations, ['/'])
  assert.equal(screen.errors().length, 0)
  assert.equal(screen.button().props.busy, false)
})

test('a rejected sign-out request is handled and releases the busy state', async () => {
  const screen = accountHarness({ signOut: async () => { throw new Error('network unavailable') } })
  await screen.click()
  assert.deepEqual(screen.destinations, [])
  assert.equal(screen.button().props.busy, false)
  assert.equal(screen.errors().length, 1)
})

test('push cleanup failure does not prevent a successful sign-out', async () => {
  const calls = []
  const screen = accountHarness({
    unregisterPushNotifications: async () => { calls.push('unregister'); throw new Error('offline cleanup') },
    signOut: async () => { calls.push('sign-out'); return { data: { success: true }, error: null } },
  })
  await screen.click()
  assert.deepEqual(calls, ['unregister', 'sign-out'])
  assert.deepEqual(screen.destinations, ['/'])
  assert.equal(screen.errors().length, 0)
  assert.equal(screen.button().props.busy, false)
})

test('sign-out stays busy until the authentication request settles', async () => {
  let finish
  const screen = accountHarness({ signOut: () => new Promise(resolve => { finish = resolve }) })
  await screen.click()
  assert.equal(screen.button().props.busy, true)
  assert.deepEqual(screen.destinations, [])
  finish({ data: { success: true }, error: null })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(screen.button().props.busy, false)
  assert.deepEqual(screen.destinations, ['/'])
})
