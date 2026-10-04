import { router, type Href } from 'expo-router';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionButton, Card, SectionTitle } from '@/components/marketplace-ui';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { authClient } from '@/lib/auth-client';

export default function HomeScreen() {
  const { data: session } = authClient.useSession();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.content}>
          <ThemedText type="smallBold" style={styles.eyebrow}>FAVE · UGANDA</ThemedText>
          <ThemedText type="title" style={styles.title}>Your trip, handled.</ThemedText>
          <ThemedText themeColor="textSecondary">Book a verified vehicle for journeys around Kampala and across Uganda.</ThemedText>
          <Card>
            <SectionTitle title={`Welcome${session?.user.name ? `, ${session.user.name}` : ''}`} detail={session?.user.email ?? 'Signed in'} />
            <ActionButton title="Plan a trip" onPress={() => router.push('/trips' as Href)} />
            <ActionButton title="Apply to drive" onPress={() => router.push('/driver' as Href)} />
            <ThemedText accessibilityRole="link" onPress={() => void authClient.signOut()} style={styles.signOut}>Sign out</ThemedText>
          </Card>
          <ThemedText type="small" themeColor="textSecondary">Trips use verified vehicles and clear, itemized quotes before a request is placed.</ThemedText>
        </ThemedView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row' },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    paddingBottom: BottomTabInset + Spacing.three,
    maxWidth: MaxContentWidth,
  },
  content: { width: '100%', flex: 1, justifyContent: 'center', gap: Spacing.three },
  eyebrow: { letterSpacing: 2 },
  title: { fontSize: 38, lineHeight: 44 },
  signOut: { color: '#b42318', fontWeight: '600', paddingVertical: Spacing.two },
});
