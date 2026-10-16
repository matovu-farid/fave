# Per-vehicle transport pricing design

**Status:** Design and written spec approved by product owner; implementation in progress on `main`
**Date:** 2026-10-14  
**Issues:** [#8 vehicle listings](https://github.com/matovu-farid/fave/issues/8), [#9 trip estimates](https://github.com/matovu-farid/fave/issues/9), [#10 client trip request](https://github.com/matovu-farid/fave/issues/10), [#15 fare and settlement policy](https://github.com/matovu-farid/fave/issues/15)

## Problem and goal

Fave currently uses a shared per-kilometre rate for all vehicles. That cannot reflect the fact that different cars have different fuel costs and different value or comfort levels. A driver may register more than one car, so pricing must belong to each vehicle.

Ask the driver one pricing question for each car: **“How much would you charge Fave for Kampala to Jinja and back in this car?”** The driver supplies one UGX amount for the full benchmark journey. That amount represents the vehicle's combined transportation and vehicle-type value; Fave does not ask the driver to split fuel and luxury into separate prices.

Fave derives an effective per-kilometre rate from the saved benchmark amount and a fixed Kampala–Jinja round-trip road distance. For each client quote, Google Maps supplies separate outbound and return road distances. Fave applies the selected car's saved rate to each leg and displays separate outbound and return lines. The driver's lodging rate remains a separate per-night line.

## Approaches considered

1. **Per-car Kampala–Jinja round-trip benchmark (recommended and selected).** Each vehicle has one driver-entered benchmark amount; Fave derives its rate. This matches the driver's ability to account for both fuel and vehicle type without requiring an artificial split, while giving Fave a consistent input to calculate with.
2. **Driver enters a rate per kilometre.** This is a shorter form, but drivers may estimate a kilometre differently and it does not anchor comparisons to the agreed example route.
3. **Fave sets one rate per vehicle class.** This is easier to administer centrally, but does not capture differences between individual vehicles or each car's driver-supplied operating price.

## Driver and operations flow

- Add a required whole-number UGX round-trip benchmark amount to each vehicle submission. The field is specific to that car; a driver's other cars have independent amounts.
- The benchmark means a Kampala-to-Jinja trip and its return journey. The Fave configuration uses one fixed reference route and stores its Google Maps round-trip distance and configuration version. The driver is asked only for the amount; Fave supplies the distance basis.
- Store the original amount, reference distance, derived per-kilometre rate, currency, and rate/configuration version. Do not store only the derived rate, because Fave must be able to show how the price was calculated.
- A vehicle and its submitted benchmark become available for client quotes only when the vehicle's existing approval flow makes the listing eligible. Price changes use the vehicle's review workflow; pending changes do not silently replace the effective rate used for existing quotes.
- Preserve the existing driver lodging rate at driver level. Do not ask the driver to re-enter lodging for each car.

The fixed reference route must be configured and its round-trip Google Maps distance recorded before any per-car rate is activated. The route is the same for all drivers to keep their submitted amounts comparable. The approximately 80 km one-way distance discussed for Kampala–Jinja is a planning estimate; the saved Google Maps reference distance is the calculation basis.

## Client quote calculation and display

For an eligible selected vehicle and an accepted driver offer:

1. Calculate the Google Maps driving distance from pickup to destination.
2. Calculate the return driving distance independently from destination back to pickup. Do not assume the reverse route is identical to the outbound route.
3. For each leg, multiply that leg's distance by the selected vehicle's effective per-kilometre rate derived from its benchmark amount.
4. Show **Outbound transport** and **Return transport** as separate quote lines. Both use the selected car's rate, which already combines its fuel/operating cost and vehicle-type value. Show **Driver lodging** as a separate line using the accepting driver's registered per-night rate and the saved Kampala-date night-count calculation.
5. Calculate the total and deposit using the currently effective, approved fare policy. The chosen UGX 2,000/km amount remains a comparison/reference point; it is not a universal rate or a fallback for a vehicle without an approved rate.

The client sees both routes, distances, quantities, unit rate, line amounts, lodging nights/rate, total, deposit, and expiry before accepting terms and paying. Do not hide a return charge in the outbound amount or add a checkout-only surcharge.

## Saved quote and change behavior

The immutable quote snapshot contains:

- selected vehicle and accepted driver;
- driver's original round-trip benchmark amount and currency;
- canonical reference route identity/version and round-trip distance used to derive the rate;
- derived per-kilometre rate and rate/configuration version;
- outbound and return route geometry/summary as currently retained by Fave, each leg's distance and duration, and each calculation quantity/rate/amount;
- driver lodging rate, trip dates, night count, and calculation;
- line-item totals, currency, deposit basis/amount, policy version, and quote expiry.

Later edits to a vehicle's benchmark, the canonical benchmark distance, or the fare policy affect new quotes only. Existing accepted quotes keep their recorded calculation. For a client-requested extension, reuse the accepted vehicle rate and lodging-rate snapshots; any route or distance change requires a revised quote and explicit client acceptance under #15 before changing the booking or collecting additional money.

## Validation and failure behavior

- Reject zero, negative, fractional, malformed, or out-of-bound benchmark amounts at both the app and API. Keep national ID and other private driver material out of pricing responses and logs.
- Do not quote a vehicle without an approved benchmark amount, an eligible accepted driver, an active fare policy, or supported route data for both legs.
- If either Google Maps leg fails, return a clear estimate error and do not substitute zero distance, straight-line distance, or a one-way-only price.
- Record who submitted and approved a benchmark change and when. Do not expose private driver profile/contact data in the client quote.
- The driver offer still precedes the final quote. Do not request payment details, authorize, or charge while the driver is deciding.

## Verification

Add focused tests for:

- deriving distinct rates for two cars belonging to one driver from the same reference distance;
- saving the original amount, basis distance/version, and derived rate in a quote snapshot;
- computing outbound and return directions separately and itemizing each with the selected car's rate;
- preserving the accepted rate across vehicle-rate edits and trip extensions;
- rejecting missing or invalid rates, inactive fare policy, failed return routes, unsupported locations, and stale/changed quotes without charging;
- ensuring the client response contains no private driver data and never falls back to the old global UGX 2,000/km value.

Manually test the web booking flow at `http://localhost:8081` and the physical-device flow after implementation. End-to-end quote validation remains gated on approved client terms and an active approved fare policy; those launch/legal gates must remain closed until their owners resolve them.

## Decisions still required before activation

- Configure the exact fixed Kampala and Jinja reference endpoints and approve the corresponding Google Maps round-trip distance.
- Whole-shilling nearest rounding is owner-confirmed on 2026-10-16; finalize the remaining fee/deposit/provider decisions in #15.
- Validate the driver-entered benchmark rates against actual operating costs and approved provider fees before enabling customer-facing quotes.
- Complete counsel, provider, and launch approvals. This design is not legal approval or authorization to activate rates or charge customers.

## Owner-confirmed currency and rounding update — 16 October 2026

All client prices are UGX rounded to the nearest whole shilling. Retain the exact
benchmark ratio during calculation; round each transport leg once using positive
half-up ties. Sum rounded component amounts, round the deposit the same way, and
subtract it from the total for the balance. Display fractional derived per-km
rates as approximate whole-shilling figures; snapshots retain precise rates.

The future approved policy explicitly selects vehicleBenchmark.rounding:
nearest_per_leg. Its new estimates use that rule even for existing vehicles,
without changing their original amount/route/distance ratio or rewriting stored
vehicle submissions. Earlier saved estimates/quotes and their accepted extensions
retain their own ceiling_per_leg or nearest_per_leg rule and price. Reject
currency mismatches, unsafe amounts and zero-rounded deposits. This update does
not approve provider-fee inclusion, activate a fare policy, or enable payments.
