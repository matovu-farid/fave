import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const sourcePath = fileURLToPath(new URL('../src/lib/push-notifications.ts', import.meta.url))

function loadPushNotifications({ platform = 'ios', permissions = 'granted', requestStatus = 'granted', projectId = 'eas-project', serverError = null, disabled = false } = {}) {
  const exports = {}
  const calls = []
  const secureValues = new Map()
  if (disabled) secureValues.set('fave.push-enabled', 'false')
  let tokenListener = null
  const notifications = {
    AndroidImportance: { HIGH: 4 },
    async setNotificationChannelAsync(...args) { calls.push(['channel', ...args]) },
    async getPermissionsAsync() { calls.push(['getPermissions']); return { status: permissions } },
    async requestPermissionsAsync() { calls.push(['requestPermissions']); return { status: requestStatus } },
    async getExpoPushTokenAsync(options) { calls.push(['getToken', options]); return { data: 'ExponentPushToken[device-1]' } },
    addPushTokenListener(listener) { tokenListener = listener; return { remove() { calls.push(['removeListener']) } } },
  }
  const code = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  vm.runInNewContext(code, {
    exports,
    require: name => {
      if (name === 'expo-constants') return { __esModule: true, default: { expoConfig: { extra: { eas: { projectId } } } } }
      if (name === 'expo-notifications') return { __esModule: true, default: notifications, ...notifications }
      if (name === 'expo-secure-store') {
        const secure = {
        async setItemAsync(key, value) { calls.push(['secureSet', key, value]); secureValues.set(key, value) },
        async getItemAsync(key) { calls.push(['secureGet', key]); return secureValues.get(key) ?? null },
        async deleteItemAsync(key) { calls.push(['secureDelete', key]); secureValues.delete(key) },
        }
        return { __esModule: true, default: secure, ...secure }
      }
      if (name === 'react-native') return { Platform: { OS: platform } }
      if (name === '@/lib/api') return { authenticatedFetch: async (path, init) => {
        calls.push(['api', path, init])
        if (serverError) throw serverError
        return { registered: true }
      } }
      throw new Error(`Unexpected module: ${name}`)
    },
    Promise,
    JSON,
  })
  return { exports, calls, secureValues, get tokenListener() { return tokenListener } }
}

test('enabling notifications creates the Android channel before requesting permission and registers only an Expo token', async () => {
  const app = loadPushNotifications({ platform: 'android', permissions: 'undetermined' })
  const result = await app.exports.enablePushNotifications()

  assert.equal(result, 'enabled')
  assert.ok(app.calls.findIndex(call => call[0] === 'channel') < app.calls.findIndex(call => call[0] === 'requestPermissions'))
  assert.deepEqual(JSON.parse(app.calls.find(call => call[0] === 'api')[2].body), {
    token: 'ExponentPushToken[device-1]', platform: 'android',
  })
  assert.equal(app.secureValues.get('fave.push-token'), 'ExponentPushToken[device-1]')
})

test('denied permission does not request or save a push token', async () => {
  const app = loadPushNotifications({ permissions: 'denied', requestStatus: 'denied' })
  const result = await app.exports.enablePushNotifications()

  assert.equal(result, 'permission_denied')
  assert.equal(app.calls.some(call => call[0] === 'getToken'), false)
  assert.equal(app.calls.some(call => call[0] === 'api'), false)
})

test('app resume sync uses existing permission without prompting again', async () => {
  const app = loadPushNotifications({ permissions: 'granted' })
  const result = await app.exports.syncPushTokenForSignedInUser()

  assert.equal(result, 'enabled')
  assert.equal(app.calls.some(call => call[0] === 'requestPermissions'), false)
  assert.equal(app.calls.some(call => call[0] === 'api'), true)
})

test('sign-out unregisters the current token before clearing its secure local copy', async () => {
  const app = loadPushNotifications()
  app.secureValues.set('fave.push-token', 'ExponentPushToken[device-1]')
  await app.exports.unregisterPushNotifications()

  const apiIndex = app.calls.findIndex(call => call[0] === 'api')
  const deleteIndex = app.calls.findIndex(call => call[0] === 'secureDelete')
  assert.ok(apiIndex >= 0 && deleteIndex > apiIndex)
  assert.equal(app.secureValues.has('fave.push-token'), false)
})

test('failed sign-out unregister keeps the local token so it can be retried', async () => {
  const app = loadPushNotifications({ serverError: new Error('offline') })
  app.secureValues.set('fave.push-token', 'ExponentPushToken[device-1]')

  await assert.rejects(app.exports.unregisterPushNotifications(), /offline/u)
  assert.equal(app.secureValues.has('fave.push-token'), true)
})

test('a changed native push token triggers a fresh Expo-token registration', async () => {
  const app = loadPushNotifications()
  const subscription = app.exports.subscribeToPushTokenChanges()
  app.tokenListener?.({ data: 'native-token-changed' })
  await new Promise(resolve => setTimeout(resolve, 0))

  assert.equal(app.calls.filter(call => call[0] === 'api').length, 1)
  subscription.remove()
  assert.ok(app.calls.some(call => call[0] === 'removeListener'))
})

test('app resume does not re-register a device after the user turned push notifications off', async () => {
  const app = loadPushNotifications({ disabled: true })
  const result = await app.exports.syncPushTokenForSignedInUser()

  assert.equal(result, 'disabled')
  assert.equal(app.calls.some(call => call[0] === 'getPermissions'), false)
  assert.equal(app.calls.some(call => call[0] === 'api'), false)
})

test('turning off push removes the server token before saving the disabled preference', async () => {
  const app = loadPushNotifications()
  app.secureValues.set('fave.push-token', 'ExponentPushToken[device-1]')
  await app.exports.disablePushNotifications()

  const apiIndex = app.calls.findIndex(call => call[0] === 'api')
  const disabledIndex = app.calls.findIndex(call => call[0] === 'secureSet' && call[1] === 'fave.push-enabled')
  assert.ok(apiIndex >= 0 && disabledIndex > apiIndex)
  assert.equal(app.secureValues.get('fave.push-enabled'), 'false')
})
