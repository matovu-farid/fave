# Account deletion request and new-work restrictions

**Execution:** inline on main, following the owner's approved immediate new-work
blocks and 17 October confirmation to preserve existing-trip/payment access.
Use the existing component patterns; create no branch/worktree or new dependency.

## Deliverable and boundaries

Deliver a durable self-service deletion request, its truthful received/status
view, protected owner visibility and atomic restrictions on new bookings/driver
commitments. Existing authentication, trip reads, withdrawal, payment resolution
and sign-out remain available. Request submission is not erasure or fulfillment.
Full export/retention-category/hold/backup fulfillment remains open in #21/#14;
the app must not display a completed-deletion state or erase retained records.

## Tasks

1. Add migration-backed regressions using the real current migrations and domain
   handlers: authenticated/idempotent request submission and one audit; client
   and driver restriction across saved estimates/quotes/staff confirmation/legacy
   acceptance; both mutation orderings; existing reads/records preserved; expiry
   and withdrawal still work. Observe failures before adding the feature.
2. Add `0024_account_deletion_requests.sql`: one immutable received request per
   user, opaque ID/time, no identity cascade. SQL triggers check client and driver
   closure state when new estimates, requests, quotes, offers or bookings commit;
   guard new offer acceptance and quote confirmation. Permit ordinary existing
   booking status updates; prevent assigning a closing driver by changing its
   car. Abort the whole batch with a fixed, non-sensitive error marker.
3. Add `account-lifecycle.ts` for request/read/audit SQL, role-safe deletion-state
   predicates and error handling; `account-requests.ts` for authenticated own
   request GET/POST. Require `{confirmed:true}`, resolve ownership from session,
   and return the original request on repeats. Record receipt and audit in one
   batch; never accept a user ID from the client.
4. Integrate the closure predicate into current eligibility/needs-review checks
   and sanitize SQL-trigger errors to a retryable 409. Preserve default handling
   for unrelated exceptions. Every new-work path must remain protected if a
   deletion request commits after an earlier eligibility read.
5. Add typed client helpers and a focused Account request card: explain both
   roles' restriction, explicit inline confirmation/cancel, pending/busy/error,
   saved opaque reference/time and a link to existing Trips. Retry/reload/sign-in
   must load the same durable request. Preserve the existing profile/sign-out
   behavior. Export remains available through the disclosed support route; do not
   claim an automated export implementation.
6. Expose a protected owner request queue/detail in the existing staff console.
   Queue rows contain only opaque reference, time and safe workload metadata;
   requester contact/detail access requires current owner membership, fresh
   review proof and audit. No final erasure, automatic reactivation or false
   fulfillment button is included.
7. Render real components in behavior tests for confirmation/cancel, repeated
   press, save failure/retry, focus refresh and preserved existing-trip access.
   Run focused regressions, full suite, lint and both typechecks. Review the diff
   independently. Test the actual app/Worker with isolated synthetic records in
   the browser, including a rejected new booking and accessible old booking.
8. Push main, require exact-commit CI, apply the additive migration before code
   relies on it, verify runtime/bindings before production traffic, and record
   release evidence in #21/#20. Keep legal/fare/payment activation unchanged.

## Key invariants

`POST /api/account/deletion-request` affects only the authenticated identity.
`GET /api/account/deletion-request` always remains available to that identity.
Any DB failure must return an error, not a false received request. Durable receipt
must survive sign-out/profile edits. At a new-work race, committed deletion wins
over a subsequent business write; a previously committed booking remains an
existing obligation. Declining/withdrawing/expiring old pre-booking work is safe
and must not be blocked by the new-work guard.

## Implementation evidence

- Added migration 0024 with immutable receipts and transactional new-work guards.
- Added authenticated receipt/status routes and an owner queue with keyset
  pagination. Private requester detail checks membership, session, credential and
  review proof inside the same transaction that records its access audit.
- Account UI keeps explicit confirmation and durable received status. Existing
  driver calendars and pending-offer decline remain accessible; acceptance is
  separately disabled and guarded. Full deletion/export fulfillment remains open.
- Independent spec and code-quality reviews found and prompted fixes for a detail
  lock race, preserved driver reads/decline and queue pagination. Final validation
  and browser/release evidence are recorded in issue #21 after verification.

### Verified on 17 October 2026

- Full suite: 424 passed, zero failures/skips, including 17 migration-backed
  account lifecycle cases and real component/action lifecycle regressions.
- App lint, app typecheck and Worker typecheck passed. Production web export and
  Worker deployment dry run passed; no config/binding changes requested.
- Manual browser testing used synthetic identities/records and a deterministic
  map provider with the real Worker/auth routes: inline confirm/cancel, durable
  receipt reload, a rejected new estimate alongside an accessible confirmed trip,
  audited owner detail access, lock removing contact data, and working sign-out.
  The receipt, confirmed booking and shared identity remained intact afterward.
- Phone-width (390 px) receipt layout checked; browser viewport restored and test
  fixture cleaned up after verification. Production evidence is tracked in #21.
