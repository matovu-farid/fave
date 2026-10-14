import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

import { authenticatedFetch } from '@/lib/api'

const pushTokenKey = 'fave.push-token'
const pushEnabledKey = 'fave.push-enabled'
const androidChannelId = 'fave-booking-updates'
const permissionDenied = 'permission_denied' as const
const unsupported = 'unsupported' as const

export type PushRegistrationResult = 'enabled' | typeof permissionDenied | typeof unsupported | 'disabled'

async function registerToken(requestPermission: boolean): Promise<PushRegistrationResult> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return unsupported
  if (!requestPermission && await SecureStore.getItemAsync(pushEnabledKey) === 'false') return 'disabled'

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(androidChannelId, {
      name: 'Booking and trip updates',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#208AEF',
    })
  }

  const existing = await Notifications.getPermissionsAsync()
  let permissionStatus = existing.status
  if (permissionStatus !== 'granted' && requestPermission) {
    permissionStatus = (await Notifications.requestPermissionsAsync()).status
  }
  if (permissionStatus !== 'granted') return permissionDenied

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
  if (!projectId) throw new Error('Push notifications are not configured for this app build.')

  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data
  await SecureStore.setItemAsync(pushTokenKey, token)
  await authenticatedFetch('/api/notifications/push-tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, platform: Platform.OS }),
  })

  return 'enabled'
}

export async function enablePushNotifications(): Promise<PushRegistrationResult> {
  const result = await registerToken(true)
  await SecureStore.setItemAsync(pushEnabledKey, result === 'enabled' ? 'true' : 'false')
  return result
}

export async function syncPushTokenForSignedInUser(): Promise<PushRegistrationResult> {
  return registerToken(false)
}

export async function getPushPermissionStatus(): Promise<string> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return unsupported
  return (await Notifications.getPermissionsAsync()).status
}

export async function unregisterPushNotifications(): Promise<void> {
  const token = await SecureStore.getItemAsync(pushTokenKey)
  if (!token) return

  await authenticatedFetch('/api/notifications/push-tokens', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  await SecureStore.deleteItemAsync(pushTokenKey)
}

export async function disablePushNotifications(): Promise<void> {
  await unregisterPushNotifications()
  await SecureStore.setItemAsync(pushEnabledKey, 'false')
}

export function subscribeToPushTokenChanges(): { remove: () => void } {
  return Notifications.addPushTokenListener(() => {
    void syncPushTokenForSignedInUser().catch(() => undefined)
  })
}

export function subscribeToNotificationResponses(onOpenInbox: (notificationId: string) => void): { remove: () => void } {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return { remove: () => undefined }
  const handleResponse = (response: Notifications.NotificationResponse) => {
    const notificationId = response.notification.request.content.data?.notificationId
    if (typeof notificationId !== 'string' || notificationId.length < 1 || notificationId.length > 128) return
    Notifications.clearLastNotificationResponse()
    onOpenInbox(notificationId)
  }

  const lastResponse = Notifications.getLastNotificationResponse()
  if (lastResponse) handleResponse(lastResponse)
  return Notifications.addNotificationResponseReceivedListener(handleResponse)
}
