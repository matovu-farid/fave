# Uganda MVP payment provider review

**Status:** Research and provisional recommendation only. The owner confirmed MTN/Airtel mobile money plus local cards for both deposit and final balance on 30 September 2026. No provider has been selected, merchant account approved, payment integration built, or real payment attempted.

**Prepared:** 30 September 2026
**Issue:** [#16 — Select a Uganda-ready payment provider](https://github.com/matovu-farid/fave/issues/16)
**Product inputs:** Confirmed payment rails and proposed fare treatment in [#15 — fare, booking, cancellation, and settlement policy](https://github.com/matovu-farid/fave/issues/15). Provider fee and settlement findings flow back to #15.
**Legal gate:** [#14 — Uganda legal, regulatory, privacy, and safety review](https://github.com/matovu-farid/fave/issues/14)

## Recommendation

Use **Flutterwave as the provisional first choice for merchant onboarding and sandbox validation** for the owner-confirmed MTN/Airtel mobile money and local-card methods, subject to confirming currency, Ugandan counsel approving the collection and driver-payout model in #14, and Flutterwave giving Fave a written merchant offer confirming eligibility, current fees, payment methods, refunds, settlement, and driver payout support.

Flutterwave has the clearest publicly verifiable fit for the current product direction: its Uganda documentation describes UGX charges over MTN or Airtel, its current Uganda pricing page lists local cards and mobile-money pricing, and its API documentation covers Uganda bank and mobile-money payouts, sandbox mode, refunds, and marketplace subaccounts. The platform is Hono on Cloudflare Workers, so a server-to-server REST integration can keep secret credentials in Worker secrets; the Expo client should only receive a hosted payment URL or other provider-approved client-safe checkout details.

This is a provisional recommendation, not approval to collect, hold, split, or remit customer funds. Flutterwave’s split-payment documentation places vendor diligence and disputes/chargebacks on the marketplace owner, and Uganda’s payment-law treatment of Fave’s precise funds flow still needs counsel review.

## Provider comparison

| Provider | Uganda collections | Settlement and payouts | Integration and controls | Gaps to resolve |
|---|---|---|---|---|
| **Flutterwave — provisional recommendation** | Current docs support UGX mobile-money collection on MTN and Airtel. Uganda pricing lists cards and mobile wallets/mobile money. | Uganda bank payout API supports UGX; its mobile-money transfer guide lists MTN and Airtel. Current pricing lists local settlement next day, bank-transfer cost, and mobile-money payout costs. Split payments support Uganda accounts with branch details. | REST APIs, hosted checkout/redirect, test mode, payment verification, signed webhooks with retries, refund endpoint, and idempotent webhook processing guidance. | Uganda pricing sources disagree on card fees. Provider approval and exact settlement cycle/thresholds are account-specific. Get written confirmation of Fave’s merchant eligibility, payment methods, subaccount eligibility for drivers, refunds, mobile-money split/payout behavior, dispute fees, and commercial terms. Counsel must approve whether Fave may collect and settle driver funds. |
| **DPO Pay by Network — strong local alternate** | Its Uganda page advertises UGX, cards, and mobile money including MTN and Airtel, with a Kampala office/contact. | DPO says settlement destination depends on local regulations and directs merchants to account support; public materials do not establish Fave’s exact settlement timing, driver payouts, or a split-settlement flow. | Custom APIs and mobile integrations are advertised. Merchant documentation says an active sandbox or live account and portal credentials are needed. | Ask DPO for a current Uganda offer covering fees/VAT, payout options and costs, settlement cycle/reserve, refunds and chargebacks, webhook signature/retries, idempotency, sandbox test methods, and marketplace/driver settlements. |
| **Pesapal — viable hosted-checkout alternate** | API 3.0 presents the methods enabled for the merchant account. Its country/payment-option assignment is account-specific; get written confirmation of current Uganda UGX methods (MTN, Airtel, cards) before selecting it. | Settlement timing, payout options, fees, and driver split settlements need a merchant quote. Its documented refund rules are restrictive for mobile-money payments. | Current API 3.0 documentation describes JSON REST, public sandbox/live base URLs, hosted redirect checkout, callbacks and IPN notifications, transaction-status lookup, and refunds. | Confirm Uganda merchant onboarding, live merchant methods and currency, fees, settlements, webhook/IPN retries and status polling, reconciliation exports, and any driver payout product. API docs state mobile-money refunds must be full and only one refund request is allowed per payment, which may conflict with the cancellation policy in #15. |
| **MTN MoMo direct — partial-rail fallback only** | Direct MTN collection supports MTN wallets, not cards or Airtel; MTN’s developer portal provides collection/disbursement products and sandbox setup. | Disbursement needs separate production onboarding. MTN’s Uganda bulk-payment material describes a prefunded trust account and an authorized web workflow for bulk payments. | Official API sandbox and collection/disbursement references are available. | By itself it cannot satisfy the confirmed methods (MTN/Airtel mobile money plus local cards). It could only be considered as part of a multi-provider design if a selected PSP cannot cover every rail and the added reconciliation, refunds, settlement, and support complexity is acceptable. |

### Public Flutterwave fee evidence

Flutterwave’s [current Uganda pricing page](https://www.flutterwave.com/ug/pricing) lists 3% for local wallets/mobile-money collection, 4.8% for local card transactions, and 4.8% for international cards. It lists UGX 5,000 per bank transfer payout, UGX 1,000 for mobile-money payouts below UGX 125,000, and 1.2% for payouts from UGX 125,000. It says pricing excludes VAT and other local taxes, and its FAQ says local payments are received the next day. Fees are subject to account/provider terms.

An older [Flutterwave Uganda help article](https://www.flutterwave.com/rw/support/general/heres-all-you-need-to-know-about-operating-a-flutterwave-account-in-uganda) lists 3.2% for local cards and 3.8% for international cards, versus 4.8% on the current pricing page. Treat this as a material pricing discrepancy: obtain a dated written quote for Fave before setting customer prices or the #15 fare model.

For scale illustration only, assume a UGX 100,000 fare split into a 50% deposit and 50% balance. Applying the current published rates to each installment, before VAT and payout costs:

| Deposit method | Balance method | Published collection-fee estimate |
|---|---|---:|
| Mobile money (3%) | Mobile money (3%) | UGX 3,000 total |
| Local card (4.8%) | Local card (4.8%) | UGX 4,800 total |
| Mobile money (3%) | Local card (4.8%) | UGX 3,900 total |
| Local card (4.8%) | Mobile money (3%) | UGX 3,900 total |

These are published-list calculations, not a Fave offer; the UGX 100,000 value is only a scale example. Flutterwave's page says customers bear processing charges by default, with a dashboard option to change who pays. The current working draft in #15 proposes one all-in fare that includes expected provider fees and no undisclosed checkout surcharge. If the owner approves that proposal, Fave must configure the merchant account so the client is charged the quoted total, then confirm the effective fee treatment in writing; do not rely on the provider default or add a surprise checkout fee.

## Evidence and implementation implications

### Flutterwave

- [Uganda Mobile Money](https://developer.flutterwave.com/docs/uganda) documents UGX collection over MTN or Airtel and a provider authorization redirect. Test mode automatically authorizes Uganda mobile-money payments after a few seconds.
- [Payment methods](https://developer.flutterwave.com/v3.0.0/docs/payment-methods) lists Uganda with UGX, cards, and Uganda mobile money. Hosted [Flutterwave Standard](https://developer.flutterwave.com/docs/flutterwave-standard-1) can return a payment link for the client flow.
- [Testing](https://developer.flutterwave.com/v3.0.0/docs/testing) and [authentication](https://developer.flutterwave.com/docs/authentication) document test credentials/modes. Secret keys are server-only and must stay in Worker secrets; do not embed them in Expo.
- [Webhooks](https://developer.flutterwave.com/docs/webhooks) documents a configured secret hash, three retries at 30-minute intervals when a 200 response is not received and retries are enabled, and re-querying critical transaction details before marking a booking paid. Webhook processing must be idempotent because duplicate events can occur.
- [Uganda bank payouts](https://developer.flutterwave.com/docs/uganda-2) documents UGX bank transfers, beneficiary and branch information, transfer-status lookup, and transfer webhooks. [Mobile-money transfers](https://developer.flutterwave.com/docs/mobile-money) lists Uganda MTN and Airtel.
- [Split payments](https://developer.flutterwave.com/docs/split-payments) supports Uganda subaccounts with branch code. It explicitly says marketplace owners must vet their merchants and that disputes/chargebacks are logged against the platform owner. Confirm in writing whether Fave’s driver-provider model is eligible and whether each driver needs an approved subaccount.
- [Refund API](https://developer.flutterwave.com/docs/refunds) supports a requested partial amount. Its current docs say card refunds take 3–15 days and mobile-money refunds take 3–5 days; a refund may remain pending/processing until completion. Refund webhooks are disabled by default and must be enabled by Flutterwave support for the merchant account. Until enabled, use the documented callback URL or poll the refund status endpoint. Confirm the exact timeline and setup for Fave’s account.
- [Settlements](https://developer.flutterwave.com/docs/settlements) says the holding period varies by payment method, settlements require live-account approval and a configured bank/wallet destination, balances below a minimum threshold can be batched, and flagged settlements are withheld pending review.

### Other providers

- [DPO Pay’s Uganda page](https://dpogroup.com/online-payments/uganda/) advertises UGX, card, MTN/Airtel mobile money, local support, and custom API integration. Its [FAQ](https://dpogroup.com/faq/) says settlement destination depends on local regulation and points the merchant to its account manager for the exact option. The [developer overview](https://docs.dpopay.com/dpo-pay-by-network/reference/plugins-overview) requires an active sandbox or live merchant account and portal API credentials.
- [Pesapal API 3.0](https://developer.pesapal.com/how-to-integrate/e-commerce/api-30-json/api-reference) publishes sandbox and live REST endpoints. [Submit Order](https://developer.pesapal.com/how-to-integrate/e-commerce/api-30-json/submitorderrequest) returns hosted checkout and sends callback/IPN identifiers, but not payment status; the server must query status. [IPN setup](https://developer.pesapal.com/how-to-integrate/e-commerce/api-30-json/registeripnurl) documents registration and status-change notifications. [Refund rules](https://developer.pesapal.com/how-to-integrate/e-commerce/api-30-json/refund-request) require merchant approval, permit partial/full card refunds but only full mobile-money refunds, and allow one refund per payment.
- [MTN MoMo API portal](https://momodeveloper.mtn.com/API-collections) exposes collection and disbursement products and sandbox provisioning. Its [Uganda disbursement details](https://momodeveloper.mtn.com/Uganda_Disbursement_productDetails) describe a bulk-payment workflow. This is a direct network product, not a complete multi-rail PSP for Fave.
- The [Bank of Uganda’s 2025 National Payment Systems Oversight Framework](https://bou.or.ug/uploads/Revised_BOU_National_Payment_Systems_Oversight_Framework_2025_698b3e9745.pdf) describes BoU licensing and oversight of payment service providers and payment system operators. The [National Payment Systems Act](https://ulii.org/en/akn/ug/act/2020/15/eng%402023-12-31) defines payment-service roles. Ugandan counsel must determine whether Fave’s planned collection, holding, refund, commission, split, and driver-payout flow itself needs authorization or must be structured through the provider.

## Required confirmations before closing #16

1. Payment methods are confirmed in #15: MTN/Airtel mobile money plus local cards for both deposit and final balance (owner response, 30 September 2026). Still confirm UGX currency, whether Fave or a driver is merchant of record, whether Fave collects the full fare, when/if drivers are paid, and commission/payout rules.
2. Ugandan counsel records the #14 conclusion on platform collection, holding, refund, and driver settlement; counsel identifies any licence, agency, safeguarding, or disclosure conditions.
3. Obtain comparable written merchant offers from Flutterwave and at least one local alternative (DPO or Pesapal), including fees and VAT, who bears processing charges and any surcharge/disclosure rules, onboarding documents, live merchant eligibility, settlement schedule/reserve/minimum, refund and chargeback fees/timelines, split/payout capability, limits, webhook/retry behavior, reconciliation exports, support coverage, and termination/hold rights.
4. Confirm a registered/eligible Fave business account and the required merchant KYC documents. Flutterwave’s Uganda onboarding guidance lists operating licence where applicable; do not assume onboarding approval before required transport licences are decided under #14.
5. Use provider sandbox/test credentials to validate UGX deposit and balance charges, failed/pending payments, duplicate/out-of-order notifications, status re-query, full and partial refunds, and reconciliation. Use no real customer funds in this issue.
6. If provider payouts/splits are not approved or supported, keep booking/payment flows disabled until counsel approves a bank-settlement and manual driver-payout process and the provider confirms the flow in writing. Do not bypass legal review by relabelling a payout or holding arrangement.

## Decision log

| Decision | Status | Owner / evidence needed |
|---|---|---|
| Candidate provider | **Provisional: Flutterwave** | Owner confirmation after policy #15 and merchant quote; counsel review #14 |
| Currency and methods | Methods confirmed; **currency pending #15** | Owner confirmed MTN/Airtel mobile money plus local cards for deposit and final balance on 30 September 2026; owner still needs to confirm currency |
| Merchant of record and who receives funds | **Pending #15 / #14** | Owner describes intended funds flow; counsel classifies it |
| Driver payout/split | **Pending #15 / #14 / provider** | Written provider confirmation, account eligibility, and counsel approval |
| Current fees and settlement terms | **Pending merchant quote** | Signed/delivered Fave-specific rate and payout schedule |
| Who bears transaction fees | **Proposed in #15; not final policy** | Current policy draft proposes including expected fees in the all-in quoted fare without a surprise checkout surcharge. Confirm merchant-account configuration and obtain written provider terms before treating this as final |
| Refund notification path | **Account-level confirmation needed** | Flutterwave says refund webhooks are off by default; ask support to enable them for Fave or implement callback/polling and verify final refund status in sandbox |
| Sandbox evidence | **Not run** | Only after merchant sandbox access; test mode only |
| Production approval | **Not started** | Requires business KYC, applicable licences, and counsel-approved flow |
