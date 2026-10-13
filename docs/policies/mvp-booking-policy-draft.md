# Fave MVP booking, fare, and settlement policy

**Status:** Working draft — owner decisions and counsel review pending

**Version:** 0.1

**Drafted:** 2026-09-30

**Owner:** Fave product owner

**Decision date:** Pending approval

This document turns the current product direction into policy options for issue #15. Proposed rules remain draft; owner-confirmed product directions do not by themselves constitute counsel approval or authorize launch or customer charges.

## Confirmed product direction

- This is a private-car, long-distance trip service in Uganda.
- Clients may enter a private pickup address or map pin. Google Maps decides whether the pickup is in Kampala, Mukono, or Wakiso.
- Destinations can be anywhere in Uganda.
- A trip may last up to seven days; interpret trip dates in Kampala time.
- **Trip-night calculation — owner-confirmed 2026-10-13:** count calendar nights as the Kampala-date difference between the trip start/check-in date and return/check-out date. Include the start date and exclude the return date; Monday to Tuesday is one night. Apply this count to per-night quote components and retain the dates and calculation in the accepted quote snapshot.
- **Driver lodging allowance — owner-confirmed 2026-10-13:** “Accommodation” means the driver's lodging of any kind, not only a hotel. The driver receives an allowance for each trip night using the same flat rate across destinations; the quote should calculate this as the saved rate multiplied by the saved trip-night count. Fave advances the approved amount to the driver on the morning the trip starts. The exact rate amount remains open. Fave does not arrange or pay for lodging for the client/passengers.
- Price should be based on driving distance and the driver's nightly lodging allowance. Any accommodation line in the client quote is for the driver's lodging, not lodging for the client.
- Ask the client for a 50% deposit by default, configurable for future policy changes. Collect the balance after the trip is complete.
- **Client-requested trip extensions — owner-confirmed 2026-10-12:** additional accommodation nights use the per-night rate saved in the accepted quote. Show the revised total, obtain client acceptance before changing the booking, and collect payment for the added nights immediately when the client accepts the extension. The remaining extension and reconciliation rules still require issue #15 and counsel review under #14.

## Recommended starting defaults for owner approval

| Topic | Proposed MVP default | Why |
|---|---|---|
| Currency and fees | UGX; show whole shillings and one quoted total that includes expected payment-provider fees; do not add an undisclosed fee at checkout | Keeps the first quote easy to understand; #16 must confirm merchant-specific fees, and legal/tax review still applies |
| Distance | Price by selected vehicle class; quote the passenger route only, with average repositioning costs included in the published per-kilometre rate | Keeps the client price tied to the route they requested and avoids a surprise return fee; itemize any return charge only if the owner explicitly chooses it |
| Driver lodging | Calculate a flat-rate driver lodging allowance for each trip night, using the same rate across destinations; show it as its own quote line and advance the total to the driver on the morning the trip starts | Owner confirmed the same rate across destinations and the advance direction on 2026-10-13; exact amount remains open; Fave does not arrange client lodging |
| Quote and deposit deadline | Quote expires 24 hours after issue; the deposit is due within that window; lock the accepted quote when the deposit is confirmed | Gives a clear payment deadline while preserving an auditable price snapshot |
| Pending deposit | Hold the selected car for 30 minutes; release it after timeout or confirmed payment failure | Prevents a stalled checkout from blocking availability indefinitely |
| Client cancellation | Full deposit refund at least 72 hours before pickup; half the deposit 24–72 hours before pickup; no deposit refund inside 24 hours | Owner confirmed the graduated schedule on 2026-10-13; counsel review and launch approval are still required |
| Fave cannot provide a car/driver | Refund all client payments in full | The client should not bear the cost of Fave's inability to fulfill |
| Phone verification | **V1 does not require OTP.** Phone numbers are contact details only, under counsel-approved decision D-13 | Avoids making SMS verification a prerequisite for applications, bookings, or assignment-time contact sharing |
| Driver settlement | Advance approved accommodation money from Fave's business funds on the morning the trip starts; settle the remaining driver amount after trip completion and reconciliation | Owner confirmed the product funding source, timing, and post-trip final settlement; available operating balance, payout route, accounting, and legal structure need provider/counsel review |
| Client payment methods | **Confirmed:** MTN/Airtel mobile money plus local cards for both deposit and final balance | Defines which provider methods #16 must support and the fees included in quotes |

