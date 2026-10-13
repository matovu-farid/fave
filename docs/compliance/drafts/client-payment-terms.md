# Fave Client Payment Terms

**Status:** Internal client-payment terms, prepared 12 October 2026 and updated 13 October 2026. The owner reports that counsel has approved the payment-provider terms. This document records how Fave's current product decisions would be explained to clients; it is not an executed provider offer and is not effective for customer transactions until the launch items below are completed and the exact version is shown before payment.

**Counsel review:** The owner confirms counsel approved the payment-provider terms on 12 October 2026. The written advice has not been attached to this repository. That approval is recorded separately from provider selection, signature and onboarding, the final merchant/funds-flow configuration, provider-specific fees and refund capabilities, and any required regulatory approvals.

**Related records:** [MVP booking policy](../../policies/mvp-booking-policy-draft.md), [Uganda payment-provider review](../../policies/uganda-payment-provider-review.md), [client terms and privacy draft](client-terms-and-privacy-notice.md), GitHub issues [#14](https://github.com/matovu-farid/fave/issues/14), [#15](https://github.com/matovu-farid/fave/issues/15), and [#16](https://github.com/matovu-farid/fave/issues/16).

## 1. Who takes payment

Fave will show the legal name of the merchant receiving each payment, the transport-service provider, and Fave's role before the client confirms an order. **The merchant and contracting model are not yet fixed.** Pesapal Uganda Limited has confirmed by email that its Uganda service supports online MTN Mobile Money, Airtel Money, and bank-card collection in UGX, subject to Fave's onboarding, KYC, and compliance review. Pesapal has asked Fave to clarify whether Fave acts as principal or marketplace/intermediary before it confirms the appropriate settlement and KYC structure.

Until Fave has selected a provider and confirmed the actual merchant and funds flow in writing, this draft does not promise that Pesapal (or another named provider) will process a particular booking. Fave will offer only payment methods that are enabled for the actual merchant account and displayed at checkout.

## 2. Price and payment schedule

Before the client places an order or starts payment, Fave will show the accepted trip details, the total price in UGX, the amount due now, any remaining balance and when it is due, and any applicable taxes or fees. The total shown at confirmation is the amount the client authorizes. Fave will not add an undisclosed payment surcharge at checkout.

The current product direction is to request a configurable deposit, with a default of 50% of the accepted quote. The remaining balance is due after the trip is complete. The precise deposit amount and due time will be displayed on the accepted quote; this draft does not itself make the 50% default effective. The final balance will be shown to the client before it is charged. A disputed completion or amount pauses collection until Fave records an operations decision.

The client may pay using MTN or Airtel mobile money or a local bank card when the selected method is available for that payment. The deposit and balance are separate transactions. Fave will record the provider reference, amount, currency, payment stage, status, and timestamp against the booking and provide a receipt or in-app payment record.

## 3. Trip changes and added nights

Fave will not silently increase an accepted total. If the client asks to add accommodation nights during a trip, Fave will calculate the added amount using the per-night rate saved in the accepted quote, show the number of added nights and the revised total, and ask the client to accept before amending the booking. When the client accepts, payment for the added nights is due immediately using a method then available. The booking record will retain the original accepted quote and calculation inputs, the revised quote, the client's acceptance, and the resulting payment reference.

Other changes that affect price or service require a revised quote and the client's acceptance before the change is charged or applied. A provider, driver, or Fave cannot add an amount that was not shown and accepted through this process.

## 4. Payment processing and confirmation

Payment is not complete merely because a client has opened a provider page, approved a mobile-money prompt, or returned to Fave. Fave will treat payment as received only after it verifies the transaction with the provider and records a successful status. If a payment is pending, Fave will show that status and will not ask the client to pay again until the result has been checked. If a payment fails or expires, Fave will explain the next step and show any new amount or quote before another attempt.

Payments are processed by the provider and the client's bank, card issuer, or mobile-money operator. Their security checks, service availability, and processing times may affect the transaction. Fave will not ask a client to send a card PIN, mobile-money PIN, password, or one-time authentication code to Fave by chat, email, phone, or support form. The client should enter authentication details only into the payment method's own secure prompt.

## 5. Refunds, cancellations, and reversals

The amount a client may receive back depends on the approved cancellation, trip-change, and service-failure policy shown before payment and any rights the client has under applicable law. **Owner-confirmed schedule recorded 13 October 2026:** refund the full deposit for cancellation at least 72 hours before pickup; refund half of the deposit for cancellation at least 24 but less than 72 hours before pickup; and do not refund the deposit for cancellation less than 24 hours before pickup. A client who does not appear for the agreed pickup without cancelling forfeits the deposit. If Fave cancels or cannot provide an eligible driver and vehicle, the client receives a full refund of all payments. These rules require Ugandan counsel's review and approval before publication or collection. The no-show point, including any grace period and contact attempt, must be defined before launch. Partial-performance treatment, refund timing, and treatment of provider fees also remain open. Fave will not describe a payment as non-refundable or deduct a provider fee from a refund unless the applicable rule has been disclosed and approved.

When a refund is approved, Fave will initiate it through the original payment route where supported and will show the refund amount, initiation date, and status. The provider or financial institution controls the final posting time. If the original method cannot accept the refund, Fave will contact the client to confirm a lawful alternative before paying by another route. A pending refund is not represented as completed until the provider confirms it.

If a client does not recognize a charge or believes a payment was taken incorrectly, contact Fave using the support details shown in the app and include the booking or receipt reference. This does not limit the client's right to contact their bank, card issuer, mobile-money operator, regulator, or other appropriate body.

## 6. Provider-specific information and availability

Fave currently has a Pesapal Uganda merchant sign-up pack and merchant-contract template, but has not signed it or received a completed merchant-specific fee schedule. Pesapal's 6 October 2026 response says the required collection methods are supported, subject to onboarding, and states that its commercial and compliance teams must first review Fave's merchant-versus-marketplace model. It describes settlement, driver payouts, refunds, and chargebacks as matters to confirm after that review. The accompanying rate details are incomplete or inconsistent with the unfilled schedule, so no rate, tax treatment, settlement time, reserve, or refund fee from those materials is promised to the client here.

If Pesapal is selected and activated, Fave will update this policy with the provider's confirmed role, enabled payment methods, disclosed fees, refund route, and other customer-relevant processing information before accepting live payments. The provider's separate merchant contract governs Fave's relationship with that provider; it does not replace the client-facing booking terms or reduce any client rights.

## 7. Records and support

Fave will keep an auditable record of each accepted quote and revision, the calculation inputs, the policy version, the payment stage and provider reference, provider status changes, receipts, and any refund or dispute decision. Payment credentials and authentication secrets will not be stored in booking records.

For payment questions or errors, use **[in-app support route / support email / telephone]** and provide the payment receipt or booking reference. Fave will acknowledge the request and explain the next step. The final published terms must identify the responsible support contact and its operating hours.

## 8. Required before these terms can be published or used for collection

- Select the provider and obtain written approval of Fave's Uganda merchant activity, legal merchant, funds flow, enabled methods, settlement destination, fees/taxes, reserves, refund support, chargeback allocation, and driver-payout arrangement.
- Complete the contract fee schedule. Reconcile the merchant contract, provider response, and pricing in checkout; do not use the conflicting/incomplete rate text in the 6 October Pesapal email as a customer price.
- Record the final merchant and contracting model with the transport-service provider: who receives each payment, when the booking becomes binding, what happens when a supplier does not accept, and how funds are held and paid out. The owner reports counsel approval of the payment-provider terms; implementation must match the approved terms and the provider's signed contract.
- Define the no-show point, including any grace period and contact attempt; obtain counsel's review of the cancellation, no-show, trip-failure, partial-performance, refund, and refund-timing rules; and confirm how they work with each payment method's refund limitations.
- Set the active deposit and balance amounts and timing, completion evidence and dispute process, quote expiry, and checkout hold. Preserve the per-night quote rate and accepted calculation when extending a trip.
- Name the support contact, publish the effective date and version, and ensure the app displays the complete price, merchant/provider identity, payment timing, cancellation/refund policy, and current terms before the client orders or pays.
- Complete provider KYC, production method activation, sandbox and reconciliation testing, and any regulatory/legal approval required for the chosen arrangement. Do not collect live customer payments until these checks are complete.

**Source note:** Pesapal email from Justus Twinamatsiko, Head of Payment Services, dated 6 October 2026, subject “Re: Fave Uganda payments — request for merchant quote and product fit,” with attachments “2026_PESAPAL (Ug) Merchnat Contract.pdf” and “Pesapal Merchant Visit.pdf.” The offer states core collection-method support subject to onboarding, but leaves funds flow, driver payouts, refunds, chargeback allocation, and account-specific commercial terms open. See the project provider review for independent public documentation and legal references.
