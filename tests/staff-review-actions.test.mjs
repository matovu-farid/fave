import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const flush = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
class ApiError extends Error { constructor(status, message) { super(message); this.status = status } }
const detail = () => ({ id: 'driver-app', label: 'Synthetic driver', status: 'pending_verification', checklist: [], blockers: [], documents: [{ id: 'front', type: 'national_id_front', status: 'pending', contentType: 'image/png' }] })

// Render the real detail component. Only services, platform and route lifecycle
// are controlled; action locking, errors, generation checks and object URLs run.
function reviewHarness({ reveal = async () => ({ nationalIdNumber: 'SYNTHETIC-NEW-ID' }), decide = async () => ({}), evidence = async () => new Blob(['synthetic'], { type: 'image/png' }), load = async () => detail() } = {}) {
  const slots = [], effects = [], timers = new Map(), revoked = [], created = []
  let cursor = 0, dirty = true, tree, focused = true, focusCallback, focusCleanup, writes = 0, detailReads = 0, securityReads = 0
  let access = { unlocked: true, refresh: async () => { securityReads++ } }
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; dirty = true; writes++ }] },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial } },
    useCallback(callback, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, callback }; return slots[i].callback },
    useEffect(effect, deps) {
      const i = cursor++
      if (!same(slots[i]?.deps, deps)) { const previous = slots[i], slot = slots[i] = { deps }; effects.push(() => { previous?.cleanup?.(); slot.cleanup = effect() }) }
    },
  }
  const jsx = (type, props) => ({ type, props }), module = { exports: {} }
  const source = readFileSync(new URL('../src/components/staff-review/application-detail.tsx', import.meta.url), 'utf8')
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    module, exports: module.exports, Promise, Error, AbortController,
    URL: { createObjectURL(blob) { const url = `blob:synthetic-${created.length}`; created.push({ url, blob }); return url }, revokeObjectURL: url => revoked.push(url) },
    setTimeout(callback) { const id = Symbol(); timers.set(id, callback); return id }, clearTimeout(id) { timers.delete(id) },
    require(name) {
      if (name === 'react') return react
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
      if (name === 'react-native') return { ActivityIndicator: 'ActivityIndicator', View: 'View', Platform: { OS: 'web' } }
      if (name === 'expo-router') return { Link: 'Link', useFocusEffect(callback) { react.useEffect(() => { focusCallback = callback; if (focused) focusCleanup = callback(); return () => { focusCleanup?.(); focusCleanup = undefined } }, [callback]) } }
      if (name === '@/lib/api') return { ApiError }
      if (name === '@/lib/staff-review') return { getReviewDetail() { detailReads++; return load() }, revealReviewIdentity: reveal, decideReview: decide, openReviewEvidence: evidence }
      if (name === '@/components/marketplace-ui') return Object.fromEntries(['ActionButton', 'Card', 'Field', 'Message', 'SectionTitle'].map(key => [key, key]))
      if (name === '@/components/themed-text') return { ThemedText: 'ThemedText' }
      if (name === './review-decision') return { __esModule: true, default: 'ReviewDecision' }
      if (name === './evidence-viewer') return { __esModule: true, default: 'EvidenceViewer' }
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
      if (dirty) { cursor = 0; dirty = false; tree = module.exports.default({ kind: 'drivers', id: 'driver-app', access }); while (effects.length) effects.shift()() }
      for (const [id, callback] of timers) { timers.delete(id); callback() }
      await flush(); if (!dirty && !effects.length && !timers.size) return
    }
    throw Error('Review component did not settle')
  }
  return {
    settle, text: () => text(tree), writes: () => writes, detailReads: () => detailReads, securityReads: () => securityReads, revoked, created,
    button: title => nodes(tree).find(node => node.type === 'ActionButton' && node.props.title === title),
    purpose(value = 'Synthetic evidence review') { nodes(tree).find(node => node.type === 'Field' && node.props.label === 'Purpose of access').props.onChangeText(value) },
    decision: () => nodes(tree).find(node => node.type === 'ReviewDecision' && node.props.label === 'Synthetic driver'),
    viewer: () => nodes(tree).find(node => node.type === 'EvidenceViewer'),
    blur() { focused = false; focusCleanup?.(); focusCleanup = undefined; access = { ...access, unlocked: false }; dirty = true },
    focus() { focused = true; focusCleanup = focusCallback?.(); access = { ...access, unlocked: true }; dirty = true },
  }
}

