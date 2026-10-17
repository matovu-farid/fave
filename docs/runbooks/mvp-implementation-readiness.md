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

## Open issue coverage and remaining work

Every issue below remains open. “Present” identifies implementation to preserve,
not a conclusion that all of its acceptance criteria have passed.

| Issue | Present source/evidence | Remaining work or evidence |
| --- | --- | --- |
| [#5](https://github.com/matovu-farid/fave/issues/5) Service rules | `google-maps.ts`, `trip-dates.ts`, server validation in `bookings.ts`; Maps/date regressions. | Final live fare/deposit/policy configuration and readiness evidence; do not turn a proposed deposit default into an approved rule. |
| [#6](https://github.com/matovu-farid/fave/issues/6) Driver application | `drivers.ts`, Driver screen, private uploads, correction/resubmission and saved retention snapshots; browser/test evidence in the retention plan. | Actual current legal/checklist activation and full lawful retention/rights lifecycle; no real driver enrollment is established by synthetic tests. |
| [#7](https://github.com/matovu-farid/fave/issues/7) Driver verification | Owner-only review/MFA, checklist decisions/audit, API supports suspension. | Approved-driver operational suspension/recovery UI and review procedure; regulator/counsel eligibility evidence. Pending-application review screens do not supply this whole workflow. |
| [#8](https://github.com/matovu-farid/fave/issues/8) Vehicle listings | `vehicles.ts`, approval/private media, approved public derivatives, date holds and driver availability UI/tests. | Live required evidence/checklist/retention configuration, public-photo operational review and complete legal/incident procedures. |
| [#9](https://github.com/matovu-farid/fave/issues/9) Estimates | Saved per-car benchmark, separate routed legs, registered lodging rate, immutable snapshots and fixed-price staff quote conversion. | Approved canonical benchmark endpoints/distance and live rate/policy readiness; accepted extension workflow/payment beyond the pure saved-rate calculation. |
| [#10](https://github.com/matovu-farid/fave/issues/10) Booking journey | Trips UI and `bookings.ts`: estimate → staff request → same-price quote → disclosures/contact consent → atomic expiring deposit hold. Synthetic browser journeys documented. | Actual provider checkout, verified payment, post-deposit state, disclosures activated only after required readiness, and new device walkthrough. A deposit hold is not a collected deposit. |
| [#11](https://github.com/matovu-farid/fave/issues/11) Payments | Deposit amount/hold snapshots and notification contracts; no provider payment integration/router/ledger is registered. | Recorded provider selection/onboarding and accepted operating rules, collections/refunds/daily payouts, signed idempotent webhook processing, ledger/reconciliation, receipts and sandbox/live readiness. |
| [#12](https://github.com/matovu-farid/fave/issues/12) Assignment/contact | Fixed driver/car estimate and staff call/confirmation/date holds; pending requests create no driver offer/payment. | Verified-deposit assignment/contact release and later approved replacement path. Client booking reads do not currently expose a released driver contact. |
| [#13](https://github.com/matovu-farid/fave/issues/13) Trip/completion | Client booking list/detail and saved fare calculation helpers. Booking schema currently has deposit_pending/confirmed/cancelled/expired only. | Trip start/progress, assigned-driver itinerary, completion claim/client response, disagreement/operations resolution and provider balance/receipt. Completion window, due events and reconciliation rules need decisions. |
| [#14](https://github.com/matovu-farid/fave/issues/14) Legal/privacy | Finished disclosure source and adversarial drafting review; private evidence/MFA/audit and durable expiry cleanup/guards. | Recorded exact-version and operating/legal readiness, licensing/insurance/tax/privacy decisions, retention categories/holds/access windows/necessity reviews/backups and functioning rights requests. Written notices are not deployed procedures. |
| [#15](https://github.com/matovu-farid/fave/issues/15) Commercial rules | Owner-confirmed fixed estimate, 24h/30m holds, UGX nearest rounding, all-in processing fees, registered lodging rate and morning daily-pay direction. | Benchmark reference, provider fees/tax treatment, deposit setting, daily pay components, completion/balance/dispute events, no-show/reconciliation/exception rules and safe driving/rest arrangements. |
| [#16](https://github.com/matovu-farid/fave/issues/16) Provider | `payment-provider-requirements.md` and researched provider review. | Recorded choice, actual merchant eligibility/terms/fees, Uganda collection/payout rails, funds flow, operating balance and sandbox evidence. No authority to contact/accept provider terms or move funds is inferred from the brief. |
| [#17](https://github.com/matovu-farid/fave/issues/17) Operations | Staff availability queue, separate application reviews, ten-minute MFA and notification health/retry. | Suspension/recovery operation, payment exceptions, incident queue, policy/rate lifecycle, rights requests and protected investigation/export. Existing review screens are not the entire admin console. |
| [#19](https://github.com/matovu-farid/fave/issues/19) Safety | Published-source safety copy and versioned notification contracts. No incident/check-in store or incident router exists. | Approved support coverage/escalation/rest/check-in/replacement rules, reporting and protected incident workflow, missed-check-in records/alerts, replacement consent and actual operational exercises. |
| [#20](https://github.com/matovu-farid/fave/issues/20) End-to-end launch | CI, multiple synthetic browser journeys, signed artifact and deployment checks. | Full paid client/driver/operations journey, incident/completion/refund/dispute cases, newer physical-device evidence and responsible go/no-go sign-off. Remains a launch blocker. |
| [#21](https://github.com/matovu-farid/fave/issues/21) Accounts | Shared identity/separate profiles, consent/version snapshots and sign-out recovery; private-file cascade guard. | Durable export/deletion requests/status, immediate new-work restrictions, existing-trip access decision, protected fulfillment and retained-record/hold/backup handling. See [investigation](../superpowers/specs/2026-10-17-account-request-investigation.md). |
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

The immediate engineering sequence is account request design and restrictions,
with the owner's existing-trip access answer first. Only one owner question is
being pursued at a time. Apple notification-key management remains separately
pending specific authorization after an automatic approval-review rejection;
do not enter credential-management menus as a read-only workaround.

Provider choice, commercial completion/payment rules, safety coverage and exact
operating/legal readiness remain distinct decisions. Do not fill them with new
defaults, activate policies, invent a payment provider or treat the 389-test
baseline as permission to accept public trips.
