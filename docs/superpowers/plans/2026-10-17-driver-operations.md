# Driver Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline, as the owner requested. Stay on main; no branches or worktrees.

**Goal:** Give the owner approved/suspended driver controls and durable review flags for bookings affected by suspension.

**Architecture:** A focused operational transition service owns guarded driver changes and their atomic audit/booking flags. Dedicated review routers expose bounded safe queues and verified private details. Separate Expo Router screens use a lifecycle-aware controller and the existing ten-minute review security panel.

**Tech Stack:** Expo SDK 57, React Native, Expo Router, Hono, Cloudflare D1, Better Auth review proof, Node real-SQL test fixture.

---

## Task 1: Atomic operational decisions and booking flags

Files: create `fave-worker/migrations/0026_driver_operations.sql`, `fave-worker/src/driver-operations.ts`, `fave-worker/src/booking-reviews.ts`; modify `fave-worker/src/drivers.ts`; test `tests/driver-operations.test.mjs`.

- [x] Write and run failing real-migration tests using `availabilityFixture(t)`, `f.grantReview()`, actual routers and SQL. Assert suspension creates flags for confirmed and valid deposit holds, preserves snapshots/statuses, excludes expired/cancelled bookings, and requires a driver-facing message.
- [x] Add `operations_version INTEGER NOT NULL DEFAULT 0` to driver applications and immutable operational events plus booking review flags with unique `(event_id, booking_id)` and guarded reviewed metadata.
- [x] Implement the transition contract:

```ts
type DriverOperation = 'suspend' | 'restore' | 'request_corrections'
// Request: { decision, reason, applicantMessage, expectedVersion }
// Read current status/version, then atomically compare both with exact reviewGuardSelect.
// UPDATE ...; INSERT event SELECT ... WHERE changes()=1;
// INSERT audit SELECT ... WHERE event.id=?;
// INSERT booking flags SELECT ... WHERE event.id=? AND activeBookingPredicate.
```

- [x] Match saved `quote_snapshot_json.driverApplicationId`; use an explicitly labelled current-car fallback only for missing/invalid legacy identity. Never change booking snapshots or infer completion from dates.
- [x] Reuse current approval conditions for restore, including deletion restriction, retained identity, active checklist, current document versions, citizenship and current terms/privacy. Corrections moves suspended to needs_correction with no eligibility grant.
- [x] Route the older suspension endpoint through the same service. Old suspension calls must also provide expectedVersion and the driver message; no bypass of booking flags.
- [x] Run focused tests; inject audit failure and revoked/rotated proofs to prove rollback and no stale action. Interleave booking insert and suspension batches in both orders.

## Task 2: Bounded owner review APIs

Files: create `fave-worker/src/admin-driver-operations.ts`, `fave-worker/src/admin-booking-reviews.ts`; modify `fave-worker/src/index.ts`, `fave-worker/src/review-access.ts`; extend `tests/driver-operations.test.mjs`.

- [x] Write failing actual-router tests for owner-only safe queues, locked detail, cursor validation, restore blockers and audited Mark reviewed.
- [x] Implement owner-safe queue routes ending `/pending`, with validated state and keyset cursor, page size 25 plus one sentinel. Queue responses omit contact, location, private reason and outcome notes.
- [x] Add private `/:id` detail and `/:id/decision` or `/:id/reviewed` actions behind `reviewAccess`; return exact-proof guarded no-store responses.
- [x] Return bounded nested vehicles/bookings/history with explicit truncation information. Mark reviewed compares open status, requires a note and confirmation, and atomically audits. Restore never closes flags; a later suspension creates another event/flag.
- [x] Verify cross-user, ordinary-admin, locked, revoked, stale-version and repeated-write cases, including access errors before disclosure.

## Task 3: Driver operations and booking review UI

Files: create `src/lib/driver-operations.ts`, `src/hooks/use-private-operations.ts`, `src/components/staff-review/driver-operations-screen.tsx`, `src/components/staff-review/booking-reviews-screen.tsx`, routes `src/app/(tabs)/admin/driver-operations.tsx`, `src/app/(tabs)/admin/booking-reviews.tsx`; modify `src/app/(tabs)/admin/index.tsx`; test `tests/driver-operations-ui.test.mjs`.

- [x] Write actual-controller lifecycle tests with deferred network boundaries: blur/background/lock/account/session/filter changes hide detail/drafts, late responses stay hidden, duplicate presses send one mutation, conflicts require explicit refresh.
- [x] Use the established ReviewFrame/SecurityPanel/Card/Field/ActionButton components and Expo Router Link/useFocusEffect. Fetch lists in bounded pages and open one focused record at a time.
- [x] Expose approved/suspended filter, explicit detail refresh, version-bound suspend/restore/corrections forms, internal reason and separate driver message, named-driver confirmation and current blockers.
- [x] Expose open/reviewed flag filter, private detail, outcome note and explicit Mark reviewed confirmation. State that booking/payment/trip state does not change.
- [x] Bind private state/actions to session identity, current proof expiry and screen generation; clear synchronously on lifecycle invalidation, reject stale results, prevent implicit mutation retries. Show committed server truth only through a fresh authorized refresh.
- [x] Add the two owner navigation links. Preserve pending application screens and the driver's existing own-status/message rendering.

## Task 4: Review, browser verification and release

Files: update this plan, approved spec and `docs/runbooks/mvp-implementation-readiness.md` with product-level evidence.

- [x] Run focused SQL and UI regressions, then independent security/spec/maintainability review; fix concrete findings with reproducing tests.
- [ ] Run `npm run lint`, `npm run typecheck`, Worker `tsc --noEmit`, full tests and iOS/Android/web export checks.
- [x] Build a synthetic local web fixture with real migrations, signed synthetic sessions and actual Worker routes. Manually exercise desktop and phone queues/detail, suspend, preserved existing booking/flag, restore, corrections, reviewed outcome and lock. Save screenshots; do not suspend a real user for testing.
- [ ] Commit only task files on main, push and verify CI for that source. Apply the additive migration and use the established staged Worker/web release procedure; preserve bindings/runtime settings and verify production health/routes/access denial. Keep sensitive deployment evidence local.
- [ ] Update issues #7/#17 with a minimal product/test summary. Do not close the broader issues or claim paid trip/incident/provider readiness.

## Local verification evidence

- Owner approved the written design and inline execution on main.
- Full real-SQL/runtime suite: 665 passed, zero failures or skips. Lint and both typechecks pass. Production web export passes; platform exports remain an exact-source CI gate.
- Independent backend review findings fixed with reproducing regressions: stale approval after a suspension/corrections cycle, locked reviewed history, execution-time restoration evidence/policy checks and execution-time deposit-hold expiry. Final malformed legacy-decision bypass fixed and independently rechecked.
- UI review disposition: ship. Eleven lifecycle regressions pass; shared buttons keep their accessible names while busy. Detector returned no findings.
- Synthetic browser at 1280px desktop and 390px phone: approved driver lookup; explicit reason/message and suspension confirmation; unchanged confirmed booking plus new review flag; restore with flag preserved; explicit outcome and reviewed record; later suspension produces another flag; corrections keeps new-work restriction and supplies the driver next step; locking hides detail and clears a pending outcome draft.
- Browser verification used only signed synthetic accounts and an in-memory migrated database. No real driver, document, booking, payment or policy activation was used as a fixture. Backend tests cover missing/changed restoration prerequisites and revocation races.
- Screenshots remain local under /tmp/fave-driver-operations-*.png and /tmp/fave-booking-review-*.png. Test/build/release logs remain local.
