import { useEffect } from 'react';
import { DarkTheme, DefaultTheme, ThemeProvider, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { AuthGate } from '@/components/auth-gate';
import { subscribeToNotificationResponses } from '@/lib/push-notifications';

SplashScreen.preventAutoHideAsync();

export default function TabLayout() {
  const colorScheme = useColorScheme();
  useEffect(() => subscribeToNotificationResponses((notificationId) => {
    router.push({ pathname: '/notifications', params: { notificationId } });
  }).remove, []);
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <AuthGate>
        <AppTabs />
      </AuthGate>
    </ThemeProvider>
  );
}
