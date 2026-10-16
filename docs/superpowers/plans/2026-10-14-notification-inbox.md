# Booking, Payment, and Safety Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build issue #22's durable, private notification inbox and Queue-backed Expo push delivery foundation, with safe event contracts and actionable delivery health.

**Architecture:** D1 stores versioned events, per-recipient inbox items, an outbox, per-device delivery attempts, Expo tickets/receipts, and admin retry audit. A one-minute Worker dispatcher enqueues opaque delivery IDs to Cloudflare Queues; Queue and DLQ consumers perform idempotent processing and Expo delivery. Authenticated inbox APIs power the existing Notifications screen, while role-checked health APIs feed the existing operations area.

**Tech Stack:** Expo SDK 57, React Native, Expo Router, Hono, Cloudflare Workers, D1/SQLite, Cloudflare Queues, Expo Push Service, Node test runner.

---

## Scope and implementation boundaries

The inbox, event ledger, outbox, queue transport, and admin delivery health are one end-to-end feature: each layer shares the same delivery IDs, privacy rules, expiry behavior, and status model. Keep them in one plan and deliver in small, independently testable commits. Issue #22's payment, trip-completion, and incident producers depend on still-open issues #11, #13, and #19; implement their stable event contracts now and wire only domain transitions that exist. Add their producer calls when those owner issues implement the corresponding state transitions. Do not block the inbox, driver-offer, or current booking notifications on those future modules.

Issue #12's driver offer and acceptance flow and the existing push-token registration are present on `main`; build on them. Do not redo token lifecycle work. No SMS/WhatsApp, OTP, automatic history deletion, payment mutation, or separate broad admin console is in scope. Keep all implementation work on the currently checked-out `main`; create no branch or worktree.

## Files and responsibilities

- Create `fave-worker/migrations/0017_notifications.sql`: event, inbox, outbox, per-device delivery, and retry-audit tables, constraints, and query indexes. Preserve migration `0016_notification_push_tokens.sql` unchanged.
- Create `fave-worker/src/notification-contracts.ts`: typed V1 event catalog, recipient roles, notification priorities, safe template keys, route identifiers, and expiries.
- Create `fave-worker/src/notification-store.ts`: atomic event/inbox/outbox persistence, idempotency keys, ownership checks, due-row leasing, status transitions, receipt persistence, and redacted admin summaries.
- Extend `fave-worker/src/notifications.ts`: authenticated inbox list/read APIs and existing push-token routes; expose admin-only delivery health and audited retry APIs from a dedicated router in `fave-worker/src/admin-notifications.ts`.
- Create `fave-worker/src/notification-delivery.ts`: Queue dispatcher, Expo send/receipt adapter, expiry and preference checks, token invalidation, retry classification, and DLQ handling.
- Extend `fave-worker/src/auth.ts`, `fave-worker/wrangler.jsonc`, and `fave-worker/src/index.ts`: Queue bindings, every-minute scheduled dispatch/receipt sweep, Queue consumer entry points, and router registration. Regenerate `fave-worker/worker-configuration.d.ts` with the installed Wrangler CLI.
- Extend `fave-worker/src/bookings.ts` only where current quote, offer, booking-hold, cancellation, or expiry transitions should emit issue #22 V1 events. Keep each event/outbox write atomic with the business mutation using D1 batch transactions.
- Extend `src/lib/marketplace.ts`: typed inbox and admin-health response types and authenticated API functions.
- Extend `src/app/notifications.tsx`: inbox list/read controls alongside the existing push settings and loading/empty/error states.
- Add focused Worker tests in `tests/notification-store.test.mjs`, `tests/notification-delivery.test.mjs`, `tests/notification-api.test.mjs`, and extend `tests/notification-tokens.test.mjs` only for regressions in existing token ownership.
- Add `tests/notification-producers.test.mjs` for booking and driver-offer transitions that already exist.
- Add `tests/notification-inbox-ui.test.mjs` for API interaction and user-facing state coverage consistent with existing source-level React Native tests.
- Update `fave-worker/README.md` with local Queue/DLQ setup, required Cloudflare resources, Expo ticket/receipt behavior, and deployment steps. Do not put credentials or token samples from real devices in docs.

