# Staff-confirmed availability — implementation and verification

**Approved design:** [Staff-confirmed vehicle availability](../specs/2026-10-16-staff-confirmed-availability-design.md)

**Goal:** Show the selected car’s saved price estimate before client intent, then let staff call its assigned driver and confirm only the requested dates. Preserve the estimate price, hold the dates during the configured quote window, and atomically convert that hold to the existing booking/deposit hold.

**Workspace:** Implement directly on `main`; no branch, worktree, or PR. Keep issues #9, #10, #12, and #31 In progress until runtime verification is complete.

## 1. GitHub tracking

- [x] Reuse #9, #10, #12, and #31 and update their acceptance criteria for the approved staff-confirmation workflow.
- [x] Keep the related Fave project items In progress.
- [ ] Add final runtime verification results before closing the issues.

## 2. Saved estimates and date holds

- [x] Add migration `0019_trip_estimates_availability_requests.sql`: immutable estimate snapshots, one linked request per estimate, separate call records, constrained states/outcomes, and lookup indexes.
- [x] Reuse the existing fare builder instead of creating a second fare formula. Save both route legs, the car benchmark and its version, the assigned driver and overnight rate, night count, quantities, unit rates, totals, policy version, and deposit calculation.
- [x] Verify immutable estimates and exact estimate → quote → booking prices even after live vehicle/driver rates and the active fare policy change.
- [x] Verify pending requests create no hold. Active confirmed holds and deposit holds block overlapping cars and the same driver’s other cars; adjacent dates remain available.
- [x] Apply the new migrations to local D1. Production migration is a release step, still pending.

## 3. Client APIs

- [x] Authenticate estimate creation/read, linked request creation, current/specific request recovery, and pending-request withdrawal.
- [x] Scope every read and write to its owner. Reject unauthenticated users and cross-client estimate, request, and quote access.
- [x] Reject missing/unapproved cars, overnight rates, benchmark prices, active policies, invalid/past/long dates, and failed or missing route legs.
- [x] Save intent without creating a driver offer or an automatic timeout.
- [x] Disable new legacy `/quote` offer creation with a clear update-required response. Retain existing offer read/respond/withdraw APIs and usable accepted quotes during transition.
- [x] Add typed client wrappers and notification navigation to the specific request.

## 4. Staff queue and decisions

- [x] Protect every queue/contact/call/decision endpoint with admin authorization.
- [x] Show oldest unanswered requests without a seven-day cutoff, car/dates/broad route/estimate, and call actor/outcome/time/note history. Exclude client contact, exact locations, private IDs, payment details, and evidence files.
- [x] Audit driver-contact access; append call records and their audit events atomically.
- [x] Require a recorded reached-driver call before confirmation. Unanswered calls stay awaiting follow-up.
- [x] Recheck current driver/car approval, evidence, capacity, assigned driver, trip dates, active policy gate, and overlapping holds/bookings/unavailability inside the conditional confirmation path.
- [x] Create the final quote from the exact saved estimate, using the active policy’s quote window. Prevent competing or repeated decisions and withdrawal races from creating orphan quotes.
- [x] Record unavailable decisions without requesting payment. Surface changes to active confirmed availability for staff review and block client payment until resolved.
- [x] Show separate Quote sent and recent activity lists. Repeat the car and dates in a deliberate final confirmation control.

## 5. Booking conversion, expiry, and alerts

- [x] Create the normal booking/deposit hold and convert its availability request in one D1 batch, excluding only that request’s own quote hold.
- [x] Preserve the saved price and originally assigned driver; reject a silent driver substitution, wrong owner, expired quote, duplicate conversion, or overlapping booking.
- [x] Require current booking disclosures and separate contact-sharing consent.
- [x] Audit `confirmed` → `converted_to_booking` in the same batch.
- [x] Expire quote holds on client/admin reads and scheduled maintenance; audit expiry once even under concurrent reads.
- [x] Save safe client alerts and outbox records for confirmed, unavailable, and expired requests. Existing Queues/DLQ delivery remains separate from booking state.

## 6. Client screen

- [x] Display the saved estimate and calculation before creating a request; allow editing without creating intent or payment.
- [x] Clear stale estimate references when route/car details change or intent is withdrawn.
- [x] Restore the selected car, dates, passengers, luggage, and pickup pin from saved records after reopening.
- [x] Give active server requests precedence over a local draft; preserve a new draft after terminal requests.
- [x] Poll pending/confirmed requests, offer a manual status refresh, and distinguish checking, changed availability, final quote, unavailable, withdrawn, expired, and converted states.
- [x] Stop expired or changed-availability quotes from remaining payable. Let the client start again when a quote expires during a staff recheck.
- [x] Keep pre-existing accepted legacy quotes usable through their original terms/deposit continuation.
- [ ] Verify the complete authenticated flow manually in the browser and on the owner’s device.

## 7. Test and review evidence

The initial plan’s separate proposed snapshot/API/conversion test files were consolidated into production-handler SQLite integration tests and pure client-state tests. Client routes remain in the existing `bookings.ts` router to reuse its established validation and fare builder; shared review/expiry/audit behavior lives in `availability-requests.ts`. These file-boundary changes do not reduce the approved behavior or verification scope.

- `tests/staff-availability-lifecycle.test.mjs` + `tests/helpers/availability-fixture.mjs`: real production migrations, Hono handlers, SQLite SQL and transactional batches. Only the external identity/map providers and wall clock are substituted.
- `tests/trip-estimate-migration.test.mjs`: immutable estimate and schema constraints.
- `tests/trip-availability-view.test.mjs`: estimate versus payable quote, expiry/review states, saved input recovery, and accepted legacy quote recovery.
- Existing quote snapshot, fare benchmark, trip-draft, notification-contract, notification-navigation, booking, and proxy tests remain in the full suite.
- Independent review found and resolved legacy quote continuation, reached-call gating, missing conversion auditing, and a local-expiry recovery issue.

## 8. Release and runtime verification

- [x] Full suite with loopback enabled: all tests pass with no skips.
- [x] App lint and TypeScript checks pass.
- [x] Worker TypeScript check passes.
- [x] Local D1 migrations apply successfully.
- [x] Worker deployment dry run bundles successfully; this did not publish a release.
- [ ] Apply the production D1 migration and deploy the Worker update before testing the browser’s production-backed API.
- [ ] Authenticated browser walkthrough at `http://localhost:8081`: estimate/edit, request/withdrawal, staff call/confirmation, unchanged price, hold conflict, expiry/retry, unavailable state, disclosures, and deposit-hold conversion.
- [ ] Physical-device confirmation by the owner after the runtime update.
- [ ] Update issue evidence and close only the work verified as complete.

No payment-provider contract, legal-policy approval, or payment launch gate was changed by this implementation.
