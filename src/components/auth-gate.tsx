import { useState } from 'react'
import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Linking from 'expo-linking'

import { authClient } from '@/lib/auth-client'

const apiUrl = process.env.EXPO_PUBLIC_API_URL

function getApiOrigin() {
  if (!apiUrl) return 'not configured'

  try {
    return new URL(apiUrl).origin
  } catch {
    return 'invalid URL'
  }
}

function getErrorDetails(error: unknown) {
  if (!error || typeof error !== 'object') return {}

  const value = error as Record<string, unknown>
  return {
    code: typeof value.code === 'string' ? value.code : undefined,
    status: typeof value.status === 'number' ? value.status : undefined,
    statusText: typeof value.statusText === 'string' ? value.statusText : undefined,
    message: typeof value.message === 'string' ? value.message : undefined,
  }
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { data: session, isPending } = authClient.useSession()
  const [error, setError] = useState<string | null>(null)
  const [isSigningIn, setIsSigningIn] = useState(false)

  if (isPending) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator accessibilityLabel="Checking your session" />
      </View>
    )
  }

  if (session) return children

  async function signIn(provider: 'google' | 'apple') {
    setError(null)
    setIsSigningIn(true)
    const callbackURL = Linking.createURL('/')

    try {
      const result = await authClient.signIn.social({ provider, callbackURL: '/' })
      if (result.error) {
        const details = getErrorDetails(result.error)
        if (__DEV__) {
          console.error('[auth] Social sign-in rejected', {
            provider,
            callbackURL,
            apiOrigin: getApiOrigin(),
            ...details,
          })
          const status = details.status ? ` (HTTP ${details.status})` : ''
          const code = details.code ? ` ${details.code}` : ''
          const expoGoHint = callbackURL.startsWith('exp://')
            ? '\nExpo Go uses a temporary exp:// callback. Use a development build with the fave:// scheme for the production API.'
            : ''
          setError(`${details.message ?? 'Sign in failed.'}${code}${status}\nCallback: ${callbackURL}${expoGoHint}`)
        } else {
          setError(details.message ?? 'Sign in failed. Please try again.')
        }
      }
    } catch (error) {
      const details = getErrorDetails(error)
      if (__DEV__) {
        console.error('[auth] Could not start social sign-in', {
          provider,
          callbackURL,
          apiOrigin: getApiOrigin(),
          ...details,
        })
        setError(`${details.message ?? 'Could not start sign in.'}\nCallback: ${callbackURL}`)
      } else {
        setError('Could not start sign in. Check your connection and try again.')
      }
    } finally {
      setIsSigningIn(false)
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Welcome to Fave</Text>
        <Text style={styles.subtitle}>Sign in to continue.</Text>
        <Pressable
          accessibilityRole="button"
          disabled={isSigningIn}
          onPress={() => void signIn('google')}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <Text style={styles.buttonText}>
            {isSigningIn ? 'Opening sign in…' : 'Continue with Google'}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={isSigningIn}
          onPress={() => void signIn('apple')}
          style={({ pressed }) => [styles.button, styles.appleButton, pressed && styles.pressed]}
        >
          <Text style={[styles.buttonText, styles.appleButtonText]}>Continue with Apple</Text>
        </Pressable>
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { flex: 1, justifyContent: 'center', padding: 24 },
  content: { width: '100%', maxWidth: 420, alignSelf: 'center', gap: 14 },
  title: { fontSize: 30, fontWeight: '700', textAlign: 'center' },
  subtitle: { color: '#60646c', fontSize: 16, marginBottom: 12, textAlign: 'center' },
  button: { alignItems: 'center', backgroundColor: '#4285f4', borderRadius: 12, padding: 16 },
  buttonText: { color: 'white', fontSize: 16, fontWeight: '600' },
  appleButton: { backgroundColor: '#111' },
  appleButtonText: { color: 'white' },
  pressed: { opacity: 0.75 },
  error: { color: '#b42318', textAlign: 'center' },
})
