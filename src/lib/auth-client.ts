import { expoClient } from '@better-auth/expo/client'
import { createAuthClient } from 'better-auth/react'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

const apiUrl = process.env.EXPO_PUBLIC_API_URL

if (!apiUrl) {
  throw new Error('EXPO_PUBLIC_API_URL must point to the Fave API Worker')
}

// Metro forwards local web API requests to the same Worker. Keeping the browser
// cookie on localhost avoids Safari's third-party-cookie blocking.
export const apiBaseUrl = Platform.OS === 'web' && __DEV__ && typeof window !== 'undefined'
  && ['http://localhost:8081', 'http://127.0.0.1:8081'].includes(window.location.origin)
  ? window.location.origin
  : apiUrl

export const authClient = createAuthClient({
  baseURL: apiBaseUrl,
  plugins: [
    expoClient({
      scheme: 'fave',
      storagePrefix: 'fave',
      storage: SecureStore,
    }),
  ],
})