## Tasks

### Task 1: Add the durable event, inbox, and delivery schema

**Files:**
- Create: `fave-worker/migrations/0017_notifications.sql`
- Create: `tests/notification-store.test.mjs`

- [x] **Step 1: Write migration-backed failing tests**

Use `node:sqlite` `DatabaseSync(':memory:')`, enable `PRAGMA foreign_keys = ON`, create the existing `user` table fixture, apply migrations 0016 and 0017, and assert:

```js
assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notifications'").get().name, 'notifications')
assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notification_outbox'").get().name, 'notification_outbox')
assert.throws(() => db.prepare('INSERT INTO notifications (id, event_id, recipient_user_id, event_type, event_version, template_key, route, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('n1', 'e1', 'missing-user', 'trip.offer.created', 1, 'trip_offer', '/driver', 1, null))
```

Also assert unique `(event_id, recipient_user_id)` and unique delivery IDs, per-device delivery rows reference existing tokens, timestamps are integers, and deleting a user cascades only their tokens/inbox rows as specified.

- [x] **Step 2: Run the tests and confirm schema failure**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test tests/notification-store.test.mjs`
Expected: FAIL because migration `0017_notifications.sql` does not exist.

- [x] **Step 3: Create migration 0017**

Create tables for `notification_events`, `notifications`, `notification_outbox`, `notification_deliveries`, and `notification_retry_audit`. Include the unique event/recipient key, one delivery ID per outbox item, recipient and token foreign keys, `expires_at`, `not_before`, `lease_until`, `attempt_count`, safe status enums via `CHECK`, and indexes for recipient/newest, unread recipient rows, due outbox leases, pending Expo receipts, and admin status summaries. Add no TTL, delete trigger, or cleanup schedule.

- [x] **Step 4: Run migration tests and local migration**

Run the focused Node test above, then run `npm run db:migrate:local` from `fave-worker/`.
Expected: all migration assertions pass and Wrangler reports migration `0017_notifications.sql` applied locally.

- [x] **Step 5: Commit schema**

Run `git diff --check`, inspect the migration and test diff, and commit only these files with `feat: add notification delivery schema`.

### Task 2: Define event contracts and atomic D1 persistence

**Files:**
- Create: `fave-worker/src/notification-contracts.ts`
- Create: `fave-worker/src/notification-store.ts`
- Test: `tests/notification-store.test.mjs`

- [x] **Step 1: Add failing contract and idempotency tests**

Test the supported V1 event type strings for quote/deposit status, booking cancellation/expiry, driver/vehicle assignment/reassignment, trip progress/check-in, balance due/paid, and safety/support. Verify an event with an unknown type, unapproved template, arbitrary external route, invalid role, or invalid expiry is rejected. Verify two writes of the same `(eventId, recipientUserId)` produce one inbox row and one outbox delivery.

- [x] **Step 2: Confirm the tests fail before the module exists**

Run the focused Node test file. Expected: FAIL because `notification-contracts.ts` and the event store exports do not exist.

- [x] **Step 3: Implement the V1 contract catalog**

Export a discriminated union and immutable catalog from `notification-contracts.ts`. Every event definition names its owner, recipient roles, priority, template key, internal route key, and optional expiry rule. Use only internal route identifiers; do not accept client-provided notification title, preview, recipient, or route.

- [x] **Step 4: Implement atomic persistence and due-row leasing**

In `notification-store.ts`, export `buildNotificationEventStatements(db, input, now)`, `createNotificationEvent(db, input, now)`, `listNotifications(db, userId, cursor, limit)`, `markNotificationRead(db, userId, notificationId, now)`, `markAllNotificationsRead(db, userId, now)`, and `claimDueNotificationDeliveries(db, now, leaseUntil, limit)`. The builder validates the catalog entry and returns event, recipient inbox, and outbox statements that a domain caller can append to the same D1 batch as its business mutation. `createNotificationEvent` wraps that builder in one atomic D1 batch for standalone use. Database uniqueness handles repeated event IDs. List/read functions always scope by authenticated `userId`; leasing atomically claims only due, unexpired rows whose prior lease is absent or expired.

- [x] **Step 5: Verify schema and store behavior**

Run the focused test file and `npm run typecheck` from `fave-worker/`.
Expected: event validation, dedupe, transaction rollback, no cross-user list/read, unread counts, cursor ordering, expiry, and lease-reclaim tests pass; Worker TypeScript exits 0.

- [x] **Step 6: Commit contracts and store**

Run `git diff --check`, inspect the changed files, and commit with `feat: add versioned notification event store`.

### Task 3: Emit events from currently implemented booking flows

**Files:**
- Modify: `fave-worker/src/bookings.ts`
- Modify: `fave-worker/src/notification-store.ts` only if a transaction helper is needed
- Test: `tests/notification-producers.test.mjs`

- [ ] **Step 1: Add failing tests for existing domain transitions**

Cover the current quote request created, driver accepted/declined/expired, booking hold created, deposit-pending booking expired, and client withdrawal transitions. Assert authorized client/driver inbox recipients, correct event type/expiry, exactly one inbox event per transition, and rollback when event persistence fails. Do not invent payment completion or safety transitions that do not exist yet.

- [x] **Step 2: Run the focused tests and verify the missing-event failures**

Run `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test tests/notification-producers.test.mjs`. Expected: event assertions fail because current booking transitions do not publish issue #22 events.

- [x] **Step 3: Wire existing transitions through the event store**

Update only current `bookings.ts` state transitions. Build the event statements with `buildNotificationEventStatements` and append them to the exact same D1 `batch()` as the business mutation; gate notification inserts on a successful state transition. Check affected-row counts before returning success. A failed event/outbox write must not leave a committed transition without its durable notification. A later Queue/Expo failure must not roll back an already committed transition.

- [ ] **Step 4: Verify transition, duplicate, expiry, and rollback cases**

Run `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test tests/notification-store.test.mjs tests/notification-producers.test.mjs` and `npm run typecheck` from `fave-worker/`.
Expected: repeated requests do not duplicate inbox rows; declined/expired 15-minute offers cannot remain actionable; transition and outbox commit/rollback together.

- [ ] **Step 5: Commit current producers**

Run `git diff --check`, inspect only the booking/event changes, and commit with `feat: emit notifications for booking transitions`.

### Task 4: Add Queue dispatch, Expo delivery, receipts, and DLQ recovery

**Files:**
- Create: `fave-worker/src/notification-delivery.ts`
- Modify: `fave-worker/src/auth.ts`
- Modify: `fave-worker/src/index.ts`
- Modify: `fave-worker/wrangler.jsonc`
- Regenerate: `fave-worker/worker-configuration.d.ts` using `npm run cf-typegen` from `fave-worker/`
- Create: `tests/notification-delivery.test.mjs`

- [x] **Step 1: Add failing adapter and consumer tests**

Use injected fake `fetch`, fake Queue bindings, and a SQLite fixture to test: an ID-only Queue message; a per-device Expo request with generic safe preview; `expo_accepted` ticket storage; receipt `ok` and receipt error states; temporary errors that throw for Queue retry; invalid-device receipts that disable only that device token; preference/ownership recheck immediately before sending; expired offers acknowledged without sending; and duplicate/out-of-order Queue messages that do not duplicate inbox items.

- [ ] **Step 2: Verify adapter tests fail before delivery code is added**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test tests/notification-delivery.test.mjs`
Expected: FAIL because the Queue and Expo delivery handlers do not exist.

