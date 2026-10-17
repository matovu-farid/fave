import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const flush = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const item = (id, isRead = false) => ({ id, title: id, body: 'Safe preview', routeKey: 'availability', targetId: id, createdAt: 100, isRead, readAt: isRead ? 200 : null })
const page = (items, unreadCount = items.filter(value => !value.isRead).length, nextCursor = null) => ({ notifications: items, unreadCount, nextCursor })

// Execute the production screen; control only services, navigation and lifecycle.
function inboxHarness({ load, readAll = async () => ({ readAt: 200 }), readOne = async () => ({ readAt: 200 }) }) {
  const slots = [], effects = [], listeners = new Set(), timers = new Map(), requests = [], destinations = []
  let cursor = 0, dirty = true, tree, focusCallback, focusCleanup, focused = true, writes = 0, params = {}
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; dirty = true; writes++ }] },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial } },
    useCallback(callback, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { deps, callback }; return slots[index].callback },
    useEffect(effect, deps) {
      const index = cursor++
      if (!same(slots[index]?.deps, deps)) { const previous = slots[index], slot = slots[index] = { deps }; effects.push(() => { previous?.cleanup?.(); slot.cleanup = effect() }) }
    },
  }
  const jsx = (type, props) => ({ type, props }), module = { exports: {} }
  const source = readFileSync(new URL('../src/app/(tabs)/notifications.tsx', import.meta.url), 'utf8')
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    module, exports: module.exports, Promise, Date, Error,
    setTimeout(callback) { const id = Symbol(); timers.set(id, callback); return id }, clearTimeout(id) { timers.delete(id) },
    require(name) {
      if (name === 'react') return react
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
      if (name === 'react-native') return { ...Object.fromEntries(['ActivityIndicator', 'Pressable', 'ScrollView'].map(key => [key, key])), StyleSheet: { create: value => value }, AppState: { addEventListener(_event, listener) { listeners.add(listener); return { remove: () => listeners.delete(listener) } } } }
      if (name === 'expo-router') return { router: { push: value => destinations.push(value) }, useLocalSearchParams: () => params, useFocusEffect(callback) {
        react.useEffect(() => { focusCallback = callback; if (focused) focusCleanup = callback(); return () => { focusCleanup?.(); focusCleanup = undefined } }, [callback])
      } }
      if (name === '@/lib/marketplace') return { getNotificationInbox(next) { requests.push(next); return load(next) }, markAllNotificationsRead: readAll, markNotificationRead: readOne }
      if (name === '@/lib/push-notifications') return { getPushPermissionStatus: async () => 'unsupported' }
      if (name === '@/lib/notification-destination') return { getNotificationDestination: value => value.id }
      if (name === '@/components/marketplace-ui') return Object.fromEntries(['ActionButton', 'Card', 'Message', 'SectionTitle'].map(key => [key, key]))
      if (name.startsWith('@/components/') || name === 'react-native-safe-area-context') return new Proxy({}, { get: (_object, key) => key === '__esModule' ? true : key })
      if (name === '@/constants/theme') return { Spacing: {}, BottomTabInset: 0, MaxContentWidth: 700 }
      throw Error(`Unexpected dependency: ${name}`)
    },
  })
  function nodes(node, result = []) {
    if (Array.isArray(node)) { node.forEach(child => nodes(child, result)); return result }
    if (!node || typeof node !== 'object') return result
    if (node.type) result.push(node)
    nodes(node.props?.children, result); return result
  }
  function text(node) {
    if (Array.isArray(node)) return node.map(text).join('')
    if (node && typeof node === 'object') return text(node.props?.children)
    return typeof node === 'string' || typeof node === 'number' ? String(node) : ''
  }
  async function settle() {
    for (let i = 0; i < 30; i++) {
      if (dirty) { cursor = 0; dirty = false; tree = module.exports.default(); while (effects.length) effects.shift()() }
      for (const [id, callback] of timers) { timers.delete(id); callback() }
      await flush(); if (!dirty && !effects.length && !timers.size) return
    }
    throw Error('Inbox did not settle')
  }
  return {
    settle, text: () => text(tree), requests, destinations, writes: () => writes, listeners: () => listeners.size,
    pushTarget(id) { params = { notificationId: id }; dirty = true },
    button: title => nodes(tree).find(node => node.type === 'ActionButton' ? node.props.title === title : node.type === 'Pressable' && text(node) === title),
    notification: id => nodes(tree).find(node => node.type === 'Pressable' && node.props.accessibilityLabel === `${id}. Safe preview`),
    unread: () => nodes(tree).filter(node => node.props.accessibilityLabel === 'Unread').length,
    blur() { focused = false; focusCleanup?.(); focusCleanup = undefined },
    focus() { focused = true; focusCleanup = focusCallback?.() },
    foreground() { for (const listener of listeners) listener('active') },
  }
}

test('a delayed refresh cannot replace a newer inbox result or its unread count', async () => {
  const old = deferred(); let reads = 0
  const screen = inboxHarness({ load: () => ++reads === 1 ? old.promise : Promise.resolve(page([item('Newest alert')], 1)) })
  await screen.settle(); screen.foreground(); await screen.settle()
  assert.match(screen.text(), /Newest alert/u)
  old.resolve(page([item('Old alert')], 4)); await screen.settle()
  assert.match(screen.text(), /Newest alert/u)
  assert.doesNotMatch(screen.text(), /Old alert|4 unread/u)
})

