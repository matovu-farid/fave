import { getNotificationContract } from './notification-contracts'

export type NotificationDelivery = {
  deliveryId: string; notificationId: string; recipientUserId: string
  eventType: string; eventVersion: number; domainType: string; targetId: string
  templateKey: string; routeKey: string; priority: string; expiresAt: number | null
  status: string
}

type Database = Pick<D1Database, 'prepare'>

export async function loadNotificationDelivery(db: Database, deliveryId: string) {
  return db.prepare(
    `SELECT outbox.delivery_id AS deliveryId, notification.id AS notificationId,
            outbox.recipient_user_id AS recipientUserId, notification.template_key AS templateKey,
            notification.route_key AS routeKey, notification.priority, outbox.status,
            event.event_type AS eventType, event.event_version AS eventVersion,
            event.domain_type AS domainType, event.domain_id AS targetId, event.expires_at AS expiresAt
       FROM notification_outbox AS outbox
       JOIN notifications AS notification ON notification.id = outbox.notification_id
         AND notification.recipient_user_id = outbox.recipient_user_id
       JOIN notification_events AS event ON event.id = outbox.event_id AND event.id = notification.event_id
      WHERE outbox.delivery_id = ? LIMIT 1`,
  ).bind(deliveryId).first<NotificationDelivery>()
}

// Resolve against the domain record again at delivery/retry time. A role named
// by an event contract is not proof that an arbitrary user holds that role.
export async function isNotificationRecipientEligible(db: Database, delivery: NotificationDelivery): Promise<boolean> {
  const contract = getNotificationContract(delivery.eventType)
  if (!contract || delivery.eventVersion !== contract.eventVersion || delivery.domainType !== contract.domainType
    || delivery.templateKey !== contract.templateKey || delivery.routeKey !== contract.routeKey
    || delivery.priority !== contract.priority) return false

  const client = (contract.allowedRecipientRoles as readonly string[]).includes('client')
  const driver = (contract.allowedRecipientRoles as readonly string[]).includes('driver')
  const operations = (contract.allowedRecipientRoles as readonly string[]).includes('operations')
  const userId = delivery.recipientUserId
  switch (delivery.domainType) {
    case 'availability_request':
      return client && Boolean(await db.prepare(
        'SELECT 1 AS eligible FROM availability_requests WHERE id = ? AND client_user_id = ? LIMIT 1',
      ).bind(delivery.targetId, userId).first())
    case 'trip_offer':
      return Boolean(await db.prepare(
        `SELECT 1 AS eligible FROM driver_trip_offers AS offer
          WHERE offer.id = ? AND ((? = 1 AND offer.client_user_id = ?)
            OR (? = 1 AND EXISTS (SELECT 1 FROM driver_applications AS driver
              WHERE driver.id = offer.driver_application_id AND driver.user_id = ? AND driver.status = 'approved')))
          LIMIT 1`,
      ).bind(delivery.targetId, client ? 1 : 0, userId, driver ? 1 : 0, userId).first())
    case 'booking':
      return Boolean(await db.prepare(
        `SELECT 1 AS eligible FROM bookings AS booking
          WHERE booking.id = ? AND ((? = 1 AND booking.client_user_id = ?)
            OR (? = 1 AND EXISTS (SELECT 1 FROM driver_applications AS driver
              WHERE driver.id = json_extract(CASE WHEN json_valid(booking.quote_snapshot_json)
                THEN booking.quote_snapshot_json ELSE '{}' END, '$.driverApplicationId')
                AND driver.user_id = ? AND driver.status = 'approved'))
            OR (? = 1 AND EXISTS (SELECT 1 FROM admin_memberships WHERE user_id = ? AND active = 1)))
          LIMIT 1`,
      ).bind(delivery.targetId, client ? 1 : 0, userId, driver ? 1 : 0, userId, operations ? 1 : 0, userId).first())
    default:
      // Future trip/payment/incident/support producers must add their own
      // authoritative audience lookup when their domain records are implemented.
      return false
  }
}
