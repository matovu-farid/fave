# Account export and deletion request investigation

**Status: baseline investigation; approved intake/access slice now implemented separately.**
Issue [#21](https://github.com/matovu-farid/fave/issues/21). Source inspected at
`794b42e49bc59c75c72200f2593ae7a111e54954`; all work remains on main.

## Confirmed decisions

- One Better Auth identity can hold both client and driver profiles. Neither
  profile grants the permissions of the other or of staff.
- Submitting an account-deletion request must immediately stop new client
  bookings and new driver assignments for that identity.
- Signing out is not a deletion request. Neither answer authorizes automatic
  trip cancellation or raw deletion of the Better Auth identity.
- On 17 October 2026 the owner confirmed: keep existing-trip access until those
  trips and payments are finished. New work stops immediately; authentication,
  existing-trip access and payment/support resolution remain available.

## Investigation baseline and verified limitations

At the inspected baseline, `src/components/account-screen.tsx` loads the two role profiles, permits current
client-profile updates, and signs out. Its Account access card states that export
and deletion requests are not available. `src/lib/marketplace.ts` has no request
intake/status helpers. The route registration in `fave-worker/src/index.ts` and
the migrations contain no account-request API or durable closure state.

`getSignedInUser` in `marketplace-auth.ts` resolves authentication only. It is
also used by existing-trip reads and unrelated recovery actions. Making that
function return null for every deletion request would impose a blanket loss of
access and would contradict the subsequently confirmed existing-trip access decision.

Actual migration-backed experiments show why raw identity deletion is unsuitable:
an unbooked driver deletion previously cascaded away private file metadata with
no cleanup jobs; a booked-client deletion failed on other foreign keys. Migration
0023 now rejects file-row DELETE/cascades without exact matching durable jobs.
It protects cleanup references; it does not implement account requests, a lawful
retention decision, legal holds or fulfillment. See the
[retention repair evidence](../plans/2026-10-17-private-evidence-retention.md).

## Proposed implementation boundaries

### Request intake and status

Use a separate durable request record owned by the authenticated identity, rather
than deleting the sign-in record or overloading a driver approval state. Record
request type, opaque reference, original submission time and status. Repeated
submissions should return the same open request and must not reset its original
time or remove restrictions. Treat a shared client/driver identity as one account.

The Account screen should explain the effect before confirmation and then show
the saved reference/status. A failed submission must remain retryable without
claiming a saved request. An export request alone should not disable new work;
this is a proposed distinction for the final design, not an implemented rule.

### New-work restrictions and races

The deletion-request record and its submission audit must commit together. New
business writes must check the durable state at their actual mutation, rather
than relying on a hidden button or a check made before external routing work.
If the request commits first, the new-work write loses. If the booking commits
first, it is an existing record governed by the owner's existing-trip decision.

| Current entry point | Restriction that the final design must cover |
| --- | --- |
| `bookings.ts`: POST `/estimates/:estimateId/availability-request` | Do not create a new client booking-intent request for an account awaiting deletion; validate the selected driver's eligibility too. |
| `admin-availability-requests.ts`: POST `/:requestId/confirm` | Recheck both identities before creating a quote/date hold, including requests submitted before the deletion request. Return a clear conflict to staff. |
| `bookings.ts`: POST `/confirm` | Prevent a saved quote becoming a new booking/deposit hold after either identity requests deletion. A pre-existing quote must not bypass the restriction. |
| `bookings.ts`: retained legacy offer acceptance/quote writes | Do not create a new driver commitment through a retained older endpoint. Keep new legacy offer creation retired. |
| `vehicles.ts`: catalogue and selection/availability checks | A driver's cars must not remain selectable for new work after that driver requests deletion. Recheck direct IDs, not only catalogue visibility. |
| `availability-requests.ts`: current eligibility/needs-review predicate | Surface affected pre-booking requests to staff and stop the client proceeding to payment; preserve the saved car and price rather than substituting either. |

Existing records, document acceptances, consent evidence and saved quotes must
not be erased or repriced by submitting the request. A fresh social sign-in,
profile edit, resubmission or delayed callback must not silently remove the
durable restriction. Existing-trip reads, payment resolution, support and
sign-out remain available under the owner’s confirmed access decision.

### Fulfillment is part of the full issue

Request intake and new-work restrictions alone do not complete #21. The final
workflow also needs protected staff case handling, audited status changes, a
safe way to verify the requester and deliver an export, lawful record/category
retention decisions, scoped holds, backup handling and a truthful result notice.
Do not add an unrestricted “mark deleted” action or describe a request as fully
deleted while identifiable backup copies remain.

The existing notices require proportionate identity checks, restricted retained
records, reasons for lawful exceptions and a response route. They are not proof
that category retention, holds, exports or backup cleanup exist in the app.
Staff review MFA currently applies only to designated reviewers; do not reuse it
as a public customer enrollment mechanism without a separate reviewed design.
No new retention periods, provider/payout behavior or legal approval is selected
by this investigation.

## Required evidence before claiming the workflow complete

- Signed-out/cross-account attempts cannot create, read or alter another person's
  request. Duplicate submission cannot create inconsistent closure state.
- Deletion-request submission and new client/driver work race in both orders;
  SQL guards prove the winning order and no orphan quote/hold/notice is created.
- Saved estimates/quotes, direct car IDs, staff confirmation and legacy offer
  acceptance cannot bypass the restrictions. Existing records remain intact.
- The selected existing-trip access behavior is verified for both roles and
  does not silently cancel trips or discard payment/refund evidence.
- Request status, verification, export delivery, retained-record reasons, holds,
  fulfillment and user notification have real authorized implementation and
  evidence. No screen or passing intake test substitutes for these requirements.
- Manually test Account confirmation, repeated submission, refresh/sign-in,
  error/retry and affected client/driver/staff journeys in the browser; run lint,
  app/Worker typechecks and meaningful migration-backed regressions on main.

The existing-trip access question is answered. The approved restriction/access
behavior is implemented separately from retention-aware final fulfillment; this
investigation does not authorize policy activation or raw identity deletion.

## Delivered intake/access slice

See the [implementation plan and evidence](../plans/2026-10-17-account-deletion-request.md).
The app now provides a durable deletion receipt, atomic new-work restrictions,
preserved existing reads/decline and a protected paginated owner queue. Export
requests still use the disclosed support email; final erasure/export fulfillment
and retention/hold/backup decisions remain outstanding in #21/#14.
