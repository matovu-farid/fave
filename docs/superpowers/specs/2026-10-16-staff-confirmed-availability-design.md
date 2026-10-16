# Staff-confirmed vehicle availability and client booking design

**Status:** Approved by product owner
**Date:** 2026-10-16  
**Issues:** [#9 distance and accommodation estimates](https://github.com/matovu-farid/fave/issues/9), [#10 client trip request](https://github.com/matovu-farid/fave/issues/10), [#12 pre-quote driver assignment](https://github.com/matovu-farid/fave/issues/12), [#31 admin driver follow-up](https://github.com/matovu-farid/fave/issues/31)

## Problem and goal

The client needs to see a useful price before deciding whether to book. Fave should then call the driver assigned to the selected vehicle and confirm that the vehicle is available for the client's requested dates before asking for a deposit. This replaces the driver's 15-minute in-app acceptance step. The estimate must become the final quote at the same price, and staff confirmation must hold the vehicle for that client during the quote window.

## Product decisions

- Assign each vehicle to its driver and calculate the estimate from the vehicle's saved benchmark price, the assigned driver's saved lodging rate, the requested route, and dates.
- Show the estimate before the client asks Fave to book. The price and calculation are saved at that point.
- When the client asks Fave to book, create a **separate staff availability request linked to the saved estimate**. Do not send a trip offer to the driver.
- Staff call the assigned driver and record the call outcome. A staff member can confirm or mark unavailable only for the requested dates; this does not make the car generally available.
- Confirmation keeps the saved estimate price fixed. It creates a date-specific vehicle hold for that client lasting through the configured quote window.
- Show the final quote after staff confirms. The client accepts the required terms and starts the deposit process before the quote and hold expire.
- If the driver says the vehicle is unavailable, tell the client no deposit is due and ask them to choose another car.
- Never show client contact details in the staff availability queue. Driver contact access and each call attempt remain role-restricted and audited.

## Client flow

1. The client enters route, dates, passenger count, and luggage count, then selects an approved vehicle.
2. Fave shows a **price estimate** for that selected vehicle, with outbound transport, return transport, driver lodging, and the total. Include route distances, vehicle, driver lodging rate, night count, and a plain-language calculation. Do not describe the estimate as a confirmed booking or a hold.
3. The client chooses **Ask Fave to book these dates**. Fave saves a separate availability request linked to the immutable estimate and shows that staff are checking with the driver. There is no payment during this stage.
4. While staff are checking, show the request state and dates. Let the client withdraw the request; withdrawing ends staff follow-up and does not charge the client.
5. If staff confirms availability, Fave converts the saved estimate into a final quote at the exact same price, starts the configured quote-expiry clock, and holds the selected vehicle for these dates for this client until that expiry. Notify the client and show the final quote, terms, and next step to pay.
6. If the client accepts the required disclosures and begins the deposit flow before expiry, create the normal booking/deposit hold atomically while releasing the quote hold. Avoid any gap where another request can take the dates.
7. If the client does not continue before expiry, release the date-specific hold. The client can start again with current availability and a new estimate.
8. If staff marks the requested dates unavailable, close the request, do not create a quote hold or request payment, and return the client to vehicle selection.

Use calm, step-by-step copy that makes the price and current status easy to understand. Keep the interaction compact: route and dates, estimate, staff check, confirmed quote, payment. The estimate screen should let the client edit details or back out without creating an availability request.

## Staff flow

- Add a **Needs availability check** queue in the protected Admin screen. Show age, client-safe route summary, requested dates, selected vehicle, estimate total, and any prior call attempts. Do not show client phone or private address.
- An authorized staff member opens the assigned driver's contact details only when needed; record that access in the audit trail.
- Staff record call outcomes such as reached, no answer, busy, voicemail, or other, with an optional operational note. Call records contain actor and timestamp.
- After reaching the driver, staff can confirm these requested dates or mark the car unavailable for these dates. Require a confirmation action with clear vehicle and dates.
- Do not let staff alter the saved estimate price, change the selected car or driver, extend the quote, or act as the driver. If the driver is unavailable, close the request and ask the client to choose another car.
- Before confirming, recheck that the dates are not already held or booked. If another request acquired an overlapping hold first, prevent confirmation and show staff that the dates are no longer available.
- Show confirmed requests in a separate **Quote sent** status until the client pays/starts the deposit flow or the quote expires. Show unavailable, withdrawn, expired, and converted requests in recent activity.

## Data and lifecycle

Introduce immutable saved estimates and a separate availability-request record. The estimate stores all calculation inputs and line items needed to reproduce the displayed amount: route and both leg distances, vehicle and its benchmark/rate version, assigned driver and lodging-rate snapshot, trip dates and Kampala night-count calculation, policy version, currency, deposit calculation if shown, and item totals. The estimate also records its creation time and owner. Do not use a later driver or vehicle rate edit to change it.

The availability request links to exactly one estimate and stores its client, vehicle, assigned driver, requested dates, state, creation time, staff decision, and audit timestamps. Call attempts are separate append-only records with staff actor, time, outcome, and optional note. Contact-detail reads are audited.

Suggested request states: `requested`, `confirmed`, `unavailable`, `withdrawn`, `expired`, and `converted_to_booking`. A successful `confirmed` request receives a `hold_expires_at` equal to the final quote expiry. The system must treat only unexpired confirmed requests as date holds. Pending staff checks do not reserve a car.

On staff confirmation, create the immutable `trip_quotes` row from the saved estimate and set `expires_at` to confirmation time plus the active fare policy's `quote_ttl_seconds`. The total and itemized amounts must match the estimate exactly. Keep the estimate for traceability. On client confirmation, atomically create the normal booking using the same snapshot and release/convert the request hold so that the booking's existing deposit hold continues without an availability gap.

Before an estimate can be shown, verify the selected vehicle is approved, has an assigned eligible driver, has an approved pricing benchmark, has an active fare policy, and both route legs can be priced. If these prerequisites are not met, explain that a price is not available for that car. Keep quotes and payments inactive while required policy, provider, or legal gates remain unresolved.

## Availability and race handling

All availability checks must use the same date-overlap rule: `existing.start_date < requested.end_date AND existing.end_date > requested.start_date`. Exclude a request's own hold when converting it into a booking. A request in `requested` state is not a hold. Confirmation must atomically check for overlapping unexpired confirmed availability holds, pending/confirmed bookings with active holds, and driver/vehicle unavailability. If any conflict exists, do not create the quote or hold.

If multiple staff requests exist for the same dates, the first successfully confirmed request receives the hold. Other requests remain actionable only if still eligible; staff must be shown the conflict and cannot promise the dates. A driver's later availability change or an admin suspension must prevent new confirmations and surface affected active requests for staff review; do not silently change a client's quoted car or price.

## Security and privacy

- Enforce admin role checks on every queue, contact lookup, call-log, and confirmation endpoint; hiding UI controls alone is insufficient.
- Return only broad route areas and operational fields in queue lists. Exclude exact private pickup addresses, client contact, payment details, national IDs, and credentials.
- Keep client APIs scoped to the signed-in client and only their own estimates, requests, and quotes.
- Audit staff contact access, call outcomes, availability decisions, and state changes with actor, timestamp, target, reason where applicable, and prior/new state.
- Do not include private details in app notifications or logs. A delivery failure must not alter request or quote state.

## Failure behavior

- Driver unreachable: staff can record attempts and leave the request awaiting follow-up; no automatic driver timeout, quote, or deposit.
- Driver says unavailable: mark unavailable for these dates, release any provisional state, and tell the client to choose another vehicle.
- Vehicle/date conflict discovered at confirmation: prevent the hold and quote; staff contacts the client through the existing support process and requests a different car.
- Quote expires before client proceeds: expire the quote and release its hold. A new request must use a fresh estimate and current availability.
- Client withdraws while awaiting staff: close the request. Ignore any later confirmation attempt.
- Repeated or concurrent staff actions: use conditional state transitions so only one decision wins; return the current state to the losing request.
- Routing, fare policy, or required rate data unavailable: do not show a misleading estimate or create an availability request.

## Verification

Add focused tests for:

- estimate snapshot calculation and immutability across later vehicle, driver lodging-rate, and fare-policy changes;
- client estimate-before-request flow and that estimate and final quote totals match exactly;
- client ownership checks for estimates, availability requests, and quotes;
- no driver-app offer or 15-minute expiration is created by an availability request;
- staff authorization, audited contact access, call outcomes, and date-specific confirmation/unavailability;
- a confirmed request holds dates only until quote expiry, while a pending request does not hold dates;
- overlapping request/booking/unavailability conflicts, concurrent confirmation, withdrawal races, and atomic conversion to a booking hold;
- unavailable, expired, withdrawn, and quote-sent client experiences, with no payment before quote acceptance;
- client contact, exact pickup address, ID, and payment data absent from staff queues and logs.

Manually test the signed-in client estimate-to-booking path and staff queue at `http://localhost:8081`, then the physical-device flow. The current browser session is signed out, so browser end-to-end testing will need an authenticated session. Keep legal/provider launch gates closed until their owners resolve them.

## Related issue updates

Before implementation, update #10, #12, and #31 so their acceptance criteria describe estimates before client intent, staff date-specific confirmation, and quote-window holds instead of the 15-minute driver-acceptance flow. Keep unrelated provider, legal, safety, and launch blockers unchanged.
