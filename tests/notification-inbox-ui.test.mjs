import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getNotificationDestination } from '../src/lib/notification-destination.ts'

const screen = readFileSync(fileURLToPath(new URL('../src/app/(tabs)/notifications.tsx', import.meta.url)), 'utf8')
const marketplace = readFileSync(fileURLToPath(new URL('../src/lib/marketplace.ts', import.meta.url)), 'utf8')
const api = readFileSync(fileURLToPath(new URL('../fave-worker/src/notifications.ts', import.meta.url)), 'utf8')
const push = readFileSync(fileURLToPath(new URL('../src/lib/push-notifications.ts', import.meta.url)), 'utf8')
const pushWeb = readFileSync(fileURLToPath(new URL('../src/lib/push-notifications.web.ts', import.meta.url)), 'utf8')
const layout = readFileSync(fileURLToPath(new URL('../src/app/_layout.tsx', import.meta.url)), 'utf8')
const destination = readFileSync(fileURLToPath(new URL('../src/lib/notification-destination.ts', import.meta.url)), 'utf8')

test('Notifications screen loads, paginates, and renders a private inbox with empty and retry states', () => {
  assert.match(screen, /getNotificationInbox\(\)/u)
  assert.match(screen, /getNotificationInbox\(inboxNextCursor\)/u)
  assert.match(screen, /Your inbox/u)
  assert.match(screen, /You’re all caught up/u)
  assert.match(screen, /Your inbox is temporarily unavailable/u)
  assert.match(screen, /Try again/u)
  assert.match(screen, /Load older notifications/u)
  assert.match(screen, /accessibilityRole="button"/u)
})

test('Notifications screen reads items on open and marks the whole inbox read', () => {
  assert.match(screen, /markNotificationRead\(item\.id\)/u)
  assert.match(screen, /markAllNotificationsRead\(\)/u)
  assert.match(screen, /Mark all read/u)
  assert.match(screen, /router\.push\(getNotificationDestination\(item\)\)/u)
})

test('existing per-device push permission and opt-out controls remain on the same screen', () => {
  assert.match(screen, /enablePushNotifications\(\)/u)
  assert.match(screen, /disablePushNotifications\(\)/u)
  assert.match(screen, /Open device settings/u)
  assert.match(screen, /Push alerts are off for this device/u)
})

test('client inbox helpers expose only safe notification fields and recipient-scoped routes', () => {
  assert.match(marketplace, /export type NotificationInboxItem/u)
  assert.match(marketplace, /routeKey: 'trips'/u)
  assert.match(marketplace, /getNotificationInbox/u)
  assert.match(marketplace, /markNotificationRead/u)
  assert.match(marketplace, /markAllNotificationsRead/u)
  assert.doesNotMatch(marketplace, /expoTicket|pushToken|recipientUserId/u)
})

test('inbox items retain an authenticated opaque target id for the related request', () => {
  assert.match(api, /targetId: item\.domainId/u)
  assert.match(marketplace, /targetId: string/u)
  assert.match(destination, /targetId/u)
})

test('inbox refreshes on focus and app resume without hiding loaded notifications on action errors', () => {
  assert.match(screen, /useFocusEffect/u)
  assert.match(screen, /AppState\.addEventListener/u)
  assert.match(screen, /inbox\.map\(item/u)
  assert.match(screen, /title="Refresh inbox"/u)
})

test('push notification taps open the signed-in inbox for warm and cold app starts', () => {
  assert.match(push, /addNotificationResponseReceivedListener/u)
  assert.match(push, /getLastNotificationResponse/u)
  assert.match(pushWeb, /subscribeToNotificationResponses/u)
  assert.match(layout, /subscribeToNotificationResponses/u)
  assert.match(layout, /router\.push/u)
})

test('notification navigation focuses only supported booking and trip-offer targets', () => {
  assert.deepEqual(getNotificationDestination({ routeKey: 'driver_offers', targetId: 'offer-1' }), {
    pathname: '/driver', params: { focusTargetId: 'offer-1', focusTargetType: 'offer' },
  })
  assert.deepEqual(getNotificationDestination({ routeKey: 'trips', targetId: 'offer-2' }), {
    pathname: '/trips', params: { focusTargetId: 'offer-2', focusTargetType: 'offer' },
  })
  assert.deepEqual(getNotificationDestination({ routeKey: 'booking', targetId: 'booking-1' }), {
    pathname: '/trips', params: { focusTargetId: 'booking-1', focusTargetType: 'booking' },
  })
  for (const routeKey of ['trip', 'payments', 'safety', 'support']) {
    assert.deepEqual(getNotificationDestination({ routeKey, targetId: 'domain-1' }), { pathname: '/trips' })
  }
})