These are recommendations to reduce the decision work, not approved policy. Unresolved values such as the per-kilometre rate and nightly allowance remain deliberately blank until operating-cost inputs are available. The client payment methods above are confirmed product direction; legal, provider, and merchant terms remain subject to review.

## Draft pricing rules for owner review

### Currency and display

**Proposal, added for owner review on 2026-09-30:** Quote and collect in Uganda shillings (UGX), display whole shillings, and show distance and driver-accommodation as separate line items inside one total. Include expected provider processing fees in that quoted total rather than adding an undisclosed checkout surcharge. Issue #16 must confirm actual Fave merchant fees before the rates are finalized.

**Owner decision:** Confirm currency, rounding, and any separate booking/platform fee.

### Fare components

**Proposal:**

1. Distance fare = chargeable Google Maps driving-route distance × the currently effective per-kilometre rate for the selected car or vehicle class.
2. Per-night components (including driver accommodation) = Kampala calendar nights × the applicable per-night rate saved in the quote.
3. Display the component amounts, assumptions, and quote expiry before confirmation.

For a date-based trip, calculate nights as the number of Kampala calendar dates from the start date up to, but not including, the return date. For example, Monday-to-Tuesday is one night and Monday-to-Wednesday is two. Show the start date, return date, night count, rate, and amount in the quote. If accommodation is based on a different itinerary-specific overnight plan, show and retain that plan and its calculation explicitly rather than silently substituting it for the date-based count.

**Owner decisions:** Set the UGX/km rate and nightly driver-lodging allowance; finalize receipt/evidence rules; decide how unused or excess advance funds, shortened trips, and cancellations are reconciled; decide whether other costs can ever be passed through; decide whether empty return/repositioning distance is chargeable. Fave does not arrange or pay for client/passenger lodging.

**Rate-setting worksheet (no rates invented):** Set a per-car or per-class distance rate from fuel use and price, maintenance/tyre reserve, driver compensation, vehicle wear, taxes/provider costs, and Fave's margin. Set the lodging allowance as one flat nightly amount across destinations, using evidence from a representative range of Ugandan towns so the published rate can work across the service area. Validate both rates against real operating costs on pilot trips before publishing them.

**Distance recommendation:** Charge for the passenger's pickup-to-destination route. Build expected driver repositioning costs into the approved per-car/per-class rate rather than adding an undisclosed round-trip multiplier. If the owner instead chooses to charge a specific empty return leg, show its route and cost separately before confirmation.

**Owner decision:** Approve passenger-route-only pricing with repositioning included in the base rate, or approve a separately itemized empty return leg.

### Quote and changes

**Proposal, added for owner review on 2026-09-30:** A quote expires 24 hours after issue, and the deposit is due within that period. A successful deposit locks the quote snapshot. During an active checkout, hold the selected car for 30 minutes; if the hold expires, recheck availability before accepting payment. Before payment, a changed rate or itinerary creates a new quote that the client must accept. After payment, do not silently add charges. Reprice only when the client asks to change the itinerary and accepts the revised quote.

**Owner-confirmed extension terms — 2026-10-12:** for a client-requested extension, additional accommodation nights use the per-night rate captured in the accepted quote. Present the revised total, obtain the client's acceptance before amending the booking, and collect payment for added nights immediately when the client accepts. This records the rate basis and payment timing only; the complete extension, route-change, cancellation, and reconciliation rules remain open for owner/counsel review and must be finalized before launch.

**Owner decisions:** Confirm quote validity and whether Fave absorbs route/accommodation estimate differences that are not caused by a client-requested change.

## Draft payment and booking rules for owner review

- Default deposit: 50% of the accepted quote, configurable by an authorized admin with a versioned change history.
- Driver lodging advance: calculate the approved nightly allowance times the trip-night count saved in the quote and advance it to the driver on the morning the trip starts. The rate, payment route/source, receipts and changed-night reconciliation rules are not set. Fave does not arrange or pay for client/passenger lodging.
- Remaining driver settlement: after trip completion and reconciliation, in addition to the lodging advance.
- Payment provider: choose in issue #16. A server-confirmed provider event, not a client redirect or screenshot, is the source of truth for a successful payment.
- **Client payment methods — owner-confirmed 2026-09-30:** accept MTN/Airtel mobile money and local cards for both the deposit and final balance. Issue #16 should select a provider or provider combination that supports both. Flutterwave's current Uganda list price is 3% for local wallets/mobile money and 4.8% for local cards, before VAT and other applicable taxes; these are published rates, not a Fave merchant offer. Include the applicable fees in the fare model before launch.
- Pending checkout hold: **proposal** — reserve the selected car for 30 minutes while the deposit is actively pending; release it on timeout or confirmed failure. The 24-hour quote/deposit deadline does not reserve a car for 24 hours. Recheck availability if the 30-minute checkout hold expires.
- Quote and policy versions accepted by the client must be stored with the booking. Existing bookings retain their accepted quote and policy version when rates change.

