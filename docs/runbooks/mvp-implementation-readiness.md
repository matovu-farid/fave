# MVP implementation and launch gap map

Inspected 17 October 2026 at main
`794b42e49bc59c75c72200f2593ae7a111e54954`. This is a source/evidence map for
continuing the full GitHub scope, not a launch approval or a replacement for the
acceptance criteria in each issue. An existing schema, passing isolated test or
rendered screen does not prove the entire corresponding workflow is complete.

## Verified baseline

- Main and origin/main match. No open GitHub pull request was returned by the
  repository's open-PR query; no local merge is waiting.
- [CI39002736750](https://github.com/matovu-farid/fave/actions/runs/39002736750)
  passed 389 tests, zero failures/skips, lint, app/Worker typechecks and iOS,
  Android and web exports for the inspected source.
- Worker/web `99c6a084-5a41-474e-9d17-23db7f082b5a` serves 100% through
  deployment `f5abe03c-d705-46b8-a91d-56bb750fa503`. D1 migration0023 is
  applied; both cleanup guards match source and no migration remains pending.
  Production health/database pass and anonymous staff APIs reject access.
- Aggregate production checks recorded zero driver applications, evidence,
  vehicles and cleanup jobs, and zero active fare/retention policies. Synthetic
  fixture settings and policy acknowledgements are not production approvals.
- Signed iPhone development build `3f7f2e73-aee2-44bd-b364-f267d4a45ae3` is
  finished, with matching Apple Sign In and push entitlements in the app/profile.
  Installing that build and observing native notification delivery remain
  unverified. Earlier device sign-in/sign-out observations are not a push test of
  the newer binary. See [the device runbook](ios-device-build.md).

The account-download addition was subsequently released from source `fed74ce`.
[Its CI](https://github.com/matovu-farid/fave/actions/runs/39018021304) passed
472 tests with zero failures/skips, lint, both typechecks and all platform bundles.
Synthetic browser checks covered private client/driver archives, own retained ID
bytes, renewed sign-in, and protected owner follow-up. Production smoke checks
created no real export. The original inspected baseline above remains historical;
this addition does not establish full launch or statutory-case completion.

The staff-review revocation repair subsequently passed
[CI39019652939](https://github.com/matovu-farid/fave/actions/runs/39019652939)
with606 tests, zero failures/skips and all platform/check gates. Browser tests
verified ordinary approval and locking during a delayed private-file request.
The repair is released; wider operations-console requirements remain open.

The booking-operations lifecycle repair subsequently passed
[CI39021711184](https://github.com/matovu-farid/fave/actions/runs/39021711184)
with 627 tests, zero failures/skips and all check/bundle gates. Contacts and
pending actions are scoped to the focused account/session, late responses cannot
restore old details, settled decisions reconcile after returning, and staff API
responses carry explicit cache protection. Synthetic browser call-to-quote and
contact-clearing checks passed at desktop and phone widths. The repair is
released; it does not implement the proposed suspension/recovery workflow.

The booking-copy correction subsequently passed
[CI39022349089](https://github.com/matovu-farid/fave/actions/runs/39022349089)
with 627 tests and all checks. Empty legacy-offer sections no longer describe the
new staff-check workflow; real earlier offers retain their controls and deadlines.
The web correction is released and manually reviewed with synthetic accounts.

## Open issue coverage and remaining work

Every issue below remains open. “Present” identifies implementation to preserve,
not a conclusion that all of its acceptance criteria have passed.

| Issue | Present source/evidence | Remaining work or evidence |
| --- | --- | --- |
| [#5](https://github.com/matovu-farid/fave/issues/5) Service rules | `google-maps.ts`, `trip-dates.ts`, server validation in `bookings.ts`; Maps/date regressions. | Final live fare/deposit/policy configuration and readiness evidence; do not turn a proposed deposit default into an approved rule. |
| [#6](https://github.com/matovu-farid/fave/issues/6) Driver application | `drivers.ts`, Driver screen, private uploads, correction/resubmission and saved retention snapshots; browser/test evidence in the retention plan. | Actual current legal/checklist activation and full lawful retention/rights lifecycle; no real driver enrollment is established by synthetic tests. |
| [#7](https://github.com/matovu-farid/fave/issues/7) Driver verification | Owner-only review/MFA, checklist decisions/audit, approved/suspended roster, guarded suspension/restore/corrections and durable booking-review flags; focused SQL/browser evidence in the driver-operations plan. | Regulator/counsel eligibility evidence, live checklist/policy readiness and real operating procedures remain required. |
| [#8](https://github.com/matovu-farid/fave/issues/8) Vehicle listings | `vehicles.ts`, approval/private media, approved public derivatives, date holds and driver availability UI/tests. | Live required evidence/checklist/retention configuration, public-photo operational review and complete legal/incident procedures. |
| [#9](https://github.com/matovu-farid/fave/issues/9) Estimates | Saved per-car benchmark, separate routed legs, registered lodging rate, immutable snapshots and fixed-price staff quote conversion. | Approved canonical benchmark endpoints/distance and live rate/policy readiness; accepted extension workflow/payment beyond the pure saved-rate calculation. |
| [#10](https://github.com/matovu-farid/fave/issues/10) Booking journey | Trips UI and `bookings.ts`: estimate → staff request → same-price quote → disclosures/contact consent → atomic expiring deposit hold. Synthetic browser journeys documented. | Actual provider checkout, verified payment, post-deposit state, disclosures activated only after required readiness, and new device walkthrough. A deposit hold is not a collected deposit. |
| [#11](https://github.com/matovu-farid/fave/issues/11) Payments | Deposit amount/hold snapshots and notification contracts; no provider payment integration/router/ledger is registered. | Recorded provider selection/onboarding and accepted operating rules, collections/refunds/daily payouts, signed idempotent webhook processing, ledger/reconciliation, receipts and sandbox/live readiness. |
| [#12](https://github.com/matovu-farid/fave/issues/12) Assignment/contact | Fixed driver/car estimate and staff call/confirmation/date holds; pending requests create no driver offer/payment. | Verified-deposit assignment/contact release and later approved replacement path. Client booking reads do not currently expose a released driver contact. |
| [#13](https://github.com/matovu-farid/fave/issues/13) Trip/completion | Client booking list/detail and saved fare calculation helpers. Booking schema currently has deposit_pending/confirmed/cancelled/expired only. | Trip start/progress, assigned-driver itinerary, completion claim/client response, disagreement/operations resolution and provider balance/receipt. Completion window, due events and reconciliation rules need decisions. |
| [#14](https://github.com/matovu-farid/fave/issues/14) Legal/privacy | Finished disclosure source and adversarial drafting review; private evidence/MFA/audit and durable expiry cleanup/guards. | Recorded exact-version and operating/legal readiness, licensing/insurance/tax/privacy decisions, retention categories/holds/access windows/necessity reviews/backups and functioning rights requests. Written notices are not deployed procedures. |
| [#15](https://github.com/matovu-farid/fave/issues/15) Commercial rules | Owner-confirmed fixed estimate, 24h/30m holds, UGX nearest rounding, all-in processing fees, registered lodging rate and morning daily-pay direction. | Benchmark reference, provider fees/tax treatment, deposit setting, daily pay components, completion/balance/dispute events, no-show/reconciliation/exception rules and safe driving/rest arrangements. |
| [#16](https://github.com/matovu-farid/fave/issues/16) Provider | `payment-provider-requirements.md` and researched provider review. | Recorded choice, actual merchant eligibility/terms/fees, Uganda collection/payout rails, funds flow, operating balance and sandbox evidence. No authority to contact/accept provider terms or move funds is inferred from the brief. |
| [#17](https://github.com/matovu-farid/fave/issues/17) Operations | Staff availability queue, separate application reviews, ten-minute MFA, transaction-bound review revocation with cancelled private transfers, and notification health/retry. | Suspension/recovery operation, payment exceptions, incident queue, policy/rate lifecycle, rights requests and protected investigation/export. Existing review screens are not the entire admin console. |
| [#19](https://github.com/matovu-farid/fave/issues/19) Safety | Published-source safety copy and versioned notification contracts. No incident/check-in store or incident router exists. | Approved support coverage/escalation/rest/check-in/replacement rules, reporting and protected incident workflow, missed-check-in records/alerts, replacement consent and actual operational exercises. |
| [#20](https://github.com/matovu-farid/fave/issues/20) End-to-end launch | CI, multiple synthetic browser journeys, signed artifact and deployment checks. | Full paid client/driver/operations journey, incident/completion/refund/dispute cases, newer physical-device evidence and responsible go/no-go sign-off. Remains a launch blocker. |
| [#21](https://github.com/matovu-farid/fave/issues/21) Accounts | Shared identity/separate profiles, consent/version snapshots and sign-out recovery; private-file cascade guard; durable deletion receipt, immediate new-work restrictions and preserved existing-trip access, with protected paginated owner intake; automatic fresh-sign-in private ZIPs, owned retained uploads and tracked exceptional access follow-up. | Full statutory access-case completion and actual erasure, retained-record categories, legal holds, external processors and backup handling. See [investigation](../superpowers/specs/2026-10-17-account-request-investigation.md). |
| [#22](https://github.com/matovu-farid/fave/issues/22) Notifications | Durable inbox, D1 outbox, Queue/DLQ, token ownership, Expo adapter/receipts, quiet hours and admin recovery. | Native APNs configuration/observed delivery and domain producers for payments, trip progress/completion and incidents as their owning modules are implemented. No automatic notification-history cleanup is approved. |

Issue #31's staff follow-up workflow is closed with its recorded evidence. Keep
its broader payment/contact/safety dependencies in the open owning issues rather
than reopening a completed, narrower issue or calling the launch complete.

## What would prove the remaining launch journey

1. **Client journey:** real approved prerequisites and legal versions, eligible
   route/car, saved estimate, staff reached-call confirmation, exact-price quote,
   expiring holds, explicit disclosures/contact consent, provider-verified deposit,
   authorized assignment/contact release, trip/completion, balance and receipt.
2. **Driver journey:** lawful onboarding and approval, public vehicle review,
   availability, confirmed trip/itinerary and notifications, progress/incident
   reporting, completion claim and verified daily payment records.
3. **Role/account lifecycle:** one identity with isolated client/driver/staff
   purposes, request ownership, immediate new-work blocks, selected existing-trip
   access behavior and actual retained-record/rights fulfillment.
4. **Safety:** approved itinerary/work/rest limits and overnight arrangements;
   late trip/rest change, missed check-in, escalation, incident and consented
   replacement exercised without relying on continuous GPS.
5. **Payment integrity:** provider-signed duplicate/delayed/out-of-order events,
   failed/expired holds, late successful collection, cancellation/refund/dispute,
   no-driver-after-deposit remedy, reconciliation and safe payout retries.
6. **Operational privacy:** least-privilege access, audit/reason history, current
   document acceptance, lawful retention/holds, backup/restoration restrictions,
   secure support, incident response and authorized export/deletion fulfillment.
7. **Release acceptance:** supported native-device push and auth regression,
   provider sandbox evidence, owner/operator readiness, rollback/support details
   and explicit go/no-go. Green CI does not establish these outcomes.

## Current next step

Automatic account downloads are released. The owner's account-deletion choices
are recorded above: stop new work immediately and preserve existing-trip access.
Actual erasure and exceptional statutory-case completion remain open.

The current operations implementation adds approved-driver lookup, suspension and recovery
under #7/#17. The [concrete proposal](../superpowers/specs/2026-10-17-driver-operations-proposal.md)
records the current code gap and implementation checks. The owner confirmed:
**suspension stops new bookings and flags existing bookings for owner review.**
The concrete design adds a separate driver-operations screen and durable booking
review flags, preserving booking state and requiring an explicit review outcome.
The owner approved the written design and requested implementation on main with browser testing. The implementation now passes local tests and independent review; exact-source CI and production release checks are the remaining gates.

Apple notification-key management remains separately pending specific
authorization after an automatic approval-review rejection; do not enter
credential-management menus as a read-only workaround.

Provider choice, commercial completion/payment rules, safety coverage and exact
operating/legal readiness remain distinct decisions. Do not fill them with new
defaults, activate policies, invent a payment provider or treat the 389-test
baseline as permission to accept public trips.

## Decision-wait audit and resumption — 17 October 2026

A fresh repository query returns the same 17 open MVP issues and no open PR.
The scope/evidence table above still applies; the released repairs do not close
those broader requirements. No currently approved implementation is queued
behind a running test/build/deployment for these releases.

The suspension/existing-booking question was unanswered during the
driver-operations proposal, Operations lifecycle repair and booking-copy repair.
The independent work found during that wait was completed and released. The
owner has now answered, resolving that blocker. Continue the driver-operations
design and implementation workflow using the confirmed rule. Cancellation,
refund and replacement remain separate decisions; the answer does not authorize
those actions.

Other remaining feature dependencies are distinct, not substitutes for that
answer: #11/#16 require a chosen/eligible provider and confirmed funds flow;
#13/#15 need completion, balance, no-show and daily-pay operating decisions;
#19 needs support/rest/check-in/escalation and replacement procedures; #14/#21
need the actual retention/holds/erasure and exact operating-readiness decisions;
#20 needs the paid end-to-end journey and device evidence. #22 still needs the
separately pending Apple key authorization/device check and events from those
unimplemented domains. The proposal and existing research are ready for owner
decisions; do not treat waiting as approval or start financial/credential actions
to manufacture progress. The full goal is not complete.

## Driver operations implementation — 17 October 2026

The approved [driver operations plan](../superpowers/plans/2026-10-17-driver-operations.md)
adds owner lookup, version-guarded suspension, restoration and corrections, plus
atomic active-booking review flags. Existing booking state/price/consent and client
access stay unchanged. Restoring or correcting a driver does not close open flags;
an explicit audited review outcome closes only the flag. Safe queues omit private
reasons and contact/location details; focused records and reviewed history require
the existing ten-minute verification. Owned operational metadata is accounted for
in automatic exports; private notes require individual access assessment.

Local checks pass 665 tests, zero failures/skips, lint, app/Worker typechecks and
production web export. Independent backend and UI reviews have no outstanding
findings. Synthetic phone/desktop browser checks exercised suspension, restoration,
corrections, preserved bookings/flags, review outcomes and lock/draft clearing.
Exact-source CI and production release evidence will be recorded after publishing.
This completes this bounded feature, not the broader #7/#17 operating or launch
requirements. No cancellation, refund, replacement or payment execution is added.