- [x] **Step 3: Implement Queue and Expo adapters**

Implement a one-minute outbox dispatcher with leases, ID-only primary Queue messages, per-device Expo send, ticket storage, and receipt sweep for tickets at least 15 minutes old. Before every send, recheck event expiry, role/recipient eligibility, token ownership, and the current push preference. Use a stable notification ID and document the crash window between upstream acceptance and D1 ticket persistence; do not claim exactly-once push display.

- [x] **Step 4: Implement retries and DLQ recovery**

Configure the main Queue for five retries with a 60-second retry delay and a DLQ. The DLQ consumer stores a redacted failure and acknowledges its Queue message. Admin redrive re-enqueues the D1 delivery ID to the primary Queue only after rechecking expiry, recipient, and preference. A 15-minute driver offer past expiry is marked expired and never resent.

- [x] **Step 5: Wire bindings and Worker handlers**

Add main Queue producer/consumer and DLQ consumer bindings in `wrangler.jsonc`; update the cron to run the outbox dispatcher every minute alongside current scheduled work. Add `queue` handler routing in `index.ts`, and type the bindings in `auth.ts`. Run `npm run cf-typegen` from `fave-worker/` and inspect the generated binding declarations rather than editing generated types by hand.

- [x] **Step 6: Verify retry, receipt, privacy, and Worker configuration**

