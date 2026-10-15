import type { Href } from 'expo-router'

import type { NotificationInboxItem } from '@/lib/marketplace'

type NotificationTarget = Pick<NotificationInboxItem, 'routeKey' | 'targetId'>

export function getNotificationDestination({ routeKey, targetId }: NotificationTarget): Href {
  switch (routeKey) {
    case 'driver_offers':
      return { pathname: '/driver', params: { focusTargetId: targetId, focusTargetType: 'offer' } }
    case 'trips':
      return { pathname: '/trips', params: { focusTargetId: targetId, focusTargetType: 'offer' } }
    case 'booking':
      return { pathname: '/trips', params: { focusTargetId: targetId, focusTargetType: 'booking' } }
    default:
      return { pathname: '/trips' }
  }
}
