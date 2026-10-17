# Driver operations proposal

Status: proposed for owner review, 17 October 2026. No operational rule or
production permission is activated by this document.

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

## Owner decision being requested

If a driver is suspended, should Fave stop new bookings and flag existing
bookings for owner review? The alternative is automatic cancellation. The
recommendation is owner review because cancellation, refunds, replacement and
urgent safety response need their own explicit decisions and working workflows.

Until the owner answers, existing booking handling remains unchanged. This
proposal does not authorize cancellation, refunds, moving money, replacing a
driver/car or sending a new promise to a client.

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
