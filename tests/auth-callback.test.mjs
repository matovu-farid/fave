import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const linkingDirectory = join(dirname(require.resolve('expo-linking/package.json')), 'build')
const executionEnvironments = { Bare: 'bare', StoreClient: 'storeClient', Standalone: 'standalone' }

function loadSource(path, modules, globals = {}) {
  const exports = {}
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText
  vm.runInNewContext(code, {
    exports,
    require: name => {
      assert.ok(name in modules, `Unexpected module: ${name}`)
      return modules[name]
    },
    URL, URLSearchParams, console, __DEV__: true, ...globals,
  })
  return exports
}

function renderAuthGate(platform, executionEnvironment) {
  const constants = {
    executionEnvironment,
    expoConfig: { scheme: 'fave', hostUri: '192.168.1.65:8081' },
    expoGoConfig: { developer: { tool: 'expo-cli' } },
    linkingUri: 'exp://192.168.1.65:8081/--/',
  }
  const Platform = { OS: platform, select: options => options[platform] ?? options.default }
  const constantsModule = { __esModule: true, default: constants, ExecutionEnvironment: executionEnvironments }
  // Run the installed Expo URL implementation, mocking only its native bindings.
  const schemes = loadSource(join(linkingDirectory, 'Schemes.js'), {
    'expo-constants': constantsModule, 'expo-modules-core': { Platform },
  })
  const linking = platform === 'web'
    ? loadSource(join(linkingDirectory, 'createURL.web.js'), {}, { window: { location: { origin: 'https://fave.example' } } })
    : loadSource(join(linkingDirectory, 'createURL.js'), {
      'expo-constants': constantsModule, './Schemes': schemes, './validateURL': { validateURL: () => {} },
    })
  const requests = []
  const state = []
  const react = {
    useState: value => {
      const index = state.push(value) - 1
      return [value, next => { state[index] = next }]
    },
    createElement: (type, props, ...children) => ({ type, props, children }),
  }
  const component = loadSource(new URL('../src/components/auth-gate.tsx', import.meta.url), {
    react,
    'react-native': { Platform, ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: styles => styles } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-constants': constantsModule,
    'expo-linking': linking,
    '@/lib/auth-client': { authClient: {
      useSession: () => ({ data: null, isPending: false }),
      signIn: { social: async request => { requests.push(request); return {} } },
    } },
  }, { React: react, process: { env: { EXPO_PUBLIC_API_URL: 'https://api.fave.fidexa.org' } } })
  function buttons(node) {
    return node?.type === 'Pressable' ? [node] : (node?.children ?? []).flatMap(buttons)
  }
  const controls = buttons(component.AuthGate({ children: null }))
  return { controls, requests, state, linking }
}

test('installed Expo Linking ignores the Fave scheme in Expo Go', () => {
  const { linking } = renderAuthGate('ios', 'storeClient')
  assert.equal(linking.createURL('/', { scheme: 'fave' }), 'exp://192.168.1.65:8081/--/')
})

for (const [index, provider] of ['google', 'apple'].entries()) {
  test(`${provider} in Expo Go explains the required app without contacting the API`, async () => {
    const { controls, requests, state } = renderAuthGate('ios', 'storeClient')
    controls[index].props.onPress()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(requests.length, 0)
    assert.match(state[0], /Fave.*development app/i)
    assert.match(state[0], /Expo Go/i)
    assert.equal(state[1], false)
  })

  test(`${provider} in the native development app returns through the registered Fave scheme`, async () => {
    const { controls, requests } = renderAuthGate('ios', 'bare')
    controls[index].props.onPress()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(requests[0].provider, provider)
    assert.equal(requests[0].callbackURL, 'fave:///')
  })
}

test('web sign-in returns to the website origin', async () => {
  const { controls, requests } = renderAuthGate('web', 'bare')
  controls[0].props.onPress()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(requests[0].callbackURL, 'https://fave.example')
})
