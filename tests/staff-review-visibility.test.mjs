import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const flush = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

// Run the production hook; control only React's lifecycle and HTTP boundaries.
function securityHarness({ load, lock }) {
  const slots = [], effects = [], listeners = new Set()
  let cursor = 0, focusCleanup, dirty = true, state, reads = 0, locks = 0
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
  const react = {
    useState(initial) {
      const i = cursor++
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; dirty = true }]
    },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial } },
    useCallback(callback, deps) {
      const i = cursor++
      if (!same(slots[i]?.deps, deps)) slots[i] = { deps, callback }
      return slots[i].callback
    },
    useEffect(effect, deps) {
      const i = cursor++
      if (!same(slots[i]?.deps, deps)) {
        const previous = slots[i], slot = slots[i] = { deps }
        effects.push(() => { previous?.cleanup?.(); slot.cleanup = effect() })
      }
    },
  }
  const document = {
    hidden: false,
    addEventListener(_type, listener) { listeners.add(listener) },
    removeEventListener(_type, listener) { listeners.delete(listener) },
  }
  const module = { exports: {} }
  const service = { exports: {} }
  const storage = new Map()
  const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const loadService = () => vm.runInNewContext(compile(readFileSync(new URL('../src/lib/staff-review.ts', import.meta.url), 'utf8')), {
    module: service, exports: service.exports, Promise, Error,
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    require(name) {
      assert.equal(name, './api')
      return { authenticatedFetch(path) {
        if (path.endsWith('/lock')) { locks++; return lock() }
        assert.equal(path, '/api/admin/review-security')
        reads++; return load()
      } }
    },
  })
  loadService()
  const source = readFileSync(new URL('../src/components/staff-review/security-panel.tsx', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  vm.runInNewContext(code, {
    module, exports: module.exports, document, Date, Promise, Error,
    setInterval: () => 1, clearInterval() {},
    require(name) {
      if (name === 'react') return react
      if (name === 'react/jsx-runtime') return { jsx() {}, jsxs() {} }
      if (name === 'react-native') return { Platform: { OS: 'web' } }
      if (name === 'expo-router') return { useFocusEffect(callback) { react.useEffect(() => { focusCleanup = callback(); return () => focusCleanup?.() }, [callback]) } }
      if (name === '@/lib/staff-review') return service.exports
      if (name.startsWith('@/') || name === './enrollment-code') return {}
      throw Error(`Unexpected dependency: ${name}`)
    },
  })
  async function settle() {
    for (let i = 0; i < 15; i++) {
      if (dirty) { cursor = 0; dirty = false; state = module.exports.useReviewSecurity(); while (effects.length) effects.shift()() }
      await flush()
      if (!dirty && !effects.length) return state
    }
    throw Error('Security hook did not settle')
  }
  return {
    settle, state: () => state, reads: () => reads, locks: () => locks,
    visibility(hidden) { document.hidden = hidden; for (const listener of listeners) listener() },
    refresh() { return state.refresh() },
    lock: () => service.exports.lockReviews(),
    blur() { focusCleanup?.() },
    remount() {
      for (const slot of slots) slot?.cleanup?.()
      slots.length = 0; effects.length = 0; dirty = true
    },
    reload() { this.remount(); loadService() },
    storedValues: () => [...storage.values()],
  }
}

const unlocked = () => ({ unlocked: true, expiresAt: Date.now() + 600000, method: 'totp', passkeys: [], authenticator: true, firstEnrollment: false })
const locked = () => ({ ...unlocked(), unlocked: false, expiresAt: null, method: null })

test('returning before a background lock completes cannot restore unlocked access', async () => {
  const request = deferred()
  let server = unlocked()
  const screen = securityHarness({ load: async () => server, lock: () => request.promise.then(() => { server = locked() }) })
  await screen.settle()
  assert.equal(screen.state().unlocked, true)
  screen.visibility(true); await screen.settle()
  assert.equal(screen.state().unlocked, false)
  screen.visibility(false); await screen.settle()
  assert.equal(screen.state().unlocked, false, 'must remain locked while revocation is pending')
  assert.equal(screen.reads(), 1, 'must not query the old proof ahead of its lock')
  request.resolve(); await screen.settle()
  assert.equal(screen.state().unlocked, false)
  assert.equal(screen.reads(), 2)
})

test('failed background revocation stays locked and an explicit retry locks before loading', async () => {
  const request = deferred()
  let server = unlocked(), retry = false
  const screen = securityHarness({ load: async () => server, lock: async () => {
    if (!retry) return request.promise
    server = locked()
  } })
  await screen.settle()
  screen.visibility(true); screen.visibility(false)
  request.reject(Error('offline')); await screen.settle()
  assert.equal(screen.state().unlocked, false)
  assert.ok(screen.state().error, 'explain that verification could not be refreshed safely')
  assert.equal(screen.reads(), 1)
  retry = true
  await screen.refresh(); await screen.settle()
  assert.equal(screen.locks(), 2)
  assert.equal(screen.state().unlocked, false)
  assert.equal(screen.state().error, '')
})

test('a status response started before hiding cannot repopulate security after the lock', async () => {
  const oldStatus = deferred()
  let reads = 0
  const screen = securityHarness({ load: () => ++reads === 1 ? oldStatus.promise : Promise.resolve(locked()), lock: async () => {} })
  await screen.settle()
  screen.visibility(true); screen.visibility(false); await screen.settle()
  oldStatus.resolve(unlocked()); await screen.settle()
  assert.equal(screen.state().unlocked, false)
})

test('a newly mounted review route shares the pending background-lock barrier', async () => {
  const request = deferred()
  let server = unlocked()
  const screen = securityHarness({ load: async () => server, lock: () => request.promise.then(() => { server = locked() }) })
  await screen.settle()
  screen.visibility(true); screen.visibility(false); await screen.settle()
  screen.remount(); await screen.settle()
  assert.equal(screen.state().unlocked, false)
  assert.equal(screen.reads(), 1, 'the new route must also wait for the lock')
  assert.equal(screen.locks(), 1, 'routes share the same lock request')
  request.resolve(); await screen.settle()
  assert.equal(screen.state().unlocked, false)
})

test('a full reload retries an unfinished lock without storing proof or identity', async () => {
  let server = unlocked(), failing = true
  const screen = securityHarness({ load: async () => server, lock: async () => {
    if (failing) throw Error('offline')
    server = locked()
  } })
  await screen.settle()
  screen.visibility(true); screen.visibility(false); await screen.settle()
  assert.equal(screen.state().unlocked, false)
  screen.reload(); await screen.settle()
  assert.equal(screen.state().unlocked, false, 'reload must not forget the failed lock')
  assert.equal(screen.reads(), 1)
  assert.deepEqual(screen.storedValues(), ['1'], 'store only a pending-lock marker')
  failing = false
  await screen.refresh(); await screen.settle()
  assert.equal(screen.state().unlocked, false)
  assert.deepEqual(screen.storedValues(), [])
})

test('an explicit failed lock also survives a full reload', async () => {
  const screen = securityHarness({ load: async () => unlocked(), lock: async () => { throw Error('offline') } })
  await screen.settle()
  await assert.rejects(screen.lock())
  screen.reload(); await screen.settle()
  assert.equal(screen.state().unlocked, false)
  assert.equal(screen.reads(), 1)
})
