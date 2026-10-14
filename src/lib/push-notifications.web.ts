import type { PushRegistrationResult } from './push-notifications'

export async function enablePushNotifications(): Promise<PushRegistrationResult> {
  return 'unsupported'
}

export async function syncPushTokenForSignedInUser(): Promise<PushRegistrationResult> {
  return 'unsupported'
}

export async function getPushPermissionStatus(): Promise<string> {
  return 'unsupported'
}

export async function unregisterPushNotifications(): Promise<void> {}

export async function disablePushNotifications(): Promise<void> {}

export function subscribeToPushTokenChanges(): { remove: () => void } {
  return { remove: () => undefined }
}
