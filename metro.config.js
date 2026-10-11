const { getDefaultConfig } = require('expo/metro-config')
const { createDevApiProxy } = require('./scripts/dev-api-proxy.cjs')

const config = getDefaultConfig(__dirname)
const enhanceMiddleware = config.server.enhanceMiddleware
config.server.enhanceMiddleware = (middleware, server) => {
  const metro = enhanceMiddleware ? enhanceMiddleware(middleware, server) : middleware
  const proxy = createDevApiProxy(process.env.EXPO_PUBLIC_API_URL)
  return (req, res, next) => proxy(req, res, () => metro(req, res, next))
}

module.exports = config