test('a stale refresh failure cannot replace the newest successful inbox state', async () => {
  const old = deferred(); let reads = 0
  const screen = inboxHarness({ load: () => ++reads === 1 ? old.promise : Promise.resolve(page([item('Newest alert')])) })
  await screen.settle(); screen.foreground(); await screen.settle()
  old.reject(Error('Old read failed')); await screen.settle()
  assert.doesNotMatch(screen.text(), /Old read failed/u)
  assert.match(screen.text(), /Newest alert/u)
})

test('an older page cannot append to a refreshed inbox or change its cursor', async () => {
  const older = deferred(); let reads = 0
  const cursor = { createdAt: 100, id: 'first' }
  const screen = inboxHarness({ load: next => next ? older.promise : Promise.resolve(++reads === 1 ? page([item('First alert')], 2, cursor) : page([item('New page')], 1)) })
  await screen.settle(); screen.button('Load older notifications').props.onPress(); await screen.settle()
  screen.button('Refresh inbox').props.onPress(); await screen.settle()
  older.resolve(page([item('Stale older alert')], 2, { createdAt: 50, id: 'older' })); await screen.settle()
  assert.match(screen.text(), /New page/u)
  assert.doesNotMatch(screen.text(), /Stale older alert/u)
  assert.equal(screen.button('Load older notifications'), undefined)
})

test('mark all read cannot be undone by a response captured before the write', async () => {
  const old = deferred(); let reads = 0, read = false
  const screen = inboxHarness({ load: () => ++reads === 2 ? old.promise : Promise.resolve(page([item('Existing alert', read)])), readAll: async () => { read = true; return { readAt: 200 } } })
  await screen.settle(); screen.button('Refresh inbox').props.onPress(); await screen.settle()
  screen.button('Mark all read').props.onPress(); await screen.settle()
  old.resolve(page([item('Existing alert')], 1)); await screen.settle()
  assert.doesNotMatch(screen.text(), /1 unread/u)
  assert.equal(screen.unread(), 0)
  assert.match(screen.text(), /Existing alert/u)
})

test('read-all reloads authoritative state so an alert arriving after the write stays unread', async () => {
  let read = false
  const screen = inboxHarness({ load: async () => read ? page([item('New arrival'), item('Existing alert', true)], 1) : page([item('Existing alert')]), readAll: async () => { read = true; return { readAt: 200 } } })
  await screen.settle(); screen.button('Mark all read').props.onPress(); await screen.settle()
  assert.match(screen.text(), /New arrival/u)
  assert.match(screen.text(), /1 unread/u)
  assert.equal(screen.unread(), 1)
})

test('backgrounded inbox removes its resume listener and ignores pending reads', async () => {
  const old = deferred()
  const screen = inboxHarness({ load: () => old.promise })
  await screen.settle(); screen.blur()
  const writes = screen.writes(); old.resolve(page([item('Hidden result')])); await screen.settle()
  assert.equal(screen.writes(), writes)
  assert.equal(screen.listeners(), 0)
  screen.foreground(); assert.equal(screen.requests.length, 1)
})

test('rapid repeated opens mark one item once and navigate once', async () => {
  const pending = deferred(); let writes = 0
  const screen = inboxHarness({ load: async () => page([item('Open me'), item('Other alert')], 2), readOne: () => { writes++; return pending.promise } })
  await screen.settle(); const press = screen.notification('Open me').props.onPress
  press(); press(); await screen.settle(); pending.resolve({ readAt: 200 }); await screen.settle()
  assert.equal(writes, 1)
  assert.deepEqual(screen.destinations, ['Open me'])
})


test('a read write completing after blur and refocus reconciles current server state without stale navigation', async () => {
  for (const action of ['all', 'one']) {
    const pending = deferred(); let read = false
    const complete = async () => { await pending.promise; read = true; return { readAt: 200 } }
    const screen = inboxHarness({ load: async () => page([item('Existing alert', read)]), readAll: complete, readOne: complete })
    await screen.settle()
    if (action === 'all') screen.button('Mark all read').props.onPress()
    else screen.notification('Existing alert').props.onPress()
    await screen.settle(); screen.blur(); screen.focus(); await screen.settle()
    assert.equal(screen.unread(), 1)
    pending.resolve(); await screen.settle()
    assert.equal(screen.unread(), 0, action)
    assert.deepEqual(screen.destinations, [])
  }
})

test('a push target waits for a pending read action instead of being consumed without opening', async () => {
  const pending = deferred(); let read = false
  const screen = inboxHarness({ load: async () => page([item('Push target', read)]), readAll: async () => { await pending.promise; read = true; return { readAt: 200 } } })
  await screen.settle(); screen.button('Mark all read').props.onPress(); await screen.settle()
  screen.pushTarget('Push target'); await screen.settle()
  assert.deepEqual(screen.destinations, [])
  pending.resolve(); await screen.settle()
  assert.deepEqual(screen.destinations, ['Push target'])
})
