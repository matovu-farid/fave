import { useEffect } from 'react'
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, router } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { useColorScheme } from 'react-native'

import { AnimatedSplashOverlay } from '@/components/animated-icon'
import { AuthGate } from '@/components/auth-gate'
import { subscribeToNotificationResponses } from '@/lib/push-notifications'

SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  const colorScheme = useColorScheme()
  useEffect(() => subscribeToNotificationResponses((notificationId) => {
    router.push({ pathname: '/notifications', params: { notificationId } })
  }).remove, [])

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <AuthGate>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="account" />
        </Stack>
      </AuthGate>
    </ThemeProvider>
  )
}
