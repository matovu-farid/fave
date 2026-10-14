import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';
import { authClient } from '@/lib/auth-client';
import { getAdminAccess } from '@/lib/marketplace';
import { subscribeToPushTokenChanges, syncPushTokenForSignedInUser } from '../lib/push-notifications';

export default function AppTabs() {
  const scheme = useColorScheme();
  const { data: session } = authClient.useSession();
  const [adminAccessUserId, setAdminAccessUserId] = useState('');
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];

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
    <NativeTabs
      backgroundColor={colors.background}
      indicatorColor={colors.backgroundElement}
      labelStyle={{ selected: { color: colors.text } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/home.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="explore">
        <NativeTabs.Trigger.Label>Explore</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/explore.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="driver">
        <NativeTabs.Trigger.Label>Driver</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/home.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="trips">
        <NativeTabs.Trigger.Label>Trips</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/explore.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="notifications">
        <NativeTabs.Trigger.Label>Alerts</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/explore.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      {session?.user.id && adminAccessUserId === session.user.id ? <NativeTabs.Trigger name="admin">
        <NativeTabs.Trigger.Label>Operations</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/home.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger> : null}
    </NativeTabs>
  );
}
