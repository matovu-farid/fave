import { authClient } from '@/lib/auth-client'

const apiUrl = process.env.EXPO_PUBLIC_API_URL

if (!apiUrl) {
  throw new Error('EXPO_PUBLIC_API_URL must point to the Fave API Worker')
}

export async function authenticatedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const cookie = await authClient.getCookie()
  const headers = new Headers(init?.headers)

  if (cookie) headers.set('Cookie', cookie)

  const response = await fetch(new URL(path, apiUrl), {
    ...init,
    headers,
    credentials: 'omit',
  })

  if (!response.ok) {
    throw new Error(`Authenticated request failed with status ${response.status}`)
  }

  return (await response.json()) as T
}
