import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

const require = createRequire(import.meta.url)
const proxyFile = new URL('../scripts/dev-api-proxy.cjs', import.meta.url)
const { createDevApiProxy } = existsSync(proxyFile)
  ? require(proxyFile.pathname)
  : { createDevApiProxy: () => (_req, _res, next) => next() }
let upstream, proxy, port, received, loopbackUnavailable
const listen = server => new Promise((resolve, reject) => {
  const onError = error => {
    server.off('listening', onListening)
    reject(error)
  }
  const onListening = () => {
    server.off('error', onError)
    resolve()
  }
  server.once('error', onError)
  server.once('listening', onListening)
  server.listen(0, '127.0.0.1')
})
const close = server => new Promise((resolve, reject) => {
  if (!server?.listening) return resolve()
  server.close(error => error ? reject(error) : resolve())
})
test.before(async () => {
  upstream = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    received = { url: req.url, method: req.method, headers: req.headers, body }
    res.writeHead(302, { Location: 'https://accounts.google.com/test', 'Set-Cookie': ['state=signed; HttpOnly; SameSite=Lax; Path=/', 'session=signed; HttpOnly; SameSite=Lax; Path=/'] })
    res.end('redirect')
  })
  try {
    await listen(upstream)
    const middleware = createDevApiProxy(`http://127.0.0.1:${upstream.address().port}`)
    proxy = createServer((req, res) => middleware(req, res, () => { res.writeHead(404); res.end('metro') }))
    await listen(proxy)
    port = proxy.address().port
  } catch (error) {
    await Promise.all([upstream, proxy].map(close))
    if (['EACCES', 'EPERM'].includes(error?.code)) {
      loopbackUnavailable = `Loopback HTTP is unavailable in this environment (${error.code}).`
      return
    }
    throw error
  }
})
test.after(() => Promise.all([upstream, proxy].map(close)))

function call(path, host, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method: 'POST', headers: { Host: host, 'Content-Type': 'application/json', ...headers } }, res => {
      res.resume()
      res.on('end', () => resolve(res))
    })
    req.on('error', reject)
    req.end('{"provider":"google"}')
  })
}

test('forwards API bodies, cookies and redirects without following provider URLs', async context => {
  if (loopbackUnavailable) return context.skip(loopbackUnavailable)
  const response = await call('/api/auth/sign-in/social?test=1', 'localhost:8081', { Origin: 'http://localhost:8081', Cookie: 'session=signed', 'x-fave-web-origin': 'https://unapproved.example' })
  assert.equal(response.statusCode, 302)
  assert.equal(response.headers.location, 'https://accounts.google.com/test')
  assert.equal(response.headers['set-cookie'].length, 2)
  assert.equal(received.url, '/api/auth/sign-in/social?test=1')
  assert.equal(received.method, 'POST')
  assert.equal(received.body, '{"provider":"google"}')
  assert.equal(received.headers.cookie, 'session=signed')
  assert.equal(received.headers['x-fave-web-origin'], 'http://localhost:8081')
})

test('does not expose local web authentication through LAN hosts or unrelated origins', async context => {
  if (loopbackUnavailable) return context.skip(loopbackUnavailable)
  assert.equal((await call('/api/auth/sign-in/social', '192.168.1.65:8081')).statusCode, 403)
  assert.equal((await call('/api/auth/sign-in/social', 'localhost:8081', { Origin: 'https://unapproved.example' })).statusCode, 403)
})

test('lets Metro handle non-API paths', async context => {
  if (loopbackUnavailable) return context.skip(loopbackUnavailable)
  assert.equal((await call('/index.bundle', 'localhost:8081')).statusCode, 404)
})