// Keep the real decision form's promise callbacks in this regression: an ignored
// duplicate must not look like a successful save and erase an unfinished draft.
function decisionHarness(props) {
  const slots = []; let cursor = 0, tree
  const jsx = (type, props) => ({ type, props }), module = { exports: {} }
  const source = readFileSync(new URL('../src/components/staff-review/review-decision.tsx', import.meta.url), 'utf8')
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    module, exports: module.exports,
    require(name) {
      if (name === 'react') return { useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = value }] } }
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
      if (name === 'react-native') return { View: 'View' }
      if (name === '@/components/marketplace-ui') return { ActionButton: 'ActionButton', Field: 'Field', Message: 'Message' }
      if (name === '@/components/themed-text') return { ThemedText: 'ThemedText' }
      throw Error(`Unexpected decision dependency: ${name}`)
    },
  })
  function nodes(node) { return Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === 'object' ? [node, ...nodes(node.props?.children)] : [] }
  return {
    async settle() { await flush(); cursor = 0; tree = module.exports.default(props()) },
    button: title => nodes(tree).find(node => node.type === 'ActionButton' && node.props.title === title),
    field: prefix => nodes(tree).find(node => node.type === 'Field' && node.props.label.startsWith(prefix)),
  }
}

test('duplicate decision clicks preserve the real form draft through a recoverable failure and retry', async () => {
  const pending = deferred(); let writes = 0
  const screen = reviewHarness({ decide: () => ++writes === 1 ? pending.promise : Promise.resolve({}) })
  await screen.settle()
  const form = decisionHarness(() => screen.decision().props)
  await form.settle(); form.button('Review Synthetic driver').props.onPress(); await form.settle()
  form.field('Internal review').props.onChangeText('Synthetic saved reason')
  form.field('Correction message').props.onChangeText('Synthetic saved correction')
  await form.settle(); form.button('Approve').props.onPress(); await form.settle()
  const confirm = form.button('Confirm approve for Synthetic driver').props.onPress
  confirm(); confirm(); await screen.settle(); await form.settle()
  assert.equal(writes, 1)
  assert.equal(form.field('Internal review')?.props.value, 'Synthetic saved reason')
  assert.equal(form.button('Confirm approve for Synthetic driver')?.props.busy, true)
  pending.reject(new ApiError(503, 'Synthetic temporary decision failure'))
  await screen.settle(); await form.settle()
  assert.match(screen.text(), /Synthetic temporary decision failure/u)
  assert.equal(form.field('Internal review')?.props.value, 'Synthetic saved reason')
  assert.equal(form.field('Correction message')?.props.value, 'Synthetic saved correction')
  assert.equal(form.button('Confirm approve for Synthetic driver')?.props.busy, false)
  form.button('Confirm approve for Synthetic driver').props.onPress()
  await screen.settle(); await form.settle()
  assert.equal(writes, 2)
  assert.equal(form.field('Internal review'), undefined)
  assert.ok(form.button('Review Synthetic driver'))
})

for (const status of [503, 428, 409]) {
  test(`late ${status} identity failure cannot disturb the newer review after leaving and returning`, async () => {
    const old = deferred(); let calls = 0
    const screen = reviewHarness({ reveal: () => ++calls === 1 ? old.promise : Promise.resolve({ nationalIdNumber: 'SYNTHETIC-NEW-ID' }) })
    await screen.settle(); screen.purpose(); await screen.settle()
    screen.button('Open identity details').props.onPress(); await screen.settle()
    screen.blur(); await screen.settle(); screen.focus(); await screen.settle()
    screen.purpose(); await screen.settle(); screen.button('Open identity details').props.onPress(); await screen.settle()
    assert.match(screen.text(), /SYNTHETIC-NEW-ID/u)
    old.reject(new ApiError(status, 'Stale private review failure')); await screen.settle()
    assert.match(screen.text(), /SYNTHETIC-NEW-ID/u)
    assert.doesNotMatch(screen.text(), /Stale private review failure/u)
    assert.equal(screen.detailReads(), 2)
    assert.equal(screen.securityReads(), 0)
  })
}

