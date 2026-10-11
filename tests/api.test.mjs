import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const apiSource = fileURLToPath(new URL('../src/lib/api.ts', import.meta.url))

function loadApi(platform, authClient, fetch) {
  const exports = {}
  const code = ts.transpileModule(readFileSync(apiSource, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText

  vm.runInNewContext(code, {
    exports,
    require: name => {
      if (name === '@/lib/auth-client') return { authClient, apiBaseUrl: 'http://localhost:8081' }
      if (name === 'react-native') return { Platform: { OS: platform } }
      throw new Error(`Unexpected module: ${name}`)
    },
    fetch,
    Headers,
    URL,
    FormData,
  })

  return exports
}

test('web authenticated requests use browser cookies without reading Expo SecureStore', async () => {
  let getCookieCalls = 0
  let request
  const api = loadApi('web', {
    getCookie: async () => {
      getCookieCalls += 1
      throw new Error('ExpoSecureStore.default.getValueWithKeyAsync is not a function')
    },
  }, async (url, init) => {
    request = { url, init }
    return { ok: true, json: async () => ({ ok: true }) }
  })

  assert.deepEqual(await api.authenticatedFetch('/api/trips'), { ok: true })
  assert.equal(getCookieCalls, 0)
  assert.equal(request.init.credentials, 'include')
  assert.equal(request.init.headers.has('Cookie'), false)
})

test('native authenticated requests attach the Expo-managed cookie', async () => {
  let request
  const api = loadApi('ios', { getCookie: async () => 'fave.session_token=secret' }, async (url, init) => {
    request = { url, init }
    return { ok: true, json: async () => ({ ok: true }) }
  })

  await api.authenticatedFetch('/api/trips')
  assert.equal(request.init.credentials, 'omit')
  assert.equal(request.init.headers.get('Cookie'), 'fave.session_token=secret')
})
