import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const adminScreenPath = fileURLToPath(new URL('../src/components/admin-notification-health.tsx', import.meta.url))
const marketplacePath = fileURLToPath(new URL('../src/lib/marketplace.ts', import.meta.url))
const adminRoutePath = fileURLToPath(new URL('../src/app/(tabs)/admin/index.tsx', import.meta.url))

test('admin notification health shows safe delivery status and supports audited retries', () => {
  const screen = readFileSync(adminScreenPath, 'utf8')
  const marketplace = readFileSync(marketplacePath, 'utf8')
  const adminRoute = readFileSync(adminRoutePath, 'utf8')

  assert.match(marketplace, /export type AdminNotificationHealth\s*=/u)
  assert.match(marketplace, /getAdminNotificationHealth\(\)/u)
  assert.match(marketplace, /retryAdminNotificationDelivery\(deliveryId: string\)/u)
  assert.match(screen, /Notification delivery health/u)
  assert.match(screen, /oldestPendingAgeMs/u)
  assert.match(screen, /attemptCount/u)
  assert.match(screen, /errorCategory/u)
  assert.match(screen, /retryAdminNotificationDelivery\(deliveryId\)/u)
  assert.match(screen, /retry\(failure\.deliveryId\)/u)
  assert.match(adminRoute, /<AdminNotificationHealth/u)
  assert.doesNotMatch(screen, /recipientUserId|pushToken|notificationBody|nationalId/u)
})