test('an old action completion cannot clear the newer action busy state', async () => {
  const old = deferred(), latest = deferred(); let calls = 0
  const screen = reviewHarness({ reveal: () => ++calls === 1 ? old.promise : latest.promise })
  await screen.settle(); screen.purpose(); await screen.settle(); screen.button('Open identity details').props.onPress(); await screen.settle()
  screen.blur(); await screen.settle(); screen.focus(); await screen.settle(); screen.purpose(); await screen.settle()
  screen.button('Open identity details').props.onPress(); await screen.settle()
  old.resolve({ nationalIdNumber: 'SYNTHETIC-OLD-ID' }); await screen.settle()
  assert.equal(screen.button('Open identity details').props.busy, true)
  assert.doesNotMatch(screen.text(), /SYNTHETIC-OLD-ID/u)
  latest.resolve({ nationalIdNumber: 'SYNTHETIC-NEW-ID' }); await screen.settle()
  assert.equal(screen.button('Open identity details').props.busy, false)
  assert.match(screen.text(), /SYNTHETIC-NEW-ID/u)
})

test('rapid repeated private actions issue one request before the busy render', async () => {
  const pending = deferred(); let reads = 0
  const screen = reviewHarness({ reveal: () => { reads++; return pending.promise } })
  await screen.settle(); screen.purpose(); await screen.settle()
  const press = screen.button('Open identity details').props.onPress
  press(); press(); await screen.settle()
  assert.equal(reads, 1)
  pending.resolve({ nationalIdNumber: 'SYNTHETIC-NEW-ID' }); await screen.settle()
})

test('a delayed decision conflict after leaving does not refresh or show errors on the returned review', async () => {
  const pending = deferred()
  const screen = reviewHarness({ decide: () => pending.promise })
  await screen.settle()
  const result = screen.decision().props.onDecision('approve', 'Synthetic reason', '').catch(() => undefined)
  await screen.settle(); screen.blur(); await screen.settle(); screen.focus(); await screen.settle()
  pending.reject(new ApiError(409, 'Stale decision conflict')); await result; await screen.settle()
  assert.equal(screen.detailReads(), 2)
  assert.doesNotMatch(screen.text(), /Stale decision conflict/u)
})

test('active conflicts refresh the checklist, release busy state and retain the error', async () => {
  const screen = reviewHarness({ decide: async () => { throw new ApiError(409, 'Review changed; refresh required') } })
  await screen.settle()
  await screen.decision().props.onDecision('approve', 'Synthetic reason', '').catch(() => undefined)
  await screen.settle()
  assert.equal(screen.detailReads(), 2)
  assert.match(screen.text(), /Review changed; refresh required/u)
  assert.equal(screen.button('Open identity details').props.busy, false)
})

test('late aborted evidence cannot create an object URL or end a newer private action', async () => {
  const file = deferred(), identity = deferred()
  const screen = reviewHarness({ evidence: () => file.promise, reveal: () => identity.promise })
  await screen.settle(); screen.purpose(); await screen.settle()
  screen.button('Open national id front').props.onPress(); await screen.settle()
  screen.blur(); await screen.settle(); screen.focus(); await screen.settle(); screen.purpose(); await screen.settle()
  screen.button('Open identity details').props.onPress(); await screen.settle()
  file.resolve(new Blob(['synthetic'], { type: 'image/png' })); await screen.settle()
  assert.equal(screen.created.length, 0)
  assert.equal(screen.button('Open identity details').props.busy, true)
  identity.resolve({ nationalIdNumber: 'SYNTHETIC-NEW-ID' }); await screen.settle()
})

test('closing or leaving a loaded private file revokes its object URL', async () => {
  const screen = reviewHarness()
  await screen.settle(); screen.purpose(); await screen.settle()
  screen.button('Open national id front').props.onPress(); await screen.settle()
  assert.ok(screen.viewer())
  screen.button('Close evidence').props.onPress(); await screen.settle()
  assert.equal(screen.viewer(), undefined)
  assert.deepEqual(screen.revoked, ['blob:synthetic-0'])
  screen.button('Open national id front').props.onPress(); await screen.settle(); screen.blur(); await screen.settle()
  assert.equal(screen.viewer(), undefined)
  assert.deepEqual(screen.revoked, ['blob:synthetic-0', 'blob:synthetic-1'])
})
