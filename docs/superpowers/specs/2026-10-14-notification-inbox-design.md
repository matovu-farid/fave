# Booking, payment, and safety notifications

## Problem

Fave can register mobile push tokens, but there is no durable in-app notification inbox or shared delivery pipeline. A missed push must not hide a trip or payment change, and transient failures must be recoverable without repeating the underlying business action. Operations also need enough delivery health information to intervene without seeing private notification content.

This design completes the notification foundation tracked by [GitHub issue #22](https://github.com/matovu-farid/fave/issues/22). It extends the existing Expo token registration and Alerts settings work already on `main`.

## Goals

- Keep a durable, authenticated inbox item for each eligible recipient even when push is disabled, denied, delayed, or fails.
- Deliver push notifications through Expo using Cloudflare Queues with a dead-letter queue (DLQ), while making retries safe and visible to operations.
- Define versioned event contracts and recipient rules for the booking, payment, assignment, trip, and safety events listed in issue #22.
- Keep private information out of push previews, queue payloads, logs, and operational views.
- Respect push permission and user preferences; use Kampala quiet hours for ordinary notifications without delaying time-sensitive driver offers.

## Approaches considered

1. **D1 inbox and outbox, Cloudflare Queue + DLQ, Expo Push** — recommended and selected. D1 remains the source of truth, a scheduled dispatcher recovers unsent outbox rows, and Queue consumers handle push delivery and retries. This adds Queue resources and configuration but provides a durable inbox and actionable failed-delivery path.
2. **D1 inbox/outbox with scheduled retries only** — fewer Cloudflare resources, but retry latency and operations behavior depend on polling, and there is no native dead-letter path. Not selected.
3. **Push-only delivery** — smallest first change, but users lose the record when permission is off or a device is unreachable. Does not meet issue #22. Not selected.

Cloudflare Queues provides at-least-once delivery, so consumers must tolerate duplicate and out-of-order messages. A DLQ receives messages after the configured retry limit. The implementation must not describe push delivery as exactly once. See [delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/), [Queue behavior](https://developers.cloudflare.com/queues/reference/how-queues-works/), and [dead-letter queues](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/).

## Design

### Event and inbox model

Each domain event has a stable ID, a versioned event type, an occurrence time, an optional expiry time, a domain reference, and an explicit recipient list resolved by server-side role and ownership checks. Event payloads contain only the fields required to create a notification; presentation text is rendered from versioned server templates rather than arbitrary client input.

Within the same D1 transaction that commits a supported business-state change, the producer records the domain event, one inbox item per eligible recipient, and one outbox entry per push delivery. Unique constraints on `(event_id, recipient_user_id)` and the outbox delivery ID prevent duplicate inbox records and ordinary duplicate enqueue work. Queue messages contain only opaque delivery and dispatch-generation IDs; notification copy, recipient identity, target route, preferences, expiry, and device tokens remain in D1.

The V1 contract catalog covers:

- Quote and deposit status changes.
- Booking cancellation and expiry.
- Driver/car assignment and approved reassignment.
- Trip progress and check-ins.
- Balance due and payment completion.
- Safety and support updates.

Each contract specifies its producer, allowed recipient roles, template version, priority, authorized in-app destination, and expiry behavior. Domain ownership stays with the booking, payment, assignment, trip, and safety modules. Those modules publish through one notification service; notification code does not mutate booking, payment, or safety state. Events needed by future work in issues #11, #12, #13, and #19 use these same contracts rather than introducing another delivery mechanism.

### Durable dispatch and push delivery

The existing hourly Worker schedule is not suitable for timely offers. Add a one-minute scheduled outbox dispatcher. It claims due D1 outbox rows with a lease, enqueues the delivery ID, and marks enqueue state only after Queue accepts the message. If Queue enqueue fails or the Worker exits, the lease expires and a later dispatcher retries. The Queue consumer then reads the authoritative delivery from D1. Configure five Queue retries with a 60-second retry delay and a dedicated DLQ. A scheduled receipt sweep checks Expo tickets at least 15 minutes old.

Before sending, the consumer rechecks the recipient's active device-token registration and event expiry. The app's opt-in is represented by registering a device token; disabling push removes that device's registration. The OS permission itself is held on the device and cannot be queried by the Worker. It sends separately per device so one invalid device cannot block the recipient's other devices. Expo push tickets and later receipts are recorded per device. Status names distinguish `queued`, `expo_accepted`, `receipt_ok`, `device_unregistered`, `retrying`, `failed`, and `dead_lettered`; a successful Expo receipt means the upstream push service accepted it, not that a person saw it.

Temporary Expo/network failures use Queue retry and configured backoff. Permanent token failures, including an Expo `DeviceNotRegistered` receipt, deactivate the token. Configuration/authentication failures are surfaced to operations rather than retried indefinitely. Receipt checks run after Expo's receipt availability window. If the Worker crashes after Expo accepts a push but before D1 stores the ticket, a retry may send a duplicate. Stable notification IDs and D1 deduplication minimize duplicates, but exactly-once display is not promised.

The DLQ is an operational recovery path, not silent storage. A DLQ consumer records the final redacted failure and acknowledges the Queue message so that D1 becomes the durable source for review. Admins can inspect failure reason, attempts, oldest pending age, event category, and affected delivery IDs. An audited retry action requeues the D1 delivery ID on the primary Queue only after rechecking recipient eligibility, current preferences, and expiry. Expired trip offers are marked expired and are never resent, including during manual replay.

### Quiet hours and priority

Inbox records are never suppressed by device push settings or quiet hours. Ordinary non-critical push notifications are sent only to currently registered devices and pause between **21:00 and 08:00 Africa/Kampala**. A scheduled delivery becomes eligible at the next quiet-hours boundary, then rechecks its expiry and device registrations before sending.

Safety incidents and urgent payment-state changes may bypass quiet hours. Driver trip offers with a 15-minute acceptance window are also time-sensitive: they may be pushed during quiet hours so deferral does not make the offer useless. The offer screen identifies the required response time. These pushes still respect the user's Fave preference and device OS permission; if push is unavailable, the durable inbox and operations follow-up remain available. No SMS or WhatsApp path is added; any such channel requires the selection and approval described by issue #15.

### Inbox and user experience

Extend the existing Alerts screen into a combined notification inbox and push-settings screen on web and mobile. The inbox shows newest first, with unread state, a concise safe summary, timestamp, and authorized destination. Users can open a notification, mark one read, and mark all read. The screen includes loading, empty, and retryable error states. Existing push opt-in, token refresh, permission-denial, multi-device, and sign-out cleanup behavior remains intact.

Inbox list/read APIs are scoped by the authenticated user's ID on the server; clients cannot select another recipient. Deep links are internal route identifiers, not arbitrary URLs, and the destination performs its normal authorization check. Push previews use generic wording and never contain national IDs, payment credentials, full addresses, private contact details, or verification codes.

### Operations and privacy

Expose a role-checked delivery-health API for the operations console in issue #17. It returns aggregate status counts, pending age, attempts, failure category, and redacted delivery identifiers. A privileged retry operation records the acting admin, timestamp, reason, and result. It returns no push token, message body, national ID, payment credential, address, phone number, or private contact field. This issue supplies the notification health surface; the broader operations-console workflow remains owned by issue #17.

Logs contain correlation IDs and sanitized error categories only. Queue payloads contain a delivery ID only. The in-app inbox is private to its recipient, and admin delivery-health access is separately authorized and audited.

Notification history has **no automatic deletion or retention cleanup in V1**. This is an explicit temporary product decision; the storage/retention policy remains to be selected before adding cleanup. The implementation must not introduce TTL deletion or a cleanup cron in this work.

### Edge behavior

- **No driver assigned:** Do not create a driver offer event. Keep the client-facing booking state owned by the booking flow; a later assignment emits the assignment event.
- **Offer declined or expires:** Record the driver's response/expiry through the offer domain. Notify the client through the inbox and, subject to priority/preferences, push. Never revive an expired offer through retry or DLQ replay.
- **Payment dispute:** Preserve the payment system's state. Create safe inbox records for authorized client/operations recipients and send only generic previews; dispute details remain behind the authorized screen.
- **Safety incident:** Persist an inbox event for authorized recipients and attempt an urgent push immediately, bypassing quiet hours. Notification failure does not delay or change the safety incident record.
- **Push permission denied or no active device:** Keep the inbox item and delivery status; do not block booking, payment, assignment, or safety flows.
- **Phone verification:** One-time-code phone verification and its provider/abuse controls remain out of V1. Notification delivery does not block driver applications, approvals, bookings, or assignment-time contact release.

## Data and operations lifecycle

The notification data is append-oriented: domain event, recipient inbox item, outbox delivery, per-device Expo ticket/receipt, and audited admin retry. Read state is mutable per recipient. Push-token rows reuse the existing ownership model. The primary Queue and DLQ are configured in Wrangler with five retries and a 60-second retry delay; the one-minute dispatcher claims only due rows, and the receipt sweep processes tickets at least 15 minutes old. Queue creation and DLQ binding are required before enabling production dispatch.

Business requests must succeed or fail independently of push delivery. A failure to persist an inbox/outbox record in the same transaction must roll back the corresponding supported business-state change, so Fave does not report a change that cannot be surfaced. After commit, queue, Expo, and device failures never roll back business state.

## Verification

- Database tests prove atomic event/inbox/outbox persistence, uniqueness, read state, and user isolation.
- Contract tests cover every event type, allowed recipient role, template version, and authorized destination.
- Queue/dispatcher tests cover enqueue failure recovery, lease expiry, duplicate and out-of-order messages, max retries, DLQ routing, manual replay, and expiry checks.
- Expo adapter tests cover per-device sends, ticket/receipt status, transient errors, invalid-token deactivation, preference changes before send, and the crash window after upstream acceptance.
- Quiet-hours tests cover Kampala time-zone boundaries, overnight deferral, safety/payment bypass, and 15-minute offer delivery and expiry during quiet hours.
- Privacy tests verify sensitive fields never appear in push previews, Queue messages, ordinary logs, or admin health responses.
- API/UI tests verify signed-in inbox listing, opening authorized destinations, mark-read operations, empty/error/loading states, and push settings on web and mobile.
- Operations tests verify role checks, redacted health data, audited retry, and that retry cannot bypass recipient checks, preferences, or expiry.
- Regression tests prove notification delivery failure does not change booking, payment, or safety state and no notification feature depends on SMS/WhatsApp or OTP.
- Run repository lint and app/Worker TypeScript checks; manually exercise the inbox and settings at `http://localhost:8081/` while signed in. Physical-device push verification requires a development/production build and valid APNs/FCM configuration; Expo Go is insufficient for remote push verification. See [Expo Notifications for SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/) and [Expo push setup](https://docs.expo.dev/push-notifications/push-notifications-setup/).

## Scope boundaries

- This is the shared foundation and event catalog for issue #22; domain-specific quote, payment, trip, and safety state machines remain in their owning modules.
- Do not add SMS/WhatsApp or one-time-code verification.
- Do not add automatic notification-history deletion until retention is selected.
- Do not claim that Expo acceptance proves device delivery or user visibility.
- Do not expand issue #17's admin workflows beyond notification health and audited delivery retry.


## Delivery implementation refinement — 16 October 2026

Migration0021 adds nullable dispatch generation and consumer lease columns. Fresh
Queue messages carry `{ deliveryId, generation }`, both opaque IDs. Old one-ID
messages are accepted only while that outbox row has no generation. A120-second
renewable consumer lease serializes normal device sends; token/generation-guarded
updates prevent stale completion, DLQ or operator work from changing a newer
attempt. Transient sends keep the60-second retry; contention waits121seconds for
lease expiry. Each upstream request has a15-second abort signal. Delivery-time
quiet-hour and expiry checks repeat before every device; expiring events also
supply Expo's absolute expiration. These measures limit duplicate/stale sends but
do not remove the documented upstream-acceptance/persistence crash window. See
[delivery operations](../../runbooks/notification-delivery.md) for compatible
rollout/rollback and diagnostics.
