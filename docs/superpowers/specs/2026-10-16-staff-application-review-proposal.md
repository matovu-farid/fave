# Staff application review proposal

Status: Draft for review. This is not an approved design or an implementation plan.

Related issues: [#7](https://github.com/matovu-farid/fave/issues/7), [#8](https://github.com/matovu-farid/fave/issues/8), [#17](https://github.com/matovu-farid/fave/issues/17).

## Smallest useful next slice

Give staff a clear way to review pending driver and vehicle applications. Keep the
existing booking follow-up and notification operations available. Reuse the app's
current typography, cards, fields, buttons, and mobile layout.

Two approaches are possible:

1. Add application cards and every review form to the existing Admin screen.
   This needs less navigation, but mixes booking calls with identity review and
   makes an already long screen harder to use on a phone.
2. Add separate Drivers and Vehicles review destinations from Admin, each with
   an oldest-first queue and a focused application detail screen. **Recommended:**
   staff can finish one review without losing their place in booking operations.

## Proposed experience

The queue shows the application name or vehicle make/model, submission time,
status, and checklist progress. Do not render identity numbers, evidence images,
phone numbers, or internal review reasons in the routine queue.

Opening an application shows the current submission and its required evidence.
Evidence starts collapsed. A permitted reviewer must record a purpose before
opening private identity details or files. Record that access before returning
the private content. Do not create public file URLs or store evidence in browser
storage, analytics, or error messages.

Review each document with an internal reason. Rejection also requires a separate
driver-facing correction message, clearly labelled so internal notes are not
sent accidentally. Show a review summary before the final application decision.
Approval stays unavailable while the current checklist, policy acceptance,
retention rules, or evidence approvals are incomplete.

After a decision, refresh from the server and return to the queue. If another
reviewer changed the record, explain that the application changed and reload it;
do not overwrite or automatically retry the decision. Preserve unsent notes on
a recoverable network error and prevent double submission.

## Existing support and gaps

The protected driver and vehicle APIs already provide pending queues, audited
private access, document decisions, and application approval/rejection. Driver
suspension is supported by the API, but the pending queue cannot locate approved
drivers. Vehicle suspension has no dedicated endpoint. Neither belongs in this
first pending-application review screen without additional API work.

All these routes currently check an active marketplace administrator membership.
That is not the full least-privilege and strong-authentication model required by
#17. Before exposing private evidence through the new screens, define and enforce
the designated reviewer permission and required reauthentication/MFA on the
server. Hiding a button is not authorization. Do not grant access to the signed-in
test account merely to demonstrate the UI.

Approved verification checklists, client/driver notices, and retention rules
remain prerequisites for real reviews. A prototype must not activate those
policies or create production test applications.

## Validation for a later approved implementation

- Test queue, evidence, and decision authorization using synthetic applications
  in an isolated database, including direct API calls by unauthorized users.
- Verify approvals, correction messages, audit records, changed submissions,
  expired evidence, duplicate submissions, and lost-network recovery.
- Manually test the queue/detail flow at phone and desktop widths, keyboard
  navigation, loading, empty, denied-access, and server-error states.
- Keep #7, #8, and #17 open until their remaining policy and runtime acceptance
  criteria are met. This proposal does not complete the broader staff console.
