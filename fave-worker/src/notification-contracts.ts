export type NotificationRole = 'client' | 'driver' | 'operations'
export type NotificationPriority = 'ordinary' | 'urgent' | 'time_sensitive'
export type NotificationDomainType = 'trip_offer' | 'availability_request' | 'booking' | 'trip' | 'payment' | 'incident' | 'support'

export const notificationEventContracts = {
  'booking.availability_confirmed': {
    eventVersion: 1, domainType: 'availability_request', allowedRecipientRoles: ['client'],
    templateKey: 'availability_confirmed', routeKey: 'availability', priority: 'time_sensitive', expiryPolicy: 'domain',
  },
  'booking.availability_unavailable': {
    eventVersion: 1, domainType: 'availability_request', allowedRecipientRoles: ['client'],
    templateKey: 'availability_unavailable', routeKey: 'availability', priority: 'ordinary', expiryPolicy: 'none',
  },
  'booking.availability_expired': {
    eventVersion: 1, domainType: 'availability_request', allowedRecipientRoles: ['client'],
    templateKey: 'availability_expired', routeKey: 'availability', priority: 'ordinary', expiryPolicy: 'none',
  },
  'booking.quote_requested': {
    eventVersion: 1,
    domainType: 'trip_offer',
    allowedRecipientRoles: ['client'],
    templateKey: 'quote_requested',
    routeKey: 'trips',
    priority: 'ordinary',
    expiryPolicy: 'domain',
  },
  'booking.driver_offer_created': {
    eventVersion: 1,
    domainType: 'trip_offer',
    allowedRecipientRoles: ['driver'],
    templateKey: 'driver_offer_received',
    routeKey: 'driver_offers',
    priority: 'time_sensitive',
    expiryPolicy: 'domain',
  },
  'booking.driver_offer_accepted': {
    eventVersion: 1,
    domainType: 'trip_offer',
    allowedRecipientRoles: ['client'],
    templateKey: 'driver_offer_accepted',
    routeKey: 'trips',
    priority: 'ordinary',
    expiryPolicy: 'none',
  },
  'booking.driver_offer_declined': {
    eventVersion: 1,
    domainType: 'trip_offer',
    allowedRecipientRoles: ['client'],
    templateKey: 'driver_offer_declined',
    routeKey: 'trips',
    priority: 'ordinary',
    expiryPolicy: 'none',
  },
  'booking.driver_offer_expired': {
    eventVersion: 1,
    domainType: 'trip_offer',
    allowedRecipientRoles: ['client'],
    templateKey: 'driver_offer_expired',
    routeKey: 'trips',
    priority: 'ordinary',
    expiryPolicy: 'none',
  },
  'booking.hold_created': {
    eventVersion: 1,
    domainType: 'booking',
    allowedRecipientRoles: ['client'],
    templateKey: 'booking_hold_created',
    routeKey: 'booking',
    priority: 'ordinary',
    expiryPolicy: 'domain',
  },
  'booking.withdrawn': {
    eventVersion: 1,
    domainType: 'trip_offer',
    allowedRecipientRoles: ['client', 'driver'],
    templateKey: 'booking_withdrawn',
    routeKey: 'trips',
    priority: 'ordinary',
    expiryPolicy: 'none',
  },
  'booking.quote_status_changed': {
    eventVersion: 1,
    domainType: 'trip_offer',
    allowedRecipientRoles: ['client'],
    templateKey: 'quote_status_changed',
    routeKey: 'trips',
    priority: 'ordinary',
    expiryPolicy: 'domain',
  },
  'booking.deposit_status_changed': {
    eventVersion: 1,
    domainType: 'booking',
    allowedRecipientRoles: ['client', 'operations'],
    templateKey: 'deposit_status_changed',
    routeKey: 'booking',
    priority: 'urgent',
    expiryPolicy: 'none',
  },
  'booking.cancelled': {
    eventVersion: 1,
    domainType: 'booking',
    allowedRecipientRoles: ['client', 'driver', 'operations'],
    templateKey: 'booking_cancelled',
    routeKey: 'booking',
    priority: 'ordinary',
    expiryPolicy: 'none',
  },
  'booking.expired': {
    eventVersion: 1,
    domainType: 'booking',
    allowedRecipientRoles: ['client'],
    templateKey: 'booking_expired',
    routeKey: 'booking',
    priority: 'ordinary',
    expiryPolicy: 'none',
  },
  'driver.assignment_changed': {
    eventVersion: 1,
    domainType: 'booking',
    allowedRecipientRoles: ['client', 'driver', 'operations'],
    templateKey: 'driver_assignment_changed',
    routeKey: 'booking',
    priority: 'ordinary',
    expiryPolicy: 'none',
  },
  'driver.assignment_reassigned': {
    eventVersion: 1,
    domainType: 'booking',
    allowedRecipientRoles: ['client', 'driver', 'operations'],
    templateKey: 'driver_assignment_changed',
    routeKey: 'booking',
    priority: 'ordinary',
    expiryPolicy: 'none',
  },
  'trip.progress_changed': {
    eventVersion: 1,
    domainType: 'trip',
    allowedRecipientRoles: ['client', 'driver'],
    templateKey: 'trip_progress_changed',
    routeKey: 'trip',
    priority: 'ordinary',
    expiryPolicy: 'none',
  },
  'trip.check_in_required': {
    eventVersion: 1,
    domainType: 'trip',
    allowedRecipientRoles: ['client', 'driver', 'operations'],
    templateKey: 'trip_check_in_required',
    routeKey: 'trip',
    priority: 'urgent',
    expiryPolicy: 'domain',
  },
  'payment.balance_due': {
    eventVersion: 1,
    domainType: 'payment',
    allowedRecipientRoles: ['client', 'operations'],
    templateKey: 'balance_due',
    routeKey: 'payments',
    priority: 'urgent',
    expiryPolicy: 'none',
  },
  'payment.balance_paid': {
    eventVersion: 1,
    domainType: 'payment',
    allowedRecipientRoles: ['client', 'operations'],
    templateKey: 'balance_paid',
    routeKey: 'payments',
    priority: 'urgent',
    expiryPolicy: 'none',
  },
  'safety.incident_updated': {
    eventVersion: 1,
    domainType: 'incident',
    allowedRecipientRoles: ['client', 'driver', 'operations'],
    templateKey: 'safety_incident_updated',
    routeKey: 'safety',
    priority: 'urgent',
    expiryPolicy: 'none',
  },
  'support.update': {
    eventVersion: 1,
    domainType: 'support',
    allowedRecipientRoles: ['client', 'driver', 'operations'],
    templateKey: 'support_update',
    routeKey: 'support',
    priority: 'ordinary',
    expiryPolicy: 'none',
  },
} as const satisfies Record<string, {
  eventVersion: number
  domainType: NotificationDomainType
  allowedRecipientRoles: readonly NotificationRole[]
  templateKey: string
  routeKey: string
  priority: NotificationPriority
  expiryPolicy: 'domain' | 'none'
}>

