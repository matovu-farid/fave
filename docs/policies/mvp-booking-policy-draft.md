# Fave MVP booking, fare, and settlement policy

**Status:** Working draft — owner decisions and counsel review pending

**Version:** 0.1

**Drafted:** 2026-09-30

**Owner:** Fave product owner

**Decision date:** 2026-10-14 (draft distance rate)

This document turns the current product direction into policy options for issue #15. Proposed rules remain draft; owner-confirmed product directions do not by themselves constitute counsel approval or authorize launch or customer charges.

## Confirmed product direction

- This is a private-car, long-distance trip service in Uganda.
- Clients may enter a private pickup address or map pin. Google Maps decides whether the pickup is in Kampala, Mukono, or Wakiso.
- Destinations can be anywhere in Uganda.
- A trip may last up to seven days; interpret trip dates in Kampala time.
- **Trip-night calculation — owner-confirmed 2026-10-13:** count calendar nights as the Kampala-date difference between the trip start/check-in date and return/check-out date. Include the start date and exclude the return date; Monday to Tuesday is one night. Apply this count to per-night quote components and retain the dates and calculation in the accepted quote snapshot.
- **Driver payment — owner-confirmed 2026-10-13; rate source updated 2026-10-13:** “Accommodation” means the driver’s lodging of any kind, not only a hotel. Each driver sets their own per-night lodging rate during registration; it applies across destinations. Calculate the quote’s lodging fee using the applicable driver’s registered rate multiplied by the saved trip-night count. Preserve the applicable rate, trip dates, night count, and calculation in the accepted quote; extensions use the rate saved in that quote. Fave breaks down how much it pays the driver per trip day and sends that day’s itemized full pay in the morning; it includes that day’s accommodation fee and is not an advance toward later pay. This is a daily driver payment, not a separate nightly lodging transfer or trip-long lump sum. If the trip is cancelled after a daily payment is sent, the driver keeps it; no later daily payments are sent after the trip ends. The accommodation fee is not returned separately for an unused night because it is included in the daily payment. After the trip, Fave verifies the daily-payment and trip records; no routine driver balance is due. Actual driver rates and the exact daily pay breakdown remain to be supplied/finalized. Fave does not arrange or pay for lodging for the client/passengers.
- **Booking response and quote sequence — owner-confirmed 2026-10-14:** after the client selects a car, offer the trip privately to the approved driver attached to that exact car. The driver must accept within 15 minutes before Fave shows a final quote. While waiting, keep the trip details and status visible, allow the client to withdraw, and do not request payment details, authorize, or charge. A decline or timeout produces no quote and no automatic vehicle/driver substitution; ask the client to choose another car. After acceptance, show the quote and required terms before the client pays the deposit. Airbnb is a reference for a clear, low-friction journey; its payment timing is not Fave's rule.
- **Vehicle fare — owner-confirmed 2026-10-14:** ask the driver one per-car price for the Kampala-to-Jinja round trip. This amount combines vehicle operating cost (including fuel) and the car's type/comfort value; do not split these into separate driver questions. Derive the vehicle's effective rate from one approved, fixed Google Maps reference route and its saved distance. Show the passenger's outbound route and the return route as separate client quote lines, each priced with that selected car's derived rate. Driver lodging remains a separate per-night line. The reference endpoints, distance, rounding, cost validation, and approval remain open; do not activate quotes until those inputs are approved.
- Ask the client for a 50% deposit by default, configurable for future policy changes. Collect the balance after the trip is complete.
- **Client-requested trip extensions — owner-confirmed 2026-10-12:** additional accommodation nights use the per-night rate saved in the accepted quote. Show the revised total, obtain client acceptance before changing the booking, and collect payment for the added nights immediately when the client accepts the extension. The remaining extension and reconciliation rules still require issue #15 and counsel review under #14.

## Recommended starting defaults for owner approval

