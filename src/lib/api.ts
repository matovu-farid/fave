import { authClient } from '@/lib/auth-client'
import { Platform } from 'react-native'

export class ApiError extends Error {
  constructor(message: string, readonly code: string | undefined, readonly status: number) {
    super(message)
    this.name = 'ApiError'
  }
}

export const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL

if (!apiBaseUrl) {
  throw new Error('EXPO_PUBLIC_API_URL must point to the Fave API Worker')
}

export async function authenticatedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const cookie = await authClient.getCookie()
  const headers = new Headers(init?.headers)

  if (cookie && Platform.OS !== 'web') headers.set('Cookie', cookie)

  const response = await fetch(new URL(path, apiBaseUrl), {
    ...init,
    headers,
    credentials: Platform.OS === 'web' ? 'include' : 'omit',
  })

  const payload = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null
  if (!response.ok) {
    throw new ApiError(
      payload?.error?.message ?? `Request failed with status ${response.status}`,
      payload?.error?.code,
      response.status,
    )
  }

  return payload as T
}

export async function authenticatedUpload<T>(path: string, form: FormData): Promise<T> {
  return authenticatedFetch<T>(path, { method: 'POST', body: form })
}