export type NotificationEventType = keyof typeof notificationEventContracts
export type NotificationEventContract = (typeof notificationEventContracts)[NotificationEventType]
export type NotificationRecipient = { userId: string; role: NotificationRole }
export type NotificationEventInput = {
  id: string
  eventType: NotificationEventType
  eventVersion: number
  domainType: NotificationDomainType
  domainId: string
  occurredAt: number
  expiresAt?: number | null
  recipients: NotificationRecipient[]
}

const eventInputKeys = new Set([
  'id', 'eventType', 'eventVersion', 'domainType', 'domainId', 'occurredAt', 'expiresAt', 'recipients',
])

export function getNotificationContract(eventType: string): NotificationEventContract | undefined {
  return Object.hasOwn(notificationEventContracts, eventType)
    ? notificationEventContracts[eventType as NotificationEventType]
    : undefined
}

export function validateNotificationEvent(value: unknown): asserts value is NotificationEventInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Notification event must be an object.')
  }
  const input = value as Record<string, unknown>
  for (const key of Object.keys(input)) {
    if (!eventInputKeys.has(key)) throw new TypeError(`Notification event has unexpected field: ${key}.`)
  }

  if (typeof input.eventType !== 'string') throw new TypeError('Unknown notification event.')
  const contract = getNotificationContract(input.eventType)
  if (!contract) throw new TypeError(`Unknown notification event: ${input.eventType}.`)
  if (input.eventVersion !== contract.eventVersion) throw new TypeError('Unsupported notification event version.')
  if (input.domainType !== contract.domainType) throw new TypeError('Notification event does not support domain type.')

  for (const field of ['id', 'domainId'] as const) {
    const fieldValue = input[field]
    if (typeof fieldValue !== 'string' || fieldValue.length < 1 || fieldValue.length > 128 || /[\u0000-\u001f]/u.test(fieldValue)) {
      throw new TypeError(`Notification event has invalid ${field}.`)
    }
  }
  if (!Number.isSafeInteger(input.occurredAt) || Number(input.occurredAt) < 0) {
    throw new TypeError('Notification event has invalid occurrence time.')
  }

  const expiresAt = input.expiresAt
  if (expiresAt !== undefined && expiresAt !== null &&
      (!Number.isSafeInteger(expiresAt) || Number(expiresAt) <= Number(input.occurredAt))) {
    throw new TypeError('Notification event has invalid expiry.')
  }
  if (contract.expiryPolicy === 'domain' && !Number.isSafeInteger(expiresAt)) {
    throw new TypeError('Notification event requires a domain expiry.')
  }

  if (!Array.isArray(input.recipients) || input.recipients.length < 1 || input.recipients.length > 50) {
    throw new TypeError('Notification event requires recipients.')
  }
  const userIds = new Set<string>()
  for (const recipientValue of input.recipients) {
    if (typeof recipientValue !== 'object' || recipientValue === null || Array.isArray(recipientValue)) {
      throw new TypeError('Notification event has an invalid recipient.')
    }
    const recipient = recipientValue as Record<string, unknown>
    if (Object.keys(recipient).some((key) => key !== 'userId' && key !== 'role')) {
      throw new TypeError('Notification recipient has an unexpected field.')
    }
    if (typeof recipient.userId !== 'string' || recipient.userId.length < 1 || recipient.userId.length > 128) {
      throw new TypeError('Notification event has an invalid recipient user ID.')
    }
    if (typeof recipient.role !== 'string' ||
        !(contract.allowedRecipientRoles as readonly NotificationRole[]).includes(recipient.role as NotificationRole)) {
      throw new TypeError('Notification event recipient role is not allowed.')
    }
    if (userIds.has(recipient.userId)) throw new TypeError('Notification event has a duplicate recipient.')
    userIds.add(recipient.userId)
  }
}