| Topic | Proposed MVP default | Why |
|---|---|---|
| Currency and fees | UGX; show whole shillings and one quoted total that includes expected payment-provider fees; do not add an undisclosed fee at checkout | Keeps the first quote easy to understand; #16 must confirm merchant-specific fees, and legal/tax review still applies |
| Vehicle fare | Each car has one driver-entered Kampala–Jinja round-trip benchmark; derive its effective rate from the approved reference road distance and show outbound and return route charges separately | Reflects differences in fuel/operating costs and car type while showing the client both directions clearly |
| Driver lodging | Use the applicable driver’s own per-night rate, set during registration, across destinations; preserve that rate and the trip-night calculation in the accepted quote; include each day’s accommodation fee in that driver’s itemized daily payment sent in the morning | Owner confirmed driver-set rate at registration on 2026-10-13 and morning full daily pay including accommodation; exact driver rates and daily breakdown remain open; Fave does not arrange client lodging |
| Quote and deposit deadline | Quote expires 24 hours after issue; the deposit is due within that window; lock the accepted quote when the deposit is confirmed | Gives a clear payment deadline while preserving an auditable price snapshot |
| Pending deposit | Hold the selected car for 30 minutes; release it after timeout or confirmed payment failure | Prevents a stalled checkout from blocking availability indefinitely |
| Client cancellation | Full deposit refund at least 72 hours before pickup; half the deposit 24–72 hours before pickup; no deposit refund inside 24 hours | Owner confirmed the graduated schedule on 2026-10-13; counsel review and launch approval are still required |
| Fave cannot provide a car/driver | Refund all client payments in full | The client should not bear the cost of Fave's inability to fulfill |
| Phone verification | **V1 does not require OTP.** Phone numbers are contact details only, under counsel-approved decision D-13 | Avoids making SMS verification a prerequisite for applications, bookings, or assignment-time contact sharing |
| Driver settlement | Break down the driver’s full pay by trip day; send that day’s itemized amount in the morning, including its accommodation fee; verify payment and trip records after completion, with no routine later balance | Owner confirmed full daily pay, timing, and included lodging fee; exact pay breakdown, available balance, payout route, accounting, and legal structure need provider/counsel review |
| Client payment methods | **Confirmed:** MTN/Airtel mobile money plus local cards for both deposit and final balance | Defines which provider methods #16 must support and the fees included in quotes |

These are recommendations to reduce the decision work, not approved policy. The previously discussed UGX 2,000/km value is a comparison point for unit-cost validation only. It is not an active or universal fare and must not be used as a fallback for a car without an approved benchmark. Each driver's nightly lodging rate is a separate quote component and is set during registration. The client payment methods above are confirmed product direction; legal, provider, and merchant terms remain subject to review.

### Researched distance-rate recommendation — 2026-10-14

**Previous comparison point — 2026-10-14; not an owner-selected universal rate:** UGX 2,000/km may be used to compare draft prices against public examples during unit-cost validation. It is not the per-car fare, does not set the fare for every vehicle, and is never a fallback. Under the selected design, each driver supplies one amount for the Kampala–Jinja round trip in each car; Fave derives that car's rate from the approved reference road distance. The client quote shows outbound and return route amounts separately, and driver lodging remains separate. Before activation, validate driver benchmarks against actual operating costs and approved provider fees.

The public comparison is directional rather than like-for-like: public car-hire listings describe city-ride rates by vehicle class and chauffeur-driven day rates with fuel generally excluded and a separate driver overnight allowance. These examples help frame cost questions but do not determine Fave's fare. Validate each submitted car benchmark against actual operating costs and the selected provider's written fee schedule before activation.

