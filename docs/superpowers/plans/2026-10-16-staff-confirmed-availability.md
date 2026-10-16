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
- [x] Apply the new migrations to local D1 and production D1 (production migration `0019` applied 2026-10-16).

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
- `tests/driver-availability-holds.test.mjs`: owner-only, date-only quote holds, non-blocking pending requests, expiry without cron, and one deposit hold after conversion. The driver screen distinguishes quote holds from deposits and confirmed trips (issue #8).
- Independent review found and resolved legacy quote continuation, reached-call gating, missing conversion auditing, and a local-expiry recovery issue.

## 8. Release and runtime verification

- [x] Full suite with loopback enabled: all tests pass with no skips.
- [x] App lint and TypeScript checks pass.
- [x] Worker TypeScript check passes.
- [x] Local D1 migrations apply successfully.
- [x] Worker deployment dry run bundles successfully; this did not publish a release.
- [x] Apply the production D1 migration and deploy the Worker update before testing the browser’s production-backed API.
- [ ] Authenticated browser walkthrough at `http://localhost:8081`: estimate/edit, request/withdrawal, staff call/confirmation, unchanged price, hold conflict, expiry/retry, unavailable state, disclosures, and deposit-hold conversion.
- [ ] Physical-device confirmation by the owner after the runtime update.
- [ ] Update issue evidence and close only the work verified as complete.

No payment-provider contract, legal-policy approval, or payment launch gate was changed by this implementation.

### Pre-release checkpoint (2026-10-16)

- Full suite: 193 passing, zero failing or skipped. App lint, app typecheck, Worker typecheck, and diff whitespace checks pass.
- The initial browser session was stale. A fresh Google sign-in with the owner-selected account now survives a full reload; Home → Account → Back to home and the authenticated empty notification inbox work. Trips still receives HTTP 404 for the new availability API because its proxy uses the production Worker. Account independently confirms that approved client terms/privacy are unavailable. Full booking verification therefore remains blocked on the backend release and approved prerequisites; no profile, policy acceptance, booking, or payment was submitted.
- Read-only Cloudflare checks confirm production Worker version `e6c5cd34-f131-4f93-838c-03c844d91aca` from `cc5e732` at 100% traffic, healthy API/D1, and only migration `0019` pending.
- Production release approval remains pending. No production migration or Worker deployment was performed at this checkpoint.

### Approved production release (2026-10-16)

- The owner approved putting the booking update live with payments remaining disabled. Pushed `main` through `afd80e53d89e530a103fe1332b95c8225ebf8a85`; [GitHub CI passed](https://github.com/matovu-farid/fave/actions/runs/38866637513). Fresh local verification: 193 passing tests, zero failures/skips, app lint/typecheck, Worker typecheck, packaging dry run, and diff checks passed.
- Captured the pre-migration D1 recovery bookmark, then applied `0019_trip_estimates_availability_requests.sql` to production `fave-db`. The migration is recorded in `d1_migrations`, and the remote migration list is empty.
- Uploaded version `53a015ef-82c7-4b7b-8d42-65eacf06615a` with tag `main-afd80e5`, then deployed it at 100% in deployment `49577290-3a7c-4c67-b19f-f57925d6cbc3`. Compared all 16 bindings and runtime settings against the previous version: unchanged. Used `wrangler versions upload --minify --keep-vars` and `wrangler versions deploy <version>@100 --yes`; existing domain, cron, and Queue triggers were preserved. This release completed without the earlier custom-domain lookup error.
- Public hostname checks: `/health` returns HTTP 200 with API/D1 healthy; `/api/trips/availability-requests/current` and `/api/admin/availability-requests` return the expected HTTP 401 signed out. The availability endpoint returned HTTP 404 before this release. Cloudflare rejected the Python HTTP client's probe with 1010; standard curl checks above succeeded.
- Restarted the stopped localhost Expo preview and manually loaded `/trips` with the existing signed-in session at 390px. The new five-step booking screen loads without the previous HTTP 404 alert. Client setup/search remain disabled with the missing-approved-terms explanation. No profile, policy acceptance, estimate, booking, payment, or test notification was created.
- Production aggregate gate check: zero active approved fare policies and zero approved client terms/privacy documents. No policy was activated and no payment capability was enabled. Complete client/staff booking, admin-session review, and physical-device verification remain open, along with the separate legal, pricing, and provider launch decisions.

### Driver-review maintenance release (2026-10-16)

- Released `main` commit `daac945c91b9fe08ce6ec86c0438cfdc55491a35` using the
  standing production Worker release authorization. The only Worker change since
  the preceding release is in `src/drivers.ts`: approve without a rejection note,
  reject stale application/document decisions, and tie audit/success to the
  actual update. The finished client-policy copy is repository content; this
  release does not activate it in D1.
- [CI passed](https://github.com/matovu-farid/fave/actions/runs/38871654653).
  Local checks passed: 207 tests with no failures or skips, Expo lint, app and
  Worker TypeScript, and packaging dry run. The first sandboxed dry run could not
  write Wrangler's normal log file; a clean authorized rerun passed.
- Confirmed the existing Cloudflare account and all required Worker permissions.
  No production migrations were pending. Uploaded version
  `7cc8058b-5450-485d-bdcc-800eb8b6acd1`, tag `main-daac945`, and compared all 16
  bindings plus runtime settings against the previous version: unchanged.
- Deployment `a1e88c6c-b576-430c-96ae-5f24dc1d178f` sends 100% of traffic to that
  version. Used version upload/deploy with preserved variables; domain, cron and
  Queue triggers were not reapplied. Previous version
  `53a015ef-82c7-4b7b-8d42-65eacf06615a` remains the code rollback reference.
- Production hostname `/health` returned HTTP 200 with API/D1 healthy.
  `/api/admin/drivers/pending` and
  `/api/trips/availability-requests/current` returned HTTP 401 without a session.
  Read-only D1 counts remain zero active approved fares and zero approved client
  terms/privacy records.
- Manually opened `/trips` in the signed-in browser. Session recovery and the
  five-step booking screen work; client setup/search correctly remain disabled
  until policy publication. No live evidence review, profile, acceptance,
  booking, payment or notification was submitted. Race/approval behavior was
  exercised through production handlers and SQL in isolated integration tests;
  no staff-review browser UI exists yet to test those actions interactively.

### Reached-call guard and approved hold windows — 16 October 2026

- Browser validation exposed that a no-answer call enabled the Unavailable action.
  Four real-SQLite regression cases reproduced incorrect HTTP 200 transitions for
  no_answer, busy, voicemail and other outcomes. The conditional unavailable
  UPDATE now requires a reached call, like confirmation. Failed decisions leave
  the request awaiting follow-up and write no decision audit or client alert.
  The staff screen disables both decisions until reached and uses outcome-aware
  save feedback. A later reached call still permits an unavailable decision.
- The owner confirmed 24 hours from staff confirmation for the saved-price quote
  hold and a separate 30 minutes from deposit-checkout start. An integration test
  starts checkout one millisecond before quote expiry, verifies both the selected
  car and its driver's other car remain excluded for the full replacement hold,
  then verifies release exactly at its deadline without waiting for Cron.
- Isolated browser walkthrough at localhost:8790 used disposable synthetic users,
  approved test documents, prices, call records and dates. Production handlers and
  SQL were used; external identity/maps and the test clock were substituted. No
  actual driver was called: the reached call was simulated through the call API.
  Confirmed pending/no-payment messaging, unanswered-call disabled decisions, then
  an explicit car/date confirmation, fixed UGX 484,000 quote, separate transport
  lines, disclosure/contact consent, deposit-pending recovery after reload, and
  exactly one booking. Starting checkout one minute before the 24-hour deadline
  created a full 1,800-second hold. D1 fixture timestamps verified both durations.
- At 390px, web consent checkbox clicks initially changed the glyph but left
  aria-checked absent, so the browser's checkbox check failed. Shared CheckRow now
  supplies flat aria-checked/aria-disabled alongside native accessibilityState.
  Fresh export/browser verification confirms all seven controls report checked
  and the deposit continuation becomes enabled. Console: no warnings/errors.
- Full suite: 296 passed, zero failed/skipped. App lint/typecheck, Worker typecheck,
  and diff checks passed. Independent review found no material issues. Browser
  proof: /tmp/fave-30-minute-checkout.jpg.
  The test build was cleared/re-exported with dotenv disabled and its local API
  target verified; no real policy acceptance, booking, notification or payment was
  submitted. This evidence does not complete the full live/provider/device gate.

### Reached-call/accessibility release checkpoint

- Released main implementation 23bfc7f28b7a54fe368367d21d1dbb3b8687f962 after
  CI38942580757 passed for that exact commit. The production web export and Worker
  packaging dry-run also passed. No migration was required.
- Worker version5255a7e9-cbbf-4eb3-a5ae-0bd191972e92, tagmain-23bfc7f,
  deployment9e59093e-5985-464b-8443-2d474442287e, created
  2026-10-16T17:51:16.50235Z, serves100% traffic. Runtime and all17 bindings match
  preceding version50a039e2-8b93-4a17-b317-2c47add038ec. Queue/Cron triggers,
  fare-policy records, legal publication and payment activation were unchanged.
- Read-only production smoke checks: health/database200ok; signed-out staff
  availability, client request and review-security APIs401JSON; console200HTML.
  The isolated test server/tab were stopped and the390px override was reset.
  No production client consent, request, booking, driver call or charge was made.
