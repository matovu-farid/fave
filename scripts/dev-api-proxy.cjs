const http = require('node:http')
const https = require('node:https')

// Development transport only: all auth and application logic stays in the Worker.
function createDevApiProxy(apiUrl) {
  return (req, res, next) => {
    if (!req.url?.startsWith('/api/')) return next()

    const localOrigin = `http://${req.headers.host}`
    if (!['http://localhost:8081', 'http://127.0.0.1:8081'].includes(localOrigin)
      || (req.headers.origin && req.headers.origin !== localOrigin)) {
      res.writeHead(403)
      return res.end('Local web API requests must come from localhost:8081.')
    }
    if (!apiUrl) {
      res.writeHead(503)
      return res.end('EXPO_PUBLIC_API_URL is not configured.')
    }

    const target = new URL(req.url, apiUrl)
    const headers = { ...req.headers, host: target.host, 'x-fave-web-origin': localOrigin }
    delete headers['x-skip-oauth-proxy']
    delete headers['x-forwarded-host']
    delete headers['x-forwarded-proto']
    delete headers.connection

    const upstream = (target.protocol === 'https:' ? https : http).request(target, {
      method: req.method,
      headers,
    }, response => {
      // Preserve separate Set-Cookie headers and 302s; the browser follows OAuth.
      res.writeHead(response.statusCode, response.headers)
      response.pipe(res)
    })
    upstream.setTimeout(30_000, () => upstream.destroy(new Error('API request timed out')))
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502)
      res.end('The Fave API could not be reached.')
    })
    req.on('aborted', () => upstream.destroy())
    req.pipe(upstream)
  }
}

module.exports = { createDevApiProxy }
