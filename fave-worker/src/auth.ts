import { createReviewAuth } from './review-auth'
import { expo } from '@better-auth/expo'
import { betterAuth } from 'better-auth'
import { oAuthProxy } from 'better-auth/plugins/oauth-proxy'
import { importPKCS8, SignJWT } from 'jose'

export type AuthBindings = Omit<CloudflareBindings, 'BETTER_AUTH_URL' | 'ENVIRONMENT'> & {
  ASSETS?: Fetcher
  BETTER_AUTH_SECRET?: string
  BETTER_AUTH_URL?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  APPLE_SERVICE_ID?: string
  APPLE_TEAM_ID?: string
  APPLE_KEY_ID?: string
  APPLE_PRIVATE_KEY?: string
  GOOGLE_MAPS_API_KEY?: string
  WEB_APP_ORIGINS?: string
  DRIVER_ID_ENCRYPTION_KEY?: string
  DRIVER_FILES?: R2Bucket
  ENVIRONMENT?: string
}

export function getWebAppOrigins(env: AuthBindings): string[] {
  const configured = (env.WEB_APP_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

  if (env.ENVIRONMENT === 'development') {
    configured.push('http://localhost:8081', 'http://127.0.0.1:8081')
  }

  return [...new Set(configured)]
}

async function createAppleClientSecret(env: AuthBindings) {
  const serviceId = env.APPLE_SERVICE_ID
  const teamId = env.APPLE_TEAM_ID
  const keyId = env.APPLE_KEY_ID
  const privateKey = env.APPLE_PRIVATE_KEY?.replace(/\\n/g, '\n')

  if (!serviceId || !teamId || !keyId || !privateKey) {
    throw new Error('Apple Sign in with Apple credentials are not configured')
  }

  const key = await importPKCS8(privateKey, 'ES256')
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: keyId })
    .setIssuer(teamId)
    .setSubject(serviceId)
    .setAudience('https://appleid.apple.com')
    .setIssuedAt()
    .setExpirationTime('180d')
    .sign(key)
}

export function createAuth(env: AuthBindings, headers?: Headers) {
  // Only the two explicitly enabled loopback origins may receive local cookies.
  const forwardedOrigin = headers?.get('x-fave-web-origin')
  const localOrigin = forwardedOrigin
    && ['http://localhost:8081', 'http://127.0.0.1:8081'].includes(forwardedOrigin)
    && getWebAppOrigins(env).includes(forwardedOrigin)
    ? forwardedOrigin
    : undefined
  const socialProviders = {
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            prompt: 'select_account' as const,
          },
        }
      : {}),
    ...(env.APPLE_SERVICE_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY
      ? {
          apple: async () => ({
            clientId: env.APPLE_SERVICE_ID!,
            clientSecret: await createAppleClientSecret(env),
          }),
        }
      : {}),
  }

  const review = createReviewAuth(env, localOrigin ?? env.BETTER_AUTH_URL ?? 'https://api.fave.fidexa.org')
  return betterAuth({
    appName: 'Fave',
    baseURL: localOrigin ?? env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    plugins: [...review.plugins, expo(), oAuthProxy({
      productionURL: env.BETTER_AUTH_URL,
      currentURL: localOrigin ?? env.BETTER_AUTH_URL,
    })],
    ...(localOrigin ? { advanced: { useSecureCookies: false } } : {}),
    hooks: review.hooks,
    socialProviders,
    trustedOrigins: [
      'fave://',
      'fave://*',
      'https://appleid.apple.com',
      ...getWebAppOrigins(env),
      ...(env.ENVIRONMENT === 'development' ? ['exp://**'] : []),
    ],
  })
}