Run the focused delivery test file, `npm run typecheck` from `fave-worker/`, and `npx wrangler deploy --dry-run` from `fave-worker/`.
Expected: tests pass, typecheck exits 0, and Wrangler validates producer/consumer/DLQ/cron bindings without deploying.

- [ ] **Step 7: Commit Queue delivery**

Run `git diff --check`, review Queue config and source diff, and commit with `feat: deliver notifications through queues`.

### Task 5: Add authenticated inbox and operations APIs

**Files:**
- Modify: `fave-worker/src/notifications.ts`
- Create: `fave-worker/src/admin-notifications.ts`
- Modify: `fave-worker/src/index.ts`
- Test: `tests/notification-api.test.mjs`

- [x] **Step 1: Add failing API security tests**

Test `GET /api/notifications`, `POST /api/notifications/:id/read`, and `POST /api/notifications/read-all` for signed-out and signed-in users. Assert user A cannot list, mark read, or infer the existence of user B's notification. Test `GET /api/admin/notifications/health` and `POST /api/admin/notifications/:deliveryId/retry` for signed-out, non-admin, and admin contexts. Assert health output and errors never serialize message body, token, phone, address, or payment reference.

- [ ] **Step 2: Confirm route tests fail before routes are mounted**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test tests/notification-api.test.mjs`
Expected: FAIL because inbox and admin-notification routes are absent.

- [x] **Step 3: Implement recipient-scoped inbox routes**

Implement cursor-paginated newest-first listing with unread count, single-read, and read-all. Resolve user identity with `getSignedInUser`; ignore any client-supplied recipient ID. Return only rendered safe fields, event timestamp, unread state, and a catalog route key.

- [x] **Step 4: Implement admin health and audited retry routes**

Use `isMarketplaceAdmin` and `writeMarketplaceAudit` from `marketplace-auth.ts`. Return aggregate states, oldest pending age, attempts, failure category, event category, and redacted delivery ID. Retry writes the actor, timestamp, reason, and outcome, then rechecks current eligibility/preferences/expiry before enqueue. Return the same not-found response for an unknown or unauthorized delivery to avoid revealing it.

- [x] **Step 5: Verify APIs and Worker types**

Run the focused API tests and `npm run typecheck` from `fave-worker/`.
Expected: signed-out requests receive 401; non-admin operations receive 403; cross-user records remain private; audited admin retry cannot resend stale offers.

- [ ] **Step 6: Commit API surface**

Run `git diff --check`, inspect route registration and response shapes, and commit with `feat: add private inbox and notification operations APIs`.

### Task 6: Build the inbox into the existing Notifications screen

**Files:**
- Modify: `src/lib/marketplace.ts`
- Modify: `src/app/notifications.tsx`
- Create: `tests/notification-inbox-ui.test.mjs`

- [x] **Step 1: Add failing UI/API contract tests**

Test that the screen loads a first page, renders an empty state, renders safe notification title/body/time/unread state, retries a failed load, marks an item read when opened, and marks all read. Assert push permission controls continue to invoke the existing registration/unregistration behavior and browser keeps the existing mobile-only push message while showing the inbox.

- [ ] **Step 2: Verify inbox screen tests fail before client APIs exist**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test tests/notification-inbox-ui.test.mjs`
Expected: FAIL because the client inbox API helpers and inbox list are not implemented.

- [x] **Step 3: Add typed client helpers**

