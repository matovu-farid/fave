# Notification delivery operations

The inbox and outbox in D1 are authoritative. A failed push does not change a
booking, payment or incident. Operations shows counts and redacted failure
metadata, never message content, recipients or tokens.

## Delivery and retry

- The one-minute Cron dispatcher claims due rows for five minutes before enqueue.
- Each enqueue/operator retry assigns a fresh opaque `queue_generation`. The
  Queue envelope contains only `{ deliveryId, generation }`. Messages from an
  older generation, including delayed DLQ messages, cannot change a newer attempt.
- A consumer atomically acquires a separate120-second lease and renews it before
  each device. Every status/attempt write is guarded by its token and generation.
  A stalled lease can be recovered after expiry. A stale holder cannot finish or
  clear its successor's lease.
- Transient send errors retry after60seconds. Lease contention or unknown database
  failure waits121seconds so an abandoned120-second lease can expire; these are
  distinct from ordinary retry backoff. The existing Queue retry limit is five.
- Each Expo request has a15-second abort signal. Expiring events also include the
  Unix-seconds `expiration` in the Expo message. The upstream acceptance-before-D1
  persistence crash window remains; exactly-once device display is not promised.
- Each send rechecks domain access, the device registration, current event expiry,
  and21:00–08:00 Africa/Kampala quiet hours for ordinary alerts. Deferred sends
  return to pending with a morning `not_before`; the inbox stays available.
  Urgent/time-sensitive events bypass quiet hours, not ownership or expiry checks.
- Operator retry rechecks eligibility/preferences/expiry and records the outcome.
  Completed expiry/suppression results are HTTP200; a queued retry is202. Terminal
  outcomes stop offering Retry; attempt history is retained.

Reference behavior: [Cloudflare Queue delivery](https://developers.cloudflare.com/queues/reference/delivery-guarantees/),
[per-message retries](https://developers.cloudflare.com/queues/configuration/batching-retries/),
and [Expo expiration/tickets/receipts](https://docs.expo.dev/push-notifications/sending-notifications/).

## Read-only diagnosis

Use the configured `fave-worker`/`fave-db` account and canonical
`https://api.fave.fidexa.org`. Verify the live version before acting. Inspect only
status/age/count metadata; do not print device tokens or private domain data.

```sql
SELECT status, COUNT(*) AS count FROM notification_outbox GROUP BY status;
SELECT COUNT(*) AS active_send_leases FROM notification_outbox
 WHERE send_lease_until > CAST(strftime('%s','now') AS INTEGER) * 1000;
```

An active lease normally clears when a consumer finishes. Let an abandoned lease
expire before retrying; do not clear leases under an active sender. Use the
existing authenticated operations Retry action rather than publishing arbitrary
Queue messages. Do not run live push tests against genuine accounts as a smoke
check; use the real-SQLite suites and isolated browser fixture.

## Migration and rollback

Migration0021 adds only nullable generation/lease columns. Apply before the new
Worker receives traffic. Existing one-ID Queue messages are accepted for rows
whose generation is stillNULL; their normal dispatcher/operator retry then moves
them to the new envelope. No cleanup of inbox/event/attempt history is added.

Retain the additive columns on rollback. A version predating0021's consumer does
not understand the two-ID envelope and will acknowledge it without sending.
Prefer a compatible rollback build. If an older version must be restored, stop
new retry/enqueue work and coordinate Queue-consumer processing while reconciling
only unfinished rows to pending/NULL generation after all active sends have
finished or their leases have expired. Then resume the old dispatcher so those
rows get legacy envelopes. Never reset completed/expired/suppressed records or
clear live leases. Audit the intervention and verify counts before/after; do not
bulk replay real notifications as a test. Restoring code does not roll back D1 or
retract pushes already accepted upstream.
