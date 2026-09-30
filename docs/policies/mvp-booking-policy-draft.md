# Fave MVP booking, fare, and settlement policy

**Status:** Working draft — owner decisions and counsel review pending

**Version:** 0.1

**Drafted:** 2026-09-30

**Owner:** Fave product owner

**Decision date:** Pending approval

This document turns the current product direction into policy options for issue #15. Proposed rules below are not approved policy and must not be used to charge customers until the owner approves them and the review required by issue #14 is complete.

## Confirmed product direction

- This is a private-car, long-distance trip service in Uganda.
- Clients may enter a private pickup address or map pin. Google Maps decides whether the pickup is in Kampala, Mukono, or Wakiso.
- Destinations can be anywhere in Uganda.
- A trip may last up to seven days; interpret trip dates in Kampala time.
- Price should be based on driving distance and the driver's accommodation estimate.
- Ask the client for a 50% deposit by default, configurable for future policy changes. Collect the balance after the trip is complete.

## Recommended starting defaults for owner approval

| Topic | Proposed MVP default | Why |
|---|---|---|
| Currency | UGX; show whole shillings and no separate platform fee initially | Keeps the first quote easy to understand; legal/tax review still applies |
| Distance | Price by selected vehicle class; quote the passenger route only, with average repositioning costs included in the published per-kilometre rate | Keeps the client price tied to the route they requested and avoids a surprise return fee; itemize any return charge only if the owner explicitly chooses it |
| Accommodation | Use a location-sensitive nightly allowance, shown as its own line; Fave advances the approved allowance to the driver | Avoids asking a driver to fund a work trip personally and keeps customer estimate predictable |
| Quote | Expire after 24 hours; lock the accepted quote when the deposit is confirmed | Allows time to pay while preserving an auditable price snapshot |
| Pending deposit | Hold the selected car for 30 minutes; release it after timeout or confirmed payment failure | Prevents a stalled checkout from blocking availability indefinitely |
| Client cancellation | Refund all deposit at 72+ hours; refund half of the deposit at 24–72 hours; retain the deposit inside 24 hours | A simple time-based proposal; requires owner and counsel approval before launch |
| Fave cannot provide a car/driver | Refund all client payments in full | The client should not bear the cost of Fave's inability to fulfill |
| Phone verification | Africa's Talking SMS, with Fave-managed one-time codes and abuse controls | Lower listed local SMS cost; use only if the team accepts building and operating the OTP safeguards |
| Driver settlement | Use the selected payment provider and settle only after trip completion/reconciliation | Keeps payment proof and settlement traceable; exact legal structure needs counsel review |

These are recommendations to reduce the decision work, not approved policy. Unresolved values such as the per-kilometre rate and nightly allowance remain deliberately blank until operating-cost inputs are available.

## Draft pricing rules for owner review

### Currency and display

**Proposal:** Quote and collect in Uganda shillings (UGX), display whole shillings, and show the fare as separate distance and driver-accommodation line items. Do not add a fee or tax that was not shown before the client paid.

**Owner decision:** Confirm currency, rounding, and any separate booking/platform fee.

### Fare components

**Proposal:**

1. Distance fare = chargeable Google Maps driving-route distance × the currently effective per-kilometre rate for the selected car or vehicle class.
2. Driver accommodation = planned overnight stops × the currently effective nightly allowance.
3. Display the component amounts, assumptions, and quote expiry before confirmation.

Count one accommodation night for each planned overnight stop where the driver must sleep away from home. The itinerary and stop count should be visible in the quote.

**Owner decisions:** Set the UGX/km rate; set the nightly allowance; decide whether accommodation is booked by Fave, paid directly by Fave, or reimbursed to the driver; decide whether other costs can ever be passed through; decide whether empty return/repositioning distance is chargeable.

**Rate-setting worksheet (no rates invented):** Set a per-car or per-class rate from fuel use and price, maintenance/tyre reserve, driver compensation, vehicle wear, taxes/provider costs, and Fave's margin. Validate it against real operating costs on pilot trips before publishing it. Check accommodation rates by destination area rather than assuming one hotel cost fits every Ugandan town.

**Distance recommendation:** Charge for the passenger's pickup-to-destination route. Build expected driver repositioning costs into the approved per-car/per-class rate rather than adding an undisclosed round-trip multiplier. If the owner instead chooses to charge a specific empty return leg, show its route and cost separately before confirmation.

**Owner decision:** Approve passenger-route-only pricing with repositioning included in the base rate, or approve a separately itemized empty return leg.

### Quote and changes

**Proposal:** Quotes expire after 24 hours. A successful deposit locks the quote snapshot. Before payment, a changed rate or itinerary creates a new quote that the client must accept. After payment, do not silently add charges. Reprice only when the client asks to change the itinerary and accepts the revised quote.

**Owner decisions:** Confirm quote validity and whether Fave absorbs route/accommodation estimate differences that are not caused by a client-requested change.

## Draft payment and booking rules for owner review

- Default deposit: 50% of the accepted quote, configurable by an authorized admin with a versioned change history.
- Remaining balance: due after trip completion, according to the completion confirmation process below.
- Payment provider: choose in issue #16. A server-confirmed provider event, not a client redirect or screenshot, is the source of truth for a successful payment.
- Pending checkout hold: **proposal** — reserve the selected car for 30 minutes while the deposit is pending; release it on timeout or confirmed failure. The hold duration and provider callback grace period need owner approval.
- Quote and policy versions accepted by the client must be stored with the booking. Existing bookings retain their accepted quote and policy version when rates change.