In `src/lib/marketplace.ts`, define the notification item/page/health response types matching Task 5 and add authenticated list, mark-one-read, and mark-all-read helpers. Do not include recipient IDs, Expo tokens, or raw event payloads in client response types.

- [x] **Step 4: Extend Notifications screen**

In `src/app/notifications.tsx`, retain current enable/disable/settings behavior and add inbox loading, newest-first list, unread indicators, tap-to-open internal routes, mark-read, mark-all-read, empty, and retryable error states. Use existing themed UI components and spacing. Do not add a new route, dependency, external link, or persistent client-side copy of notification data.

- [x] **Step 5: Verify UI and static checks**

Run the focused UI test, `npx expo lint`, and `npx tsc --noEmit` from the repository root.
Expected: inbox behavior and push settings tests pass; lint and TypeScript checks exit 0.

- [ ] **Step 6: Manually test browser inbox**

At `http://localhost:8081/notifications`, sign in using the existing browser session, verify inbox empty/populated/error and mark-read behavior with local test records, verify push settings remain available, and confirm opening an item reaches only its authorized internal destination. Do not initiate a trip, charge, SMS, or live push.

- [ ] **Step 7: Commit the inbox UI**

Run `git diff --check`, inspect the screen at a mobile-width browser viewport, and commit with `feat: add notification inbox to alerts screen`.

### Task 7: Close the issue coverage loop and validate the full foundation

**Files:**
- Modify: `fave-worker/README.md`
- Modify: `docs/superpowers/specs/2026-10-14-notification-inbox-design.md` only for implementation facts that changed during execution
- Modify: current domain owner modules only if a supported transition is missing its event call

- [x] **Step 1: Cross-check issue #22 acceptance criteria**

