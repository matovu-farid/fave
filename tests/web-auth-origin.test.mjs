import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(new URL('../fave-worker/package.json', import.meta.url))
const { build } = require('esbuild')
const directory = mkdtempSync(join(tmpdir(), 'fave-web-origin-'))
let createAuth
const env = { BETTER_AUTH_URL: 'https://api.fave.fidexa.org', BETTER_AUTH_SECRET: 'test-secret-at-least-thirty-two-characters', WEB_APP_ORIGINS: 'http://localhost:8081,http://127.0.0.1:8081', ENVIRONMENT: 'production' }

test.before(async () => {
  const outfile = join(directory, 'auth.mjs')
  await build({ entryPoints: [new URL('../fave-worker/src/auth.ts', import.meta.url).pathname], outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
  ;({ createAuth } = await import(pathToFileURL(outfile).href))
})
test.after(() => rmSync(directory, { recursive: true, force: true }))

test('localhost forwarding keeps cookies on localhost and provider callbacks on the canonical API', () => {
  const auth = createAuth(env, new Headers({ 'x-fave-web-origin': 'http://localhost:8081' }))
  assert.equal(auth.options.baseURL, 'http://localhost:8081')
  assert.equal(auth.options.advanced.useSecureCookies, false)
  const plugin = auth.options.plugins.find(plugin => plugin.id === 'oauth-proxy')
  assert.equal(plugin.options.productionURL, env.BETTER_AUTH_URL)
  assert.equal(plugin.options.currentURL, 'http://localhost:8081')
})

test('native requests retain the secure canonical API cookies', () => {
  const auth = createAuth(env)
  assert.equal(auth.options.baseURL, env.BETTER_AUTH_URL)
  assert.notEqual(auth.options.advanced?.useSecureCookies, false)
})

for (const origin of ['https://unapproved.example', 'http://localhost:9999', 'https://localhost:8081', 'http://localhost:8081.evil.example']) {
  test(`a forwarded origin cannot select an unapproved cookie host: ${origin}`, () => {
    const auth = createAuth(env, new Headers({ 'x-fave-web-origin': origin }))
    assert.equal(auth.options.baseURL, env.BETTER_AUTH_URL)
  })
}

test('forwarding must also be explicitly enabled in the Worker configuration', () => {
  const auth = createAuth({ ...env, WEB_APP_ORIGINS: '' }, new Headers({ 'x-fave-web-origin': 'http://localhost:8081' }))
  assert.equal(auth.options.baseURL, env.BETTER_AUTH_URL)
})
