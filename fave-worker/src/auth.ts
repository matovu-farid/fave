import { expo } from '@better-auth/expo'
import { betterAuth } from 'better-auth'
import { importPKCS8, SignJWT } from 'jose'

export type AuthBindings = Omit<CloudflareBindings, 'BETTER_AUTH_URL' | 'ENVIRONMENT'> & {
  BETTER_AUTH_SECRET?: string
  BETTER_AUTH_URL?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  APPLE_SERVICE_ID?: string
  APPLE_TEAM_ID?: string
  APPLE_KEY_ID?: string
  APPLE_PRIVATE_KEY?: string
  GOOGLE_MAPS_API_KEY?: string
  ENVIRONMENT?: string
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

export function createAuth(env: AuthBindings) {
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

  return betterAuth({
    appName: 'Fave',
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    plugins: [expo()],
    socialProviders,
    trustedOrigins: [
      'fave://',
      'fave://*',
      'https://appleid.apple.com',
      ...(env.ENVIRONMENT === 'development' ? ['exp://**'] : []),
    ],
  })
}
