# Driver operations proposal

Status: approved by the owner, 17 October 2026. Implement inline on main and
manually test in the browser. The suspension rule and concrete design below
are approved. The bounded feature is implemented and released; verification is
recorded in the matching driver-operations implementation plan.

Tracks [driver verification #7](https://github.com/matovu-farid/fave/issues/7)
and [operations #17](https://github.com/matovu-farid/fave/issues/17), both currently
In progress. Continue inline on main; no branch or worktree.

## Verified gap

The existing application queue contains pending/correction submissions only.
The final decision endpoint supports approved-to-suspended, but there is no
approved-driver roster, operational suspension control, decision history view or
supported recovery path. Suspension currently clears the driver-facing message.
The driver sees a generic instruction to contact support.

Existing eligibility predicates exclude suspended drivers from new eligible
vehicles, estimates, availability confirmation and booking confirmation. Existing
availability requests can become `needsReview`. A suspension does not cancel or
rewrite an existing booking. Current booking states do not establish a working
paid-trip, incident or replacement workflow.

## Options

1. **Recommended: a separate Driver operations screen.** Keep new application
   review focused, and provide approved/suspended drivers with their own lookup
   and focused operational detail. This makes the action's context clear and
   reuses the existing owner membership and ten-minute review unlock.
2. **Expand Driver applications with status filters.** Fewer routes, but the
   pending evidence-review queue would also become a continuing operations
   directory. It still needs a distinct decision form and booking context.

## Proposed experience

- Operations links separately to Driver applications and Driver operations.
- Driver operations provides bounded pages and an approved/suspended status
  filter. Show only opaque application reference, name, status and last decision
  time in the list; keep contact, private reasons and evidence out of queue data.
- A selected driver opens one focused page. Require the existing owner review
  membership and current server-verified ten-minute unlock before operational
  detail, private history or decisions. Clear detail and action drafts on lock,
  expiry, account change or leaving the page.
- Show current status, eligibility blockers, vehicles and a bounded list of
  relevant existing booking references/dates/statuses. Do not reveal client
  contact information or exact locations through this feature.
- Suspend requires both an internal reason and a separate driver-facing message
  explaining the next step/support route. Confirm the named driver and effect
  before sending. Record actor, time, prior/new state and reason atomically.
- Restore requires an explicit reason and all current approval requirements;
  it cannot bypass identity evidence expiry, checklist versions, policy
  acceptance, citizenship or account-deletion restrictions. If evidence must be
  renewed, a separate reasoned **Request corrections** action changes suspended
  to needs_correction with a driver-facing message. Both states remain ineligible
  for new work. Existing driver resubmission and document review then apply;
  approval still requires an explicit owner decision and every current check.
  Do not grant provisional approval or require a suspended driver to use a
  resubmission endpoint that does not accept their state.
- The driver sees their status and driver-facing next step, never internal
  reasons, other people's details or private review history.

## Confirmed suspension rule

The owner answered: **“Yes, stop new bookings and flag existing ones.”**
Suspension must prevent new work and create an owner-review flag for each
existing active booking associated with that driver. Preserve booking state,
saved price, client access and existing consent. Do not automatically cancel,
refund, replace the driver/car or send a new promise to the client.

## Proposed booking review queue

- Add **Bookings needing review** to Operations, separate from availability
  requests and application reviews. Display open flags in bounded pages, oldest
  first, with booking reference, dates, booking status and driver reference.
  Keep client contact, exact locations and private suspension reasons out of
  queue responses. Only the owner reviewer can read this queue.
- Suspending a driver atomically saves the status change, audit and durable
  review flags. A failure saves none of them. A repeated/stale request does not
  duplicate a suspension event or its flags. Cover the existing suspension API
  as well as the new screen so direct calls cannot omit the flags.
- At suspension time, include confirmed bookings and deposit-pending bookings
  whose payment hold is still valid. Exclude cancelled, expired and expired
  deposit holds. Do not infer completion from the scheduled end date: this app
  does not yet record trip completion. Older confirmed bookings therefore remain
  candidates for explicit owner review.
- Identify the booked driver from the immutable saved quote's
  `driverApplicationId`, not the car's current driver relationship. For a legacy
  snapshot without a valid driver reference, conservatively flag a booking on a
  car currently assigned to this driver and label the association as needing
  verification. Do not rewrite its snapshot or silently invent its booked driver.
- A selected flag requires the current ten-minute review unlock. Show the
  booking status/dates, suspension event and relevant driver decision history.
  No new client-contact disclosure is needed for this feature.
- Provide **Mark reviewed**, with a required internal outcome note and a clear
  confirmation that this only closes the review flag. Record reviewer, time and
  note atomically. It does not cancel, refund, reassign or mark the trip complete.
  A later suspension creates its own flags, even if an earlier flag was reviewed.
- Restoring the driver, requesting corrections, passing a scheduled trip end or
  expiring a deposit hold does not silently close an open flag. Show the latest
  booking status so the owner can record an informed review outcome. Keep a
  bounded reviewed-history view behind the same unlock.
- Persist flags and history as private operational records, subject to the
  existing account-access and retention boundaries. This feature adds no new
  public disclosure or automatic retention/deletion policy.

## Focused implementation boundaries

Use a driver-operations router/service for safe lookup, protected detail and
guarded suspend/restore/corrections transitions. Keep booking-review persistence
and queries in a focused module shared by the suspension transaction and its
review router. Reuse the existing audit infrastructure and exact review-proof
guards. Keep the existing pending application queue and evidence-review flow.

Use separate Expo Router screens for Driver operations and Bookings needing
review, reusing the existing review frame and controls. A small lifecycle-aware
controller owns each screen's server data and drafts. Do not put continuing
driver operations into the application evidence component or add more unrelated
branches to the main Operations screen.

## Errors and acceptance criteria

- Invalid or changed status, stale version, changed prerequisites or revoked
  authorization returns a conflict/access error, with no partial mutation or
  success audit. Refresh from server truth before retrying; never auto-retry a
  suspension or review-outcome write.
- Clear private data and drafts on leaving/backgrounding the screen, lock,
  expiry or account change. Ignore late reads and prevent duplicate submissions.
  A committed action remains committed if its response is later blocked by lock;
  show the actual result only after a newly authorized refresh.
- A suspended driver cannot acquire new work through direct APIs. Their own
  screen shows the supplied next step without leaking the internal reason.
- Restore succeeds only when every current approval prerequisite passes.
  Corrections permit the supported evidence-resubmission path without granting
  new-work eligibility. Existing booking flags remain open in both cases.
- A suspension/booking-creation race either rejects the new booking or includes
  it in the flags; a booking cannot slip between eligibility and flag creation.
  Concurrent suspension/review actions produce one matching audited transition.
- An ordinary staff member, another user or a locked owner cannot read private
  details/history, suspend/restore, request corrections or close review flags.

## Implementation and verification requirements after design approval

- Reuse existing eligibility and review authorization. Keep operational query
  and transition code focused instead of growing the already long driver router.
- Bind actions and private response disclosure to the exact original review
  proof, including lock generations. A later unlock must not revive an old
  suspended/restore decision or a pending private response.
- Guard current driver status/version and all restoration prerequisites inside
  the database transaction; unchanged or rejected actions produce no success
  audit. Audit failure rolls back the decision. Require refresh on conflicts.
- Exercise real migrations/SQL with synthetic approved/suspended drivers,
  concurrent decisions, changed evidence/policies, owner versus ordinary staff,
  expired/revoked proof and direct API eligibility attempts.
- Manually exercise lookup, focused detail, suspension, driver-facing message,
  restoration blockers, successful restoration, lock during pending actions and
  phone/desktop layout using synthetic accounts only.
- Run lint, both typechecks, relevant regressions and bundle checks; independent
  review before authorized main push and production release. No live person's
  suspension or identity review is a test fixture.

## Preserved broader requirements

This is not the whole operations console or an approval of the legal checklist.
Provider collection/refunds/daily payouts, incident coverage, trip progress and
completion, replacement consent, policy activation and statutory case completion
remain under their existing open issues.