**Completion proposal:** The driver submits completion; the client confirms or reports a problem. A dispute pauses final-balance collection until an authorized review is recorded. No completion timeout or automatic balance charge is defined yet.

**Owner decisions:** Confirm the checkout hold duration and completion evidence/timeout; decide who collects the balance and the permitted driver payout schedule/commission.

## Draft cancellation and failure rules for owner and counsel review

**Proposed minimum protections:**

- If Fave cannot assign an eligible driver and vehicle, cancel the booking and refund all client payments in full.
- If Fave cancels before pickup, refund all client payments in full.
- Do not automatically collect a disputed final balance. Route disputes and safety incidents to a recorded operations review.

**Client cancellation schedule — owner-confirmed 2026-10-13:** refund the full deposit when the client cancels at least 72 hours before pickup; refund half of the deposit when they cancel at least 24 but less than 72 hours before pickup; and do not refund the deposit when they cancel less than 24 hours before pickup. This schedule still requires Ugandan counsel's review and launch approval. No-show consequences and the operational no-show point (including any grace period and contact attempts) remain undecided. A full refund when Fave cancels or cannot assign an eligible driver and vehicle is a proposed rule, not an owner-approved policy. Late changes, driver/vehicle unavailability after booking, trip interruption, and partial trip completion also need review.

**Remaining owner decisions:** Decide rules for driver no-shows, late changes, trip interruption, replacement car/driver, and partial trip completion.

## Funds and driver settlement

**Owner-confirmed product direction (2026-10-13), subject to legal/provider review:** Fave calculates a driver lodging allowance per trip night (accommodation means lodging of any kind, not hotels only), funds the advance from Fave's business funds, sends it to the driver on the morning the trip starts, and settles the remaining driver amount after trip completion and reconciliation. Fave does not arrange or pay for lodging for clients/passengers. Do not create or describe an internal Fave wallet or escrow service. Before launch, confirm the nightly rate amount, available operating balance and lawful handling of advance funds, provider payout route and limits, approval and audit controls, receipt evidence, and how changed nights, shortened/cancelled trips, unused funds, overspend, refunds, and disputes are reconciled. Counsel must approve the actual funds flow under issue #14 and the selected provider must confirm its supported payout arrangement under issue #16.

**Provider-limit finding (2026-10-13):** Flutterwave's public Uganda payout table lists mobile-money payouts up to UGX 500,000 per transaction and bank payouts up to UGX 50,000,000. These are public limits, not Fave account approval. Confirm whether a saved nightly allowance multiplied by trip nights fits the approved payout route and per-transfer cap; use a bank payout or another provider-approved path for larger advances, and do not split a transfer to evade limits. Flutterwave's published mobile-money refund estimates conflict across its merchant response (5–7 days), API documentation (3–5 days), and Uganda help article (1–7 days). Before enabling the proposed client-cancellation schedule, obtain Fave-specific confirmation of refund timing, whether it uses calendar or business days, partial-refund support by payment method, and final refund-status reporting. DPO's public April 2024 merchant agreement also permits conditional settlement holds up to 540 days and leaves funding frequency to the merchant application, so request Fave-specific terms and counsel review before treating DPO as a viable fallback. See the [provider review](./uganda-payment-provider-review.md) for source details.

The Bank of Uganda's 2025 National Payment Systems Oversight Framework says payment service providers require BoU licensing. Counsel must determine which obligations apply to Fave's proposed collection and driver-settlement arrangement.

## Phone verification

**V1 decision D-13 (counsel-approved 2026-10-04):** phone numbers are contact details only. One-time-code verification is not required for driver applications or approvals, client bookings, or assignment-time contact release. Do not choose or integrate an OTP provider as a V1 prerequisite. Any post-V1 OTP proposal requires a separate product, privacy, security, and cost review.

## Safety and legal review gates

Daily driving limits, rest breaks, overnight planning, insurance/transport obligations, privacy/retention, consumer terms, tax, refund rules, and payment handling require review by Uganda-qualified counsel through issue #14. Do not treat this draft as legal advice or as approval to launch bookings or collect real payments.

