import {
  Tabs,
  TabList,
  TabTrigger,
  TabSlot,
  TabTriggerSlotProps,
  TabListProps,
} from 'expo-router/ui';
import type { Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View, StyleSheet } from 'react-native';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

import { MaxContentWidth, Spacing } from '@/constants/theme';
import { authClient } from '@/lib/auth-client';
import { getAdminAccess } from '@/lib/marketplace';
import { subscribeToPushTokenChanges, syncPushTokenForSignedInUser } from '../lib/push-notifications';

export default function AppTabs() {
  const { data: session } = authClient.useSession();
  const [adminAccessUserId, setAdminAccessUserId] = useState('');

  useEffect(() => {
    let active = true;
    if (session?.user.id) {
      getAdminAccess().then(() => {
        if (active) setAdminAccessUserId(session.user.id);
      }).catch(() => undefined);
    }
    return () => { active = false; };
  }, [session?.user.id]);

  useEffect(() => {
    if (!session?.user.id) return;
    void syncPushTokenForSignedInUser().catch(() => undefined);
    const subscription = subscribeToPushTokenChanges();
    return () => subscription.remove();
  }, [session?.user.id]);

  return (
    <Tabs style={styles.tabs}>
      <TabList asChild>
        <CustomTabList>
          <TabTrigger name="home" href="/" asChild>
            <TabButton>Home</TabButton>
          </TabTrigger>
          <TabTrigger name="explore" href="/explore" asChild>
            <TabButton>Explore</TabButton>
          </TabTrigger>
          <TabTrigger name="driver" href={'/driver' as Href} asChild>
            <TabButton>Driver</TabButton>
          </TabTrigger>
          <TabTrigger name="trips" href={'/trips' as Href} asChild>
            <TabButton>Trips</TabButton>
          </TabTrigger>
          <TabTrigger name="notifications" href={'/notifications' as Href} asChild>
            <TabButton>Alerts</TabButton>
          </TabTrigger>
          {session?.user.id && adminAccessUserId === session.user.id ? (
            <TabTrigger name="admin" href={'/admin' as Href} asChild>
              <TabButton>Operations</TabButton>
            </TabTrigger>
          ) : null}
        </CustomTabList>
      </TabList>
      <TabSlot style={styles.tabSlot} />
    </Tabs>
  );
}

export function TabButton({ children, isFocused, ...props }: TabTriggerSlotProps) {
  return (
    <Pressable {...props} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView
        type={isFocused ? 'backgroundSelected' : 'backgroundElement'}
        style={styles.tabButtonView}>
        <ThemedText type="small" themeColor={isFocused ? 'text' : 'textSecondary'}>
          {children}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

export function CustomTabList(props: TabListProps) {
  return (
    <View {...props} style={styles.tabListContainer}>
      <ThemedView type="backgroundElement" style={styles.innerContainer}>
        <ThemedText type="smallBold" style={styles.brandText}>
          Fave
        </ThemedText>

        {props.children}

      </ThemedView>
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flex: 1,
    minHeight: 0,
  },
  tabSlot: {
    flex: 1,
    minHeight: 0,
  },
  tabListContainer: {
    width: '100%',
    padding: Spacing.three,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  innerContainer: {
    width: '100%',
    minWidth: 0,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.five,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    flexGrow: 1,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
  },
  brandText: {
    marginRight: 'auto',
  },
  pressed: {
    opacity: 0.7,
  },
  tabButtonView: {
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
});
