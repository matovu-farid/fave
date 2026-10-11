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
let upstream, proxy, port, received
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
test.before(async () => {
  upstream = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    received = { url: req.url, method: req.method, headers: req.headers, body }
    res.writeHead(302, { Location: 'https://accounts.google.com/test', 'Set-Cookie': ['state=signed; HttpOnly; SameSite=Lax; Path=/', 'session=signed; HttpOnly; SameSite=Lax; Path=/'] })
    res.end('redirect')
  })
  await listen(upstream)
  const middleware = createDevApiProxy(`http://127.0.0.1:${upstream.address().port}`)
  proxy = createServer((req, res) => middleware(req, res, () => { res.writeHead(404); res.end('metro') }))
  await listen(proxy)
  port = proxy.address().port
})
test.after(() => Promise.all([upstream, proxy].map(server => new Promise(resolve => server.close(resolve)))))

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

test('forwards API bodies, cookies and redirects without following provider URLs', async () => {
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

test('does not expose local web authentication through LAN hosts or unrelated origins', async () => {
  assert.equal((await call('/api/auth/sign-in/social', '192.168.1.65:8081')).statusCode, 403)
  assert.equal((await call('/api/auth/sign-in/social', 'localhost:8081', { Origin: 'https://unapproved.example' })).statusCode, 403)
})

test('lets Metro handle non-API paths', async () => {
  assert.equal((await call('/index.bundle', 'localhost:8081')).statusCode, 404)
})