Map each issue criterion to a migration, module, API/UI behavior, or test. Verify existing token rotation, multi-device ownership, opt-out, and sign-out cleanup tests still pass. Identify missing producer hooks for payment (#11), trip progress (#13), safety (#19), or operations console (#17); wire only transitions that exist on `main`, and leave future owner-module work explicitly tracked as a dependency.

- [x] **Step 2: Document setup and failure semantics**

Update `fave-worker/README.md` with Queue and DLQ resource creation/bindings, five retries/60-second retry delay, minute dispatcher and 15-minute Expo receipt sweep, local `wrangler dev` usage, required Expo/APNs/FCM setup, secret handling, DLQ redrive behavior, at-least-once duplicates, and the current no-retention-cleanup decision. Include no live credentials or user tokens.

- [x] **Step 3: Run full automated checks**

From repository root run `npm test`, `npx expo lint`, and `npx tsc --noEmit`. From `fave-worker/` run `npm run typecheck` and `npx wrangler deploy --dry-run`.
Expected: all non-loopback tests and required static/configuration checks pass. Report any environment-only skipped tests by name rather than treating them as passing.

- [ ] **Step 4: Re-test the browser and review the final diff**

Manually exercise signed-in inbox, mark-read, empty/error states, mobile-width layout, and existing push settings at `http://localhost:8081/notifications`. Confirm a normal account cannot access admin health, and confirm admin health contains only redacted operational data. Run `git diff --check`, inspect the complete diff, and confirm branch is still `main`.

- [ ] **Step 5: Commit documentation and required final fixes**

Commit only the README/spec/final targeted fixes with `docs: document notification queue operations`. The user explicitly requested the production Worker release on 2026-10-14. The queues already exist, but the current Worker release and database schema still need verification after Wrangler authentication is restored.

## Verification map

- Durable private inbox and ownership: migration constraints plus `notification-store` and API cross-user tests.
- Event contracts, idempotency, and atomic business state: contract/store tests and current booking-transition tests.
- Queue/DLQ retry, Expo tickets/receipts, expiry, and privacy: delivery adapter tests plus Wrangler dry run.
- Quiet-hours behavior: fixed Africa/Kampala boundary tests for ordinary, urgent safety/payment, and 15-minute driver-offer events.
- Admin failure visibility and intervention: non-admin rejection, redacted health response, audit, and expiry-safe retry tests.
- Mobile/web inbox and push settings: focused UI tests, Expo lint/typecheck, and manual browser inspection.
- Issue #22 completion: acceptance-criteria crosswalk against current source and tests; missing producers for unbuilt dependent domains remain explicit follow-up work rather than fabricated behavior.

## Production release checkpoint — 2026-10-15

- Created Cloudflare Queues `fave-notification-dlq` and `fave-notification-delivery`.
- Applied remote D1 migrations `0016_notification_push_tokens.sql` and `0017_notifications.sql`; Wrangler subsequently reported no migrations pending.
- The first Worker deploy published code and Queue consumers but could not add both cron triggers because the account had reached its five-trigger Free limit. Consolidated minute dispatch and hourly maintenance onto one `* * * * *` trigger; hourly cleanup runs when `scheduledTime` is at minute zero. The second deploy succeeded as Worker version `d5376d04-1305-47c2-9b1e-59076b02f708` with both Queue consumers and the single cron.
- Production `GET /api/notifications/inbox` returns 401 signed out; the signed-in localhost browser displays the empty inbox state successfully. Production `GET /api/admin/notifications/health` also returns 401 signed out.
- Commit `f9dd169` adds the full opaque `deliveryId` to the admin health response so authorized operators can invoke the existing audited retry route. The change is on `main` and the push-triggered CI run passed. `wrangler deploy --dry-run` succeeds with the configured D1, R2, Images, Queue, and environment-variable bindings.
- **Superseding production verification — 2026-10-16:** Wrangler OAuth authorization was completed for the Cloudflare account that owns the `fidexa.org` zone. A read-only query against the configured production D1 database confirms migration `0018_vehicle_fare_benchmarks.sql` at migration row 19 (`2026-10-15 23:58:15`), and Wrangler reports no migrations pending. The Cloudflare Worker dashboard shows version `e6c5cd34-f131-4f93-838c-03c844d91aca`, deployed from `main` commit `cc5e732`, Ready with 100% of `fave-worker` traffic; its Domains section lists `api.fave.fidexa.org` as a custom domain. The `fidexa.org` zone overview is in the same account.
- The deploy command exited non-zero while trying to configure the declared custom domain (`Could not find zone for api.fave.fidexa.org`). Although Wrangler's zone lookup warning remains unexplained, the Cloudflare dashboard confirms the hostname is attached to `fave-worker`, so the production release is active. Public `GET /health` returns HTTP 200 with D1 healthy; unauthenticated `GET /api/admin/notifications/health` returns the expected HTTP 401. These checks confirm the domain, database, and protected route are working. This supersedes the earlier pending-migration, expired-token, and `26170dce` checkpoint above.
- On 2026-10-16 the owner selected a signed-in client account for the localhost browser test. `/notifications` opens and shows the expected empty inbox; `/admin` redirects to home, confirming this account is not an admin. Admin-health authorization and mobile-width checks remain outstanding. Do not create production test notifications or send live pushes to test populated/read paths.
- Payment, trip-progress, and safety producers remain dependent on their owning state machines and the unresolved counsel/policy decisions in #14/#15; provider selection and account-specific approval also remain open in #16.
- **Fresh-session browser check — 2026-10-16:** Google sign-in with the owner-selected account survives reload. The authenticated inbox loads its empty state and correctly explains that push alerts require the mobile app. Mobile web inspection at 320/390px found clipped navigation; the shared web tab bar now wraps within the viewport, reserves space above screen content, and provides 44px-high links. Checks at 320, 390, and 1280px show all five non-admin tabs in bounds. Populated/read paths, admin-session controls, live push delivery, and owner-module producers remain unverified; no production test notifications or push sends were created.


### Producer regression and browser verification — 16 October 2026

The originally named `tests/notification-producers.test.mjs` was absent. Added
real-SQLite/Hono coverage using every production migration. A late response to a
legacy driver offer reproduced the missing event (the offer expired but its
client had zero inbox/outbox rows). The response now uses the existing filtered,
atomic expiry helper, including its conditional transition guard. This maintains
compatibility for old offers; new requests still use staff confirmation.

Ten test cases/subcases cover late expiry and duplicate retries, a competing
withdrawal, unrelated-user denial, decline and client withdrawal recipients,
staff confirmation and deposit-hold recipients/expiry, plus injected outbox
failures during expiry, staff confirmation and booking conversion. The expiry
failure leaves the offer pending with no partial notification rows; retry after
recovery expires it with one notice. Staff/booking failures leave no partial
quote, hold, acceptance or consent changes. Independent focused review found no
material code regression and requested the direct expiry rollback test, now added.

The Task 3 coverage checkboxes above are corrected to remain partial: legacy
acceptance/quote readiness and scheduled deposit-expiry producer integration
coverage still need completion. Future payment/trip/safety producers remain with
their owner issues; these tests do not establish their implementation.

Manually exercised the actual static app and Worker against an isolated loopback
synthetic database: populated inbox, opening the expiry alert to its own current
trip request, one unread remaining, mark-all-read, and persisted read state after
reload. Checked at390px width. Authorized operations displays pending delivery
counts and no message/recipient details. No browser errors/warnings observed.
Closed the test tab and stopped its server; the owner's production security page
was retained. No production notification, push, real booking or charge was created.

Validation for this checkpoint:264 tests passed, zero failures/skips; Expo lint,
app TypeScript and Worker TypeScript passed. The initial sandboxed full-suite run
skipped three loopback tests; the successful final run allowed loopback and ran
all of them. Independent review confirmed the direct expiry rollback coverage.

### Notification expiry release checkpoint

- Main implementation:9cc787aff7d4ca56315f8003af8fd118fed612b6.
- CI38909410706 passed for that exact commit. Worker upload dry-run passed.
- Worker version:b0834aec-2d3a-46d2-9421-634a7acc868e, tagmain-9cc787a.
- Deployment:7d553f6d-9f3f-41cc-8203-936681c2d1f0, created2026-10-16T13:40:45.005135Z,
  serving100% traffic. Runtime, static assets configuration and all bindings match
  the prior version; no migrations, triggers, fare or legal publication changed.
- Rollback:e53416a8-1d01-4666-b26f-6e97fb56e654.
- Public health200 with databaseok; signed-out inbox, notification-health and staff
  security APIs401JSON. Staff security API/static page retainprivate/no-store;
  static page200HTML. Unknown API404JSON. These are read-only smoke checks, not
  production end-to-end notification delivery or real-device push acceptance.

### Recipient and device delivery checks — 16 October 2026

Issue22 remains In progress. Investigation reproduced five failures against real
production SQL: an unrelated recipient could receive an availability push; a
second device still received a push after switching accounts or opting out while
the first device was sending; sign-out during an in-flight request lost the
accepted ticket and retried; and a delayed invalid-token receipt removed the new
owner's registration.

Implemented the existing delivery/retry requirements with one shared audience
loader. It validates the event/inbox/outbox relationship and catalog fields, then
resolves current availability-request, legacy-offer and booking ownership/roles.
Booking driver membership uses the saved quote's driver, not a later vehicle
owner. Revoked driver/admin roles fail closed. Future trip/payment/incident/support
owners must supply their authoritative audience lookups when those modules ship;
a catalog role string alone does not grant delivery access.

The consumer rechecks audience and token ownership before each device send.
Accepted tickets survive token removal/reassignment with a nullable token link;
invalid-token response/receipt cleanup is ownership guarded. Completed and other
terminal delivery replays cannot send old alerts to newly registered devices.
Manual retry shares the audience checks and audits a terminal suppression.
Completed expiry/suppression checks return HTTP200 with their existing typed
result; actual enqueue remains202. Health excludes terminal suppressed/expired
outboxes from retryable failures while preserving attempt history.

Validation:13 new real-SQLite integration tests; full suite277 passed with zero
failures/skips. Expo lint and app/Worker TypeScript passed. Independent review of
both the access fixes and retry-result follow-up found no material issues.
Browser:isolated actual Worker/static console with synthetic failed delivery;
Retry rendered “Delivery was suppressed; no push was sent”, refreshed delivery
counts and removed the Retry control. Checked at390px width; no browser errors or
warnings. Screenshot:/tmp/fave-notification-safe-retry.jpg. Test tab/server closed;
owner's production console retained. No real push or production record created.

Limits:delivery cannot recall a request already sent to Expo. Registration/domain
checks and the external send cannot share an atomic transaction. The existing
upstream-acceptance-before-ticket-persistence crash window and concurrent Queue
consumer duplicate-send risk remain; this is not an exactly-once push guarantee.

### Audience/device release checkpoint

- Main implementation:6b7fed3206fbcdabff0bc598792c2f2c7ac46895.
- CI38911870585 passed for the exact commit; Worker upload dry-run passed.
- Worker version:f4bb66e1-b3b8-4c0d-bd82-89a7a43dfd90, tagmain-6b7fed3.
- Deployment:bc94bc1d-5026-4438-bf8f-4d6c80957a27, created2026-10-16T13:59:24.971562Z,
  serving100% traffic. Runtime, static assets configuration and all bindings match
  the prior live version. No migration, trigger, fare or legal publication changed.
- Rollback:b0834aec-2d3a-46d2-9421-634a7acc868e.
- Read-only production checks:health/databaseok; signed-out inbox, admin
  notification-health and staff-security APIs401JSON; unknown API404JSON.
  The console uses its configured trailing-slash redirect before serving HTML.
- Remaining:consumer concurrency/lease behavior, delivery-time quiet-hour and
  expiry checks across slow sends, remaining producer integration coverage,
  real-device push and future domain/policy gates. The broader issue is open.

### Delivery reliability implementation checkpoint

Continue the approved duplicate/out-of-order/quiet-hours/expiry requirements in
Task4. Reproduce overlapping consumers and delayed sends against real SQLite.
Use an additive outbox dispatch-generation marker plus a renewable consumer lease
so a stale Queue/DLQ message or expired worker cannot overwrite a newer attempt.
New Queue envelopes carry only opaque delivery and generation IDs; legacy one-ID
messages remain valid only for rows not yet assigned a generation. This refines
the original one-ID implementation without adding personal data to Queues.

Recheck Kampala quiet hours and expiry immediately before each device send and
advance the clock across slow sends/batch messages. Bound upstream request time;
retain accepted tickets and the documented upstream-acceptance/persistence crash
window. Deferred ordinary alerts return to D1 for the next morning; urgent and
time-sensitive alerts still bypass quiet hours. Operator retry creates a fresh
generation; old DLQ outcomes cannot cancel that retry. Verify with meaningful
concurrency, expiry, quiet-hour and stale-generation tests, then review, browser
check, required repository checks and authorized production release.

### Delivery reliability verification — 16 October 2026

Six real-SQLite reproductions failed before implementation:parallel device sends,
quiet-hour retry bypass, expiry crossed between devices, missing upstream expiry,
stale DLQ overwriting complete, and old DLQ cancelling a newer operator retry.
Two further reproductions found stale operator suppression overwriting a newer
attempt and an unsuccessful queued retry writing a false success audit; both now
use conditional generation/status/lease guards and transaction-linked audits.

The reliability suite has14 tests, including abandoned lease recovery, stale
sender completion after takeover, consumer completion before dispatcher commit,
legacy message invalidation after fresh generation, quiet-hour crossing/resume,
and failed-device-only retry. Busy/unknown persistence outcomes wait121seconds;
normal transient send failure retains60seconds. The15-second upstream abort and
absolute Expo expiration reduce requests continuing past the lease/domain window.
The accepted-upstream-before-ticket-persistence crash window remains documented.

Full suite291 passed with zero failures/skips. Expo lint, app TypeScript, Worker
TypeScript and Worker packaging dry-run passed. Independent review of the lease/
generation flow and operator follow-up found no remaining material issues; an
additional adversarial takeover probe also preserved the replacement ticket.

Browser:actual Worker/static app with an isolated synthetic database and simulated
night clock. Operations renders one pending/deferred and one expired delivery;
neither attempted a push. At390px, both original inbox records remain with two
unread items. No console errors/warnings. Screenshot:
/tmp/fave-notification-timing-status.jpg. Test server/tab stopped and viewport
reset; production owner console retained. No production test event or push sent.