## Decision record

| Decision | Draft / current state | Owner | Date | Rationale / client wording | Admin control |
|---|---|---|---|---|---|
| Currency, fees, and rounding | Propose UGX, whole shillings, provider fees included in the quoted total; pending #16 merchant terms and owner approval | Pending | Pending | Avoid foreign-currency surprise and checkout fee surprises; wording pending | Pending |
| Distance rate | Not set | Pending | Pending | Needs operating-cost and margin inputs | Versioned rate, if approved |
| Chargeable distance | Pickup-to-destination only vs. include empty return/repositioning | Pending | Pending | Must be visible before the client accepts | Versioned rule, if approved |
| Driver lodging allowance and settlement | Calculate a nightly allowance for each saved trip night; fund the advance from Fave's business funds and send it on the morning the trip starts; settle remaining driver amount after completion/reconciliation. Fave does not arrange/pay client lodging. | Fave product owner | 2026-10-13 | Owner-confirmed product direction; nightly rate amount, receipts, and changed-night/cancellation reconciliation remain open; lawful handling and sufficient operating balance need review | Versioned nightly rate and audited advance/settlement records |
| Quote and deposit deadline | Propose 24 hours; lock quote after confirmed deposit | Pending | Pending | Give the client a clear price and payment deadline | Versioned settings, if approved |
| Deposit and balance | 50% default; balance after trip, per owner direction | Fave owner | Pending | Confirmed product direction; completion evidence pending | Configurable deposit with audit history |
| Client payment methods | MTN/Airtel mobile money plus local cards for deposit and final balance | Fave product owner | 2026-09-30 | Confirmed in owner response; both methods should be available at each payment stage | Provider config must match approved methods |
| Trip-night calculation | Count Kampala calendar dates from trip start/check-in through, but excluding, return/check-out; Monday-to-Tuesday is one night | Fave product owner | 2026-10-13 | Matches lodging-style date ranges and makes per-night pricing reproducible | Retain trip dates, night count, per-night rates, and calculated amounts in the accepted quote snapshot |
| Additional accommodation nights on a client-requested extension | Use the per-night rate saved in the accepted quote; show the revised total, obtain client acceptance before changing the booking, and collect payment immediately when accepted | Fave product owner | 2026-10-12 | Preserve the accepted rate basis and collect the extension payment immediately; complete extension and reconciliation rules remain subject to #15 and #14 | Retain the accepted quote snapshot and record consent and payment for the revised total |
| Client cancellation/refunds | Full deposit refund at least 72 hours before pickup; half refund at least 24 but less than 72 hours before; no cancellation refund inside 24 hours | Fave product owner | 2026-10-13 | Owner-confirmed schedule; Ugandan counsel review remains required before launch | Versioned policy and recorded cancellation/refund decision |
| Client no-show | Consequence and operational no-show point, grace period, and contact attempts are undecided | Pending | Pending | Decide before launch and review with counsel | Versioned rule and recorded contact attempts |
| No-driver refund | Propose full refund; not owner-approved | Pending | Pending | Agree remedy if Fave cannot provide a car/driver | Recorded refund action |
| Checkout hold | Propose 30 minutes | Pending | Pending | Release cars when deposit is not completed | Versioned timeout, if approved |
| Driver payout / commission | Fund the approved per-night lodging allowance times saved trip nights from Fave's business funds and send it on the morning the trip starts; settle remaining driver amount after trip completion/reconciliation. Commission, nightly rate, payment route, receipts and changed-night/cancellation recovery remain open | Fave product owner | 2026-10-13 | Owner-confirmed product funding source and timing; counsel and provider must approve actual funds flow and payout controls, including required available balance | Restricted, audited advance and settlement actions |
| Phone verification | No OTP prerequisite for V1 under counsel-approved D-13 | Fave product owner / counsel decision | 2026-10-04 | Phone numbers are contact details only | No V1 OTP provider configuration |
| Daily driving/rest limits | Counsel review required | Counsel | Pending | Driver and passenger safety | Approved limits must be enforced |

## Source notes

- Flutterwave Uganda pricing: <https://www.flutterwave.com/ug/pricing>
- Bank of Uganda 2025 National Payment Systems Oversight Framework: <https://bou.or.ug/uploads/Revised_BOU_National_Payment_Systems_Oversight_Framework_2025_698b3e9745.pdf>
