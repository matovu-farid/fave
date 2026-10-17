# Fave payment-provider requirements

**Prepared:** 17 October 2026 · **Business:** FIDEXA ENTERPRISES - SMC LIMITED

Ugandan single member company, registration **80034103105807**. Registered office:
Zone D, Makerere 2, Kawempe Division, Kampala, Central Region, Uganda.
Contact: **farid@fidexa.org**, **+256 705 222 144**.

Fave supplies private-car long-distance trips within Uganda through the agreed
car and driver, with pickups in Kampala, Wakiso or Mukono and trips up to seven
days. Fave promises
the trip as principal; it is not presenting a driver-only contract or an
accommodation marketplace. We need a written merchant offer for the following
operating flow before selecting a provider.

## Confirmed operating requirements

| Area | Fave requirement | Written response and validation needed |
|---|---|---|
| Client collections | UGX via MTN Mobile Money, Airtel Money and local cards for separate deposit, balance and accepted added-night transactions. Client prices use nearest-whole-shilling rounding. | Enabled methods, API amount representation, limits, eligibility, hosted checkout, settlement destination and schedule. Demonstrate that each transaction charges exactly its accepted integer-UGX amount. |
| Booking sequence | Client sees a saved estimate first. After client intent, staff call the driver and confirm the specific car/dates at that saved price. The quote hold lasts 24 hours. Starting deposit checkout replaces it with a separate 30-minute hold. | A payment attempt can be correlated with its quote, booking and hold. Explain pending, late, failed and duplicate payment handling, status verification and safe refund/reconciliation paths. A redirect alone cannot confirm payment or restore an expired vehicle hold. |
| Client processing fees | Processing fees are included in the saved quoted total. No additional checkout processing fee is permitted. | Itemized merchant rates, taxes, reserves, minimums and fee-bearing settings. Test each enabled payment method and required collection transaction for exact-total charging, including provider defaults. |
| Accepted trip extensions | Added lodging nights use the nightly rate saved in the accepted quote. After availability checks and client acceptance of the amendment, collect payment for added nights immediately when the client accepts. | Correlate the added-night payment with the original booking and amendment revision. Verify its exact accepted amount, pending/failed outcomes, duplicate-safe retries and refunds. Reconcile it with deposit and balance records so the client is not charged twice for added nights. |
| Driver pay | Fave pays the driver's full itemized pay for each trip day in the morning from Fave's business funds. The daily total includes that day's applicable lodging fee, using the driver's registered nightly rate saved with the trip. Lodging can be any suitable kind; Fave does not arrange client accommodation. | Available payout rails, eligibility/KYC, funding account and available-balance rules, cutoffs, weekends, limits, costs/deductions, failure states, retry/idempotency guarantees and reconciliation evidence. Explain the prefunding/working-capital requirement independently of client settlement timing. |
| Ending a trip | A valid daily payment already sent remains with the driver if the trip is cancelled. Future daily payments stop when the trip ends. Trip-end reconciliation checks records; no routine additional driver balance is planned. | State whether and when pending/scheduled transfers can still be stopped, how a transfer's actual outcome is proved, and how an ambiguous result is resolved before retry. A technical cancellation is not proof money was never sent. |
| Client refunds and disputes | Fave must support applicable client remedies and mandatory deadlines, including a full deposit refund if it cannot provide the accepted car and driver and refunds of other prepaid amounts where required. A driver payment does not reduce the client's remedy. | Full/partial refunds per rail, original-payment linkage, refund funding, final status reporting, processing/refund fees, timelines, chargeback evidence and deadlines. Separate provider costs retained from the amount Fave owes the client; identify how Fave can meet a mandatory deadline if the ordinary provider route is too slow. |
| Integration and evidence | Hono on Cloudflare Workers, Expo clients and hosted checkout. Credentials stay on the backend; Fave does not collect raw card details. | Applicable API version and Uganda endpoints, sandbox access, signature verification over the original webhook body where required, retries, idempotency, transaction status re-query, exports and support escalation. Confirm any static-egress/IP-allowlist requirement and the approved deployment arrangement. |

## Commercial and regulatory response

Identify the full contracting/acquiring entity, the Uganda-authorized entity or
licensed partner, each entity's role and the service scope of its current
authorization. Assess this disclosed principal merchant and business-funded daily
payment flow explicitly. A brand, advertised UGX support or generic split-payment
feature does not establish approval of Fave's account or the legal treatment of
the actual arrangement.

Provide the current agreement, a completed Fave-specific fee/settlement schedule,
data-processing terms, reserve/hold/termination rights, and the required business,
beneficial-owner and operating-licence documents. Identify any requirements still
subject to compliance or underwriting review. Fave will reconcile the offer with
its legal and tax assessment before accepting it.

The exact deposit percentage, full daily-pay components, commission and exceptional
adjustments remain to be finalized. State supported constraints; do not substitute
a provider default for a settled client price or assume a payout rail has already
been chosen. Quotes retain their original calculation. Changes to an accepted
trip require the client's accepted amendment.

## Evidence required before integration and launch

Record provider selection and written approval of the exact arrangement, then
use test credentials to verify deposit and balance on each enabled rail, immediate
added-night collection for an accepted amendment, pending/failure/duplicate/
out-of-order events, wrong amount or currency, status re-query, refunds, a daily
payout and its retry/failure evidence, and end-to-end reconciliation. Publish the
enabled provider and customer-relevant terms before
live checkout. Use the approved operating and regulatory prerequisites from
issues #14–#16; this brief neither selects a provider nor accepts its agreement.

Companion sources: [provider comparison](uganda-payment-provider-review.md),
[client payment policy](client-payment-policy.md),
[client terms and privacy](client-terms-and-privacy-notice.md), and
[driver agreement](driver-service-agreement.md).