**Completion proposal:** The driver submits completion; the client confirms or reports a problem. A dispute pauses final-balance collection until an authorized review is recorded. No completion timeout or automatic balance charge is defined yet.

**Owner decisions:** Confirm the checkout hold duration and completion evidence/timeout; decide who collects the balance and the permitted driver payout schedule/commission.

## Draft cancellation and failure rules for owner and counsel review

**Proposed minimum protections:**

- If Fave cannot assign an eligible driver and vehicle, cancel the booking and refund all client payments in full.
- If Fave cancels before pickup, refund all client payments in full.
- Do not automatically collect a disputed final balance. Route disputes and safety incidents to a recorded operations review.

**Client cancellation schedule — option only, not approved:** refund the full deposit at least 72 hours before pickup; refund half of the deposit 24–72 hours before pickup; retain the deposit inside 24 hours. A different schedule, including a full deposit refund at any time before pickup, may be chosen. Refunds, no-shows, late changes, driver/vehicle unavailability, and trip failure must be approved by the owner and reviewed by Ugandan counsel before payment collection goes live.

**Owner decisions:** Choose the client cancellation schedule and rules for client/driver no-shows, late changes, trip interruption, replacement car/driver, and partial trip completion.

## Funds and driver settlement

**Proposal pending legal review:** Use a selected, appropriately licensed payment provider for collection and settlement. Do not create or describe an internal Fave wallet or escrow service. Do not release driver funds until the trip is complete and payment/dispute state is reconciled. The exact legal model, who holds funds, platform commission, payout timing, and refund responsibility must be approved with counsel under issue #14 and provider selection under issue #16.

The Bank of Uganda's 2025 National Payment Systems Oversight Framework says payment service providers require BoU licensing. Counsel must determine which obligations apply to Fave's proposed collection and driver-settlement arrangement.

## Phone verification provider

Phone possession must be verified before an application can be approved or a booking can share contact details, as specified in issues #6 and #21.

**Options researched:**

- **Africa's Talking SMS:** Uganda entry-tier SMS pricing is published at about UGX 25–35 per segment. This is the cost-focused option, but Fave would own code generation, expiry, attempt limits, abuse controls, and verification state. Confirm sender-ID setup and actual account pricing before launch.
- **Twilio Verify:** Managed verification with built-in code-flow features; published base fee is $0.05 per successful verification plus channel fees. Twilio lists Uganda outbound SMS at $0.3289 per segment before possible carrier fees. This reduces OTP implementation work but has a higher listed message cost.

**Recommendation for review:** Prefer Africa's Talking for the Uganda-focused MVP if the team is willing to implement and operate secure OTP controls. Otherwise choose Twilio Verify and accept its higher per-verification cost. Restrict phone verification traffic to Uganda, add spend/attempt alerts, and provide a support fallback for failed delivery.

## Safety and legal review gates

Daily driving limits, rest breaks, overnight planning, insurance/transport obligations, privacy/retention, consumer terms, tax, refund rules, and payment handling require review by Uganda-qualified counsel through issue #14. Do not treat this draft as legal advice or as approval to launch bookings or collect real payments.

## Decision record

| Decision | Draft / current state | Owner | Date | Rationale / client wording | Admin control |
|---|---|---|---|---|---|
| Currency and rounding | Propose UGX, whole shillings; pending | Pending | Pending | Avoid foreign-currency surprise; wording pending | Pending |
| Distance rate | Not set | Pending | Pending | Needs operating-cost and margin inputs | Versioned rate, if approved |
| Chargeable distance | Pickup-to-destination only vs. include empty return/repositioning | Pending | Pending | Must be visible before the client accepts | Versioned rule, if approved |
| Nightly allowance and settlement | Not set; options above | Pending | Pending | Show accommodation separately | Versioned allowance, if approved |
| Quote expiry and price lock | Propose 24 hours; lock after confirmed deposit | Pending | Pending | Give the client a clear price before paying | Versioned settings, if approved |
| Deposit and balance | 50% default; balance after trip, per owner direction | Fave owner | Pending | Confirmed product direction; completion evidence pending | Configurable deposit with audit history |
| Client cancellation/refunds | Open; option above | Pending | Pending | Requires owner and counsel approval | Versioned policy, if approved |
| No-driver refund | Propose full refund | Pending | Pending | Client should not pay when Fave cannot provide a car/driver | Recorded refund action |
| Checkout hold | Propose 30 minutes | Pending | Pending | Release cars when deposit is not completed | Versioned timeout, if approved |
| Driver payout / commission | Open; counsel and provider review required | Pending | Pending | Avoid settling funds outside an approved model | Restricted, audited settlement actions |
| Phone OTP provider | Recommend Africa's Talking if Fave owns OTP controls | Pending | Pending | Lower listed Uganda SMS cost; requires secure OTP implementation | Rate and spend limits |
| Daily driving/rest limits | Counsel review required | Counsel | Pending | Driver and passenger safety | Approved limits must be enforced |

## Source notes

- Africa's Talking Uganda pricing: <https://africastalking.ug/pricing?lang=en>
- Twilio Verify pricing: <https://www.twilio.com/en-us/verify/pricing>
- Twilio Uganda SMS pricing: <https://www.twilio.com/en-us/sms/pricing/ug>
- Bank of Uganda 2025 National Payment Systems Oversight Framework: <https://bou.or.ug/uploads/Revised_BOU_National_Payment_Systems_Oversight_Framework_2025_698b3e9745.pdf>
