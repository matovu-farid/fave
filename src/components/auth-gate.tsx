import { useState } from 'react'
import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { authClient } from '@/lib/auth-client'

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
    try {
      const result = await authClient.signIn.social({ provider, callbackURL: '/' })
      if (result.error) setError(result.error.message ?? 'Sign in failed. Please try again.')
    } catch {
      setError('Could not start sign in. Check your connection and try again.')
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
