import { expoClient } from '@better-auth/expo/client'
import { createAuthClient } from 'better-auth/react'
import * as SecureStore from 'expo-secure-store'

const apiUrl = process.env.EXPO_PUBLIC_API_URL

if (!apiUrl) {
  throw new Error('EXPO_PUBLIC_API_URL must point to the Fave API Worker')
}

export const authClient = createAuthClient({
  baseURL: apiUrl,
  plugins: [
    expoClient({
      scheme: 'fave',
      storagePrefix: 'fave',
      storage: SecureStore,
    }),
  ],
})