Sources: [Selam Ride Uganda fare table](https://www.selamrideuganda.com/ride); [Uganda Car Rental Services Kampala rates and driver overnight allowances](https://www.ugandacarrentalservices.com/car-hire-locations/kampala-city.html).

**Google Maps route observation — 2026-10-15; not an approved benchmark:** Driving directions between Google's generic Kampala and Jinja places showed a fastest outbound route of 97.2 km via Kampala–Jinja Expressway and Kampala–Jinja Highway/A109, plus a 79.6 km A109 alternative. Reversing the places showed a fastest return of 97.5 km via the Expressway/A109 and a 98.2 km Expressway alternative. These results depend on Google's selected endpoints, route choice, and traffic; they do not establish one fixed road distance for Fave. The 80 km example is therefore plausible for one route but is not a unique Kampala–Jinja benchmark. Before activation, the owner must approve exact reference endpoints and a fixed route/distance basis, including how outbound and return reference legs are combined and versioned. [Google Maps driving directions: Kampala → Jinja](https://www.google.com/maps/dir/Kampala,+Uganda/Jinja,+Uganda); [Jinja → Kampala](https://www.google.com/maps/dir/Jinja,+Uganda/Kampala,+Uganda).

**Owner decision — 2026-10-14:** Use a driver-entered round-trip benchmark for each car, then derive that car's transport rate. Display outbound and return transport lines separately. The UGX 2,000/km comparison does not activate a standard fare or authorize customer charges.

## Draft pricing rules for owner review

### Currency and display

**Proposal, added for owner review on 2026-09-30:** Quote and collect in Uganda shillings (UGX), display whole shillings, and show distance and driver-accommodation as separate line items inside one total. Include expected provider processing fees in that quoted total rather than adding an undisclosed checkout surcharge. Issue #16 must confirm actual Fave merchant fees before the rates are finalized.

**Owner decision:** Confirm currency, rounding, and any separate booking/platform fee.

### Fare components

**Proposal:**

1. For each registered car, capture one whole-UGX driver quote for the approved Kampala–Jinja round-trip benchmark. Derive the effective per-kilometre rate from that amount and the saved round-trip road distance. Do not accept an unconfigured basis and do not use the UGX 2,000/km comparison as a fallback.
2. Calculate pickup-to-destination and destination-to-pickup Google Maps driving routes independently. Price each direction from its own road distance using the selected car's saved effective rate, and show **Outbound transport** and **Return transport** separately. Preserve each route, distance, unit rate, and amount in the immutable quote.
3. Add the accepted driver's separately registered lodging rate multiplied by the saved Kampala-date night count. Lodging can be any type; Fave does not book or pay for the client/passengers' accommodation.
4. Display the component amounts, assumptions, and quote expiry before confirmation.

For a date-based trip, calculate nights as the number of Kampala calendar dates from the start date up to, but not including, the return date. For example, Monday-to-Tuesday is one night and Monday-to-Wednesday is two. Show the start date, return date, night count, rate, and amount in the quote. If accommodation is based on a different itinerary-specific overnight plan, show and retain that plan and its calculation explicitly rather than silently substituting it for the date-based count.

**Remaining decisions:** Confirm the exact Kampala and Jinja reference endpoints, approved round-trip road distance, and whole-shilling rounding; validate the per-car benchmarks against actual costs and provider fees; finalize the daily driver-pay breakdown, receipt/evidence rules, and exceptional adjustments. Each morning's payment is the driver's full pay for that day; after completion, reconcile records only, with no routine additional driver balance. Finalize client refunds for other cancellation cases and any other excess amounts and decide whether other costs can be passed through. If the trip is cancelled after a daily payment is sent, the driver keeps it; no later daily payments are sent after the trip ends. Fave does not arrange or pay for client/passenger lodging.

**Rate-setting worksheet (no rates invented):** The driver supplies one Kampala–Jinja round-trip price for each car. Before activation, validate the amount against the car's fuel use and price, maintenance/tyre reserve, driver compensation, vehicle wear, taxes/provider costs, and Fave's margin. Fave derives the per-kilometre rate from the approved reference road distance. Each driver supplies a separate per-night lodging rate during registration; keep it on that driver's profile and use it across destinations. Assign an eligible driver before presenting the final quote so the correct registered lodging rate is available. The quote and any accepted extension retain the rate basis and calculation so a later profile-rate change does not silently alter an existing booking.

**Owner-confirmed direction — 2026-10-14:** Add a separate return-distance charge. Calculate outbound and return routes independently from Google Maps, apply the selected car's rate to each actual route, and show both amounts before confirmation. The car rate itself comes from the driver's one round-trip Kampala–Jinja benchmark and combines vehicle operating cost and type value.

### Quote and changes

**Proposal, added for owner review on 2026-09-30:** A quote expires 24 hours after issue, and the deposit is due within that period. A successful deposit locks the quote snapshot. During an active checkout, hold the selected car for 30 minutes; if the hold expires, recheck availability before accepting payment. Before payment, a changed rate or itinerary creates a new quote that the client must accept. After payment, do not silently add charges. Reprice only when the client asks to change the itinerary and accepts the revised quote.

**Owner-confirmed extension terms — 2026-10-12:** for a client-requested extension, additional accommodation nights use the per-night rate captured in the accepted quote. Present the revised total, obtain the client's acceptance before amending the booking, and collect payment for added nights immediately when the client accepts. This records the rate basis and payment timing only; the complete extension, route-change, cancellation, and reconciliation rules remain open for owner/counsel review and must be finalized before launch.

**Owner decisions:** Confirm quote validity and whether Fave absorbs route/accommodation estimate differences that are not caused by a client-requested change.

## Draft payment and booking rules for owner review

- Default deposit: 50% of the accepted quote, configurable by an authorized admin with a versioned change history.
- Driver daily payment: calculate and itemize the driver’s full pay for each trip day, include that day’s accommodation fee in the daily total, and send it in the morning from Fave’s business funds. It is not an advance toward later pay. Do not send a trip-long lump sum or a separate nightly lodging payment. If the trip is cancelled after that day’s payment is sent, the driver keeps it; stop future daily payments when the trip ends. After completion, verify payment and trip records; no routine additional driver balance is due. Exact daily components, rates, payout route, receipts, and exceptional-adjustment handling remain open. Fave does not arrange or pay for client/passenger lodging.
- Final driver reconciliation: verify recorded daily payments and completed trip days/nights after the trip; no routine later driver payment or balance is due. Any exceptional adjustment requires a separately approved policy.
- Payment provider: choose in issue #16. A server-confirmed provider event, not a client redirect or screenshot, is the source of truth for a successful payment.
- **Client payment methods — owner-confirmed 2026-09-30:** accept MTN/Airtel mobile money and local cards for both the deposit and final balance. Issue #16 should select a provider or provider combination that supports both. Flutterwave's current Uganda list price is 3% for local wallets/mobile money and 4.8% for local cards, before VAT and other applicable taxes; these are published rates, not a Fave merchant offer. Include the applicable fees in the fare model before launch.
- Pending checkout hold: **proposal** — reserve the selected car for 30 minutes while the deposit is actively pending; release it on timeout or confirmed failure. The 24-hour quote/deposit deadline does not reserve a car for 24 hours. Recheck availability if the 30-minute checkout hold expires.
- Quote and policy versions accepted by the client must be stored with the booking. Existing bookings retain their accepted quote and policy version when rates change.

**Completion proposal:** The driver submits completion; the client confirms or reports a problem. A dispute pauses final-balance collection until an authorized review is recorded. No completion timeout or automatic balance charge is defined yet.

**Owner decisions:** Confirm the checkout hold duration and completion evidence/timeout; finalize the driver's daily pay components, provider payout rail/limits, exceptional adjustments, and commission. The product flow is that clients pay Fave and Fave pays the driver's full itemized pay each morning for that day; the legal merchant role and approved funds flow remain subject to counsel and provider confirmation.

## Draft cancellation and failure rules for owner and counsel review

**Proposed minimum protections:**

- If Fave cannot assign an eligible driver and vehicle, cancel the booking and refund all client payments in full.
- If Fave cancels before pickup, refund all client payments in full.
- Do not automatically collect a disputed final balance. Route disputes and safety incidents to a recorded operations review.

**Client cancellation schedule — owner-confirmed 2026-10-13:** refund the full deposit when the client cancels at least 72 hours before pickup; refund half of the deposit when they cancel at least 24 but less than 72 hours before pickup; and do not refund the deposit when they cancel less than 24 hours before pickup. This schedule still requires Ugandan counsel's review and launch approval. No-show consequences and the operational no-show point (including any grace period and contact attempts) remain undecided. A full refund when Fave cancels or cannot assign an eligible driver and vehicle is a proposed rule, not an owner-approved policy. Late changes, driver/vehicle unavailability after booking, trip interruption, and partial trip completion also need review.

**Remaining owner decisions:** Decide rules for driver no-shows, late changes, trip interruption, replacement car/driver, and partial trip completion.

## Funds and driver settlement

**Owner-confirmed product direction (2026-10-13), subject to legal/provider review:** Each driver sets their own per-night lodging rate during registration, and the rate applies across destinations. Fave calculates the driver’s lodging fee using the applicable driver’s rate and trip-night count, retaining the rate and calculation in the accepted quote; an extension uses that accepted rate snapshot. Fave includes each day’s accommodation fee in the driver’s itemized full-pay amount for that day. Fave sends that amount in the morning; it is the driver’s complete pay for that day, not an advance. Fave does not send a separate nightly lodging payment or a trip-long lump sum. If the trip is cancelled after a daily payment is sent, the driver keeps it; no later daily payments are sent after the trip ends. No separate accommodation-fee return applies for an unused night because lodging is included in the daily payment. After trip completion, verify daily-payment and trip records; no routine additional driver balance is due. Exceptional adjustments require a separately approved policy. Fave does not arrange or pay for client lodging. Do not create or describe an internal Fave wallet or escrow service. Before launch, confirm the daily pay breakdown, registered driver-rate handling, available operating balance, lawful handling of funds, provider payout route/limits and fees, approval and audit controls, evidence, and client refunds. Counsel must approve the actual funds flow under issue #14 and the selected provider must confirm its supported payout arrangement under issue #16.

**Provider-limit finding (2026-10-13):** Flutterwave's public Uganda payout table lists mobile-money payouts up to UGX 500,000 per transaction and bank payouts up to UGX 50,000,000. These are public limits, not Fave account approval. Confirm that the approved payout route supports each driver's daily amount and the required morning payout cadence, including its fees and available balance; do not split a transfer to evade limits. Flutterwave's published mobile-money refund estimates conflict across its merchant response (5–7 days), API documentation (3–5 days), and Uganda help article (1–7 days). Before enabling the proposed client-cancellation schedule, obtain Fave-specific confirmation of refund timing, whether it uses calendar or business days, partial-refund support by payment method, and final refund-status reporting. DPO's public April 2024 merchant agreement also permits conditional settlement holds up to 540 days and leaves funding frequency to the merchant application, so request Fave-specific terms and counsel review before treating DPO as a viable fallback. See the [provider review](./uganda-payment-provider-review.md) for source details.

The Bank of Uganda's 2025 National Payment Systems Oversight Framework says payment service providers require BoU licensing. Counsel must determine which obligations apply to Fave's proposed collection and driver-settlement arrangement.

## Phone verification

**V1 decision D-13 (counsel-approved 2026-10-04):** phone numbers are contact details only. One-time-code verification is not required for driver applications or approvals, client bookings, or assignment-time contact release. Do not choose or integrate an OTP provider as a V1 prerequisite. Any post-V1 OTP proposal requires a separate product, privacy, security, and cost review.

## Safety and legal review gates

Daily driving limits, rest breaks, overnight planning, insurance/transport obligations, privacy/retention, consumer terms, tax, refund rules, and payment handling require review by Uganda-qualified counsel through issue #14. Do not treat this draft as legal advice or as approval to launch bookings or collect real payments.

## Decision record

| Decision | Draft / current state | Owner | Date | Rationale / client wording | Admin control |
|---|---|---|---|---|---|
| Currency, fees, and rounding | Propose UGX, whole shillings, provider fees included in the quoted total; pending #16 merchant terms and owner approval | Pending | Pending | Avoid foreign-currency surprise and checkout fee surprises; wording pending | Pending |
| Vehicle fare | One driver-entered Kampala–Jinja round-trip amount per car; derive effective rate from approved round-trip road distance; outbound and return lines are separate; not active | Fave product owner | 2026-10-14 | One input combines fuel/operating costs and vehicle type; exact benchmark basis, rounding, actual cost/provider checks, legal review, and launch approval remain | Versioned vehicle benchmark and policy basis, if approved |
| Chargeable distance | Add separately itemized outbound and return Google Maps routes, each priced with the selected car's effective rate | Fave product owner | 2026-10-14 | Show both directional route distances and amounts before client acceptance | Snapshot both directions and preserve the rate basis |
| Driver lodging and driver pay | Calculate the quote’s lodging component from the saved rate and trip-night count; include the daily accommodation fee in the driver’s full-pay amount sent each morning; verify records after trip completion with no routine later balance. | Fave product owner | 2026-10-13 | Owner-confirmed full morning pay including lodging; nightly rate, daily breakdown, exceptional adjustments, evidence, legal handling, and operating balance need review | Versioned rate/calculation and audited daily payments/records |
| Quote and deposit deadline | Propose 24 hours; lock quote after confirmed deposit | Pending | Pending | Give the client a clear price and payment deadline | Versioned settings, if approved |
| Deposit and balance | 50% default; balance after trip, per owner direction | Fave owner | Pending | Confirmed product direction; completion evidence pending | Configurable deposit with audit history |
| Client payment methods | MTN/Airtel mobile money plus local cards for deposit and final balance | Fave product owner | 2026-09-30 | Confirmed in owner response; both methods should be available at each payment stage | Provider config must match approved methods |
| Trip-night calculation | Count Kampala calendar dates from trip start/check-in through, but excluding, return/check-out; Monday-to-Tuesday is one night | Fave product owner | 2026-10-13 | Matches lodging-style date ranges and makes per-night pricing reproducible | Retain trip dates, night count, per-night rates, and calculated amounts in the accepted quote snapshot |
| Driver response before quote | The assigned driver for the exact car must accept within 15 minutes before a final quote is shown; decline/timeout means no quote or substitution and the client chooses another car | Fave product owner | 2026-10-14 | Use a clear wait-and-respond journey; no payment details or money movement while the driver decides | Preserve offer, response, expiry, and selected-car state; expose no client contact before approved release |
| Additional accommodation nights on a client-requested extension | Use the per-night rate saved in the accepted quote; show the revised total, obtain client acceptance before changing the booking, and collect payment immediately when accepted | Fave product owner | 2026-10-12 | Preserve the accepted rate basis and collect the extension payment immediately; complete extension and reconciliation rules remain subject to #15 and #14 | Retain the accepted quote snapshot and record consent and payment for the revised total |
| Client cancellation/refunds | Full deposit refund at least 72 hours before pickup; half refund at least 24 but less than 72 hours before; no cancellation refund inside 24 hours | Fave product owner | 2026-10-13 | Owner-confirmed schedule; Ugandan counsel review remains required before launch | Versioned policy and recorded cancellation/refund decision |
| Client no-show | Consequence and operational no-show point, grace period, and contact attempts are undecided | Pending | Pending | Decide before launch and review with counsel | Versioned rule and recorded contact attempts |
| No-driver refund | Propose full refund; not owner-approved | Pending | Pending | Agree remedy if Fave cannot provide a car/driver | Recorded refund action |
| Checkout hold | Propose 30 minutes | Pending | Pending | Release cars when deposit is not completed | Versioned timeout, if approved |
| Driver payout / commission | Break down the driver’s full pay by trip day, include that day’s accommodation fee, and send the itemized daily amount in the morning; verify records after trip completion with no routine later balance. No separate nightly transfer or trip-long lump sum. Commission, daily components, rates, payout route, receipts, and exceptional adjustments remain open | Fave product owner | 2026-10-13 | Owner-confirmed full daily pay timing and inclusion of accommodation fee; counsel/provider review of funds flow and payout controls remains required | Restricted, audited daily payments and record reconciliation |
| Phone verification | No OTP prerequisite for V1 under counsel-approved D-13 | Fave product owner / counsel decision | 2026-10-04 | Phone numbers are contact details only | No V1 OTP provider configuration |
| Daily driving/rest limits | Counsel review required | Counsel | Pending | Driver and passenger safety | Approved limits must be enforced |

## Source notes

- Flutterwave Uganda pricing: <https://www.flutterwave.com/ug/pricing>
- Bank of Uganda 2025 National Payment Systems Oversight Framework: <https://bou.or.ug/uploads/Revised_BOU_National_Payment_Systems_Oversight_Framework_2025_698b3e9745.pdf>
