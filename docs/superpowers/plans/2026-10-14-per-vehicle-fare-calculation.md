# Per-vehicle Transport Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Keep all work on the currently checked-out `main`; create no branch or worktree.

**Goal:** Collect one Kampala–Jinja round-trip benchmark per vehicle, derive its effective transport rate, and show immutable outbound and return prices in client quotes.

**Architecture:** Keep the driver-entered benchmark and its approved route basis on each vehicle. A focused fare-calculation module validates the benchmark and computes both directed Google Maps routes; booking quotes snapshot the car-specific basis, each leg, lodging calculation, policy version, and total. The client sees two transport lines and lodging separately. Existing vehicle approval, accepted-quote immutability, and trip-extension rules remain authoritative.

**Tech Stack:** Expo SDK 57 / React Native, Expo Router, Hono Cloudflare Worker, D1 / SQLite migrations, Google Routes API, Node test runner.

---

## Scope and safety gates

The owner approved the design in `docs/superpowers/specs/2026-10-14-per-vehicle-fare-calculation-design.md`. This plan covers vehicle registration and edits, quote calculation and display, stored quote calculations, and extension compatibility. Do not publish customer-facing fares or activate a new fare policy as part of implementation. The exact Kampala/Jinja endpoints and route distance, component rounding, actual driver cost validation, and legal/provider/launch approvals remain activation gates. Until an approved benchmark basis and rounding policy are configured, quote creation must fail closed; it must never fall back to UGX 2,000/km, zero, straight-line distance, or a single leg.

The GitHub issues #8, #9, #10, and #15 are already in progress. Keep their project status in progress until their acceptance criteria and dependent approvals are complete. Do not mark any issue Done before its work is merged.

## Files and responsibilities

- Create `fave-worker/src/vehicle-fares.ts` for benchmark validation, exact ratio-based per-leg amount calculation, and quote component construction. It accepts a versioned benchmark basis instead of inventing or hardcoding Kampala/Jinja endpoints.
- Create `fave-worker/migrations/0018_vehicle_fare_benchmarks.sql` to add the submitted Kampala–Jinja round-trip amount and the reference route/version/distance snapshot to each vehicle. Keep monetary amounts as whole UGX integers and preserve existing rows as unpriced. The route basis and rounding mode come from the currently approved, versioned `fare_policies.rules_json`; do not add a second, unversioned route configuration source.
- Modify `fave-worker/src/vehicles.ts` to validate and save a required benchmark during registration, expose the owner's saved benchmark in the authenticated vehicle response, and include it in the current vehicle-review data. Changing an approved vehicle benchmark must pause the listing using the existing review state flow. Do not return the benchmark in the public vehicle catalog.
- Modify `src/lib/marketplace.ts` and `src/app/driver/index.tsx` to capture exactly one UGX round-trip amount for each car, explain that it includes fuel/operating and vehicle-type value, show the configured reference route and distance, and keep unavailable or unconfigured benchmarks from being submitted.
- Modify `fave-worker/src/bookings.ts` to fetch outbound and return Google driving routes independently after the selected driver accepts, reject incomplete routes or unapproved rates, and create two transport components from the selected vehicle's saved benchmark. Preserve the separately registered driver lodging component, active approved fare-policy components that are not transport, and deposit calculation.
- Modify `fave-worker/src/trip-extensions.ts` and `src/lib/marketplace.ts` only as needed to validate the expanded accepted quote snapshot and to preserve the accepted vehicle-rate basis on extensions. An extension that changes either route requires a newly calculated quote and client acceptance; an extension that only adds nights uses the accepted lodging rate and does not silently recalculate transport.
- Modify `src/app/trips/index.tsx` to render the outbound transport line, return transport line, each direction's distance and derived unit rate, driver lodging and nights, and quote total from the server snapshot.
- Create `tests/vehicle-registration.test.mjs` for registration/edit API behavior and `tests/vehicle-fares.test.mjs` for pure calculations. Extend the existing `tests/vehicle-catalog.test.mjs`, `tests/quote-snapshot.test.mjs`, `tests/quote-immutability.test.mjs`, `tests/trip-extension-quote.test.mjs`, and `tests/trip-quote-display.test.mjs` for privacy, snapshots, extension rules, and presentation. Add `tests/vehicle-fare-quote-ui.test.mjs` for the client quote rendering contract.
- Update `docs/policies/mvp-booking-policy-draft.md` to reflect the owner's selected separate outbound and return lines and per-car benchmark approach, while retaining all unapproved amounts/rules as inactive drafts.

## Tasks

### Task 1: Add pure benchmark and leg-fare calculations

**Files:**
- Create: `fave-worker/src/vehicle-fares.ts`
- Create: `tests/vehicle-fares.test.mjs`

The module contract is:

```ts
export type VehicleBenchmarkBasis = {
  routeId: string
  routeVersion: string
  origin: { label: string; latitude: number; longitude: number }
  destination: { label: string; latitude: number; longitude: number }
  roundTripDistanceMeters: number
  rounding: string
}

export type VehicleFareBenchmark = {
  amountUgx: number
  currency: 'UGX'
  basis: VehicleBenchmarkBasis
  derivationVersion: 1
}

export function calculateVehicleFareLeg(
  benchmark: VehicleFareBenchmark,
  legDistanceMeters: number,
): { amountUgx: number; rateUgxPerKm: number } | null
```

- [x] **Step 1: Write failing tests for benchmark validation and per-leg calculation**

Test that a valid positive whole-UGX benchmark and positive versioned round-trip meter distance yield a stable rational rate. Test per-leg amount calculation using exact integer arithmetic with the configured rounding rule, separate outbound and return distances, non-identical directional distances, and safe-maximum boundaries. Reject zero, negative, fractional, malformed, unsafe-integer, missing-distance, and unsupported-rounding inputs. Add a test proving outbound plus return uses the full driver-entered round-trip basis without doubling or hiding a direction.

- [x] **Step 2: Run the focused test and confirm the expected missing-module failure**

Run from the repository root:

```bash
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test tests/vehicle-fares.test.mjs
```

Expected: FAIL because `fave-worker/src/vehicle-fares.ts` does not exist yet.

- [x] **Step 3: Implement only the pure calculations exercised by the tests**

Export the declared benchmark types and calculator. Represent the effective rate by the original amount and reference round-trip meter distance so calculations retain full precision; do not store a second lossy rate. Calculate line amounts with overflow-safe integer arithmetic using the rounding mode explicitly supplied by the approved fare policy; do not choose a rounding mode in code or invent a default. Expose the mathematical per-kilometre rate for display. Return `null` if the mode or basis is absent, invalid, or unsupported. Tests may exercise a supported mode, but it must remain unavailable to real quotes unless explicitly configured and approved. Do not put Google Maps calls, D1 queries, or user-facing route labels in this module.

- [x] **Step 4: Run focused fare tests and inspect arithmetic boundaries**

Run the same focused Node test command. Expected: all rate, direction, validation, overflow, and configured-rounding assertions pass.

- [x] **Step 5: Commit the calculation module and tests on `main`**

Run `git diff --check`, stage only the new module and test, and commit with `feat: add per-vehicle fare calculations`.

### Task 2: Persist a vehicle's submitted benchmark and approved basis

**Files:**
- Create: `fave-worker/migrations/0018_vehicle_fare_benchmarks.sql`
- Create: `tests/vehicle-registration.test.mjs`

The migration adds nullable legacy-safe vehicle columns:

```sql
ALTER TABLE vehicles ADD COLUMN benchmark_amount_ugx INTEGER
  CHECK (benchmark_amount_ugx IS NULL OR benchmark_amount_ugx BETWEEN 1 AND 1000000000);
ALTER TABLE vehicles ADD COLUMN benchmark_route_id TEXT;
ALTER TABLE vehicles ADD COLUMN benchmark_route_version TEXT;
ALTER TABLE vehicles ADD COLUMN benchmark_distance_meters INTEGER
  CHECK (benchmark_distance_meters IS NULL OR benchmark_distance_meters BETWEEN 1 AND 1000000000);
ALTER TABLE vehicles ADD COLUMN benchmark_rounding TEXT;
```

- [x] **Step 1: Add migration-backed failing tests**

Apply migrations `0001` through `0018` in the existing SQLite fixture. Assert the vehicle table stores benchmark UGX, reference route ID/version, and round-trip reference distance; the database rejects invalid ranges; existing vehicles migrate with null/unpriced benchmark fields; and the new benchmark is not present in any public listing projection.

- [x] **Step 2: Run the vehicle migration tests and confirm the missing-column failure**

Run the targeted test file with the repository's Node test command. Expected: FAIL because migration `0018_vehicle_fare_benchmarks.sql` does not exist.

- [x] **Step 3: Add migration 0018 with safe legacy defaults**

Add the nullable benchmark columns above so legacy vehicles remain unpriced and no old policy becomes an implicit benchmark. Do not fabricate a distance, route, approval, or 2,000/km value for existing records. Read an optional `vehicleBenchmark` object from the versioned approved `fare_policies.rules_json`. Validate its route ID/version, nonempty labels, valid Uganda coordinates, positive round-trip distance, and explicit approved rounding mode. Do not seed sample coordinates, distances, or a guessed rounding choice. If any field is missing or invalid, report the basis as unavailable and disable vehicle pricing. Keep the submitted amount and a copy of the route ID/version/distance/rounding together on each vehicle so a later policy change cannot silently rebase an already submitted benchmark.

- [x] **Step 4: Apply the migration in the test fixture and verify legacy records remain unpriced**

Run the targeted SQLite test and confirm both the new constraints and null legacy state.

- [x] **Step 5: Commit the migration and tests on `main`**

Run `git diff --check`; commit with `feat: store per-vehicle fare benchmarks`.

### Task 3: Capture and review the per-car benchmark

**Files:**
- Modify: `fave-worker/src/vehicles.ts`
- Modify: `src/lib/marketplace.ts`
- Modify: `src/app/driver/index.tsx`
- Create: `tests/vehicle-registration.test.mjs`
- Modify: `tests/vehicle-catalog.test.mjs`

- [x] **Step 1: Write failing Worker tests for submitted and changed benchmarks**

Cover a driver's required round-trip amount, server-side whole-number bounds, rejection when the approved benchmark route/rounding basis is unavailable, no saved-rate mutation on malformed updates, audit data for rate changes, and approved-listing review behavior when an existing driver changes the benchmark. Assert the public catalog omits private benchmark submission and operating data while the authenticated owner and authorized review response expose only the needed fields.

- [x] **Step 2: Run the targeted tests and confirm they fail on absent benchmark handling**

Run the focused vehicle test file. Expected: the current endpoint accepts registration without a benchmark and ignores a benchmark update.

- [x] **Step 3: Extend vehicle registration and owner/review responses**

Read the current `vehicles.ts` registration, owner-list, edit, and admin-review code before editing. Validate the amount with `Number.isSafeInteger` and the same upper bound in both app and API. Snapshot the approved route basis with the amount. Include an amount change in the existing listing-change comparison so an approved vehicle moves to the existing re-review state; existing quote snapshots remain unaffected. Keep registration evidence and IDs private, and keep benchmark submissions out of client catalog results.

- [x] **Step 4: Add one labeled benchmark input to the driver car form**

Before editing Expo UI, use the SDK 57 docs linked by `AGENTS.md` (`https://docs.expo.dev/versions/v57.0.0/`) for any Expo API touched. Add one numeric field per vehicle, labeled with the configured Kampala ↔ Jinja round-trip route and its saved road distance. Explain that the one amount includes operating cost and vehicle type. Disable submission and show the exact missing configuration state when the approved route basis is unavailable. Keep all existing private-evidence and existing-vehicle review behavior.

- [x] **Step 5: Run the focused Worker/UI tests, lint, and typecheck**

Run the vehicle tests, then from the repository root run `npm run lint` and `npm run typecheck`. Expected: benchmark validation, rate edit review, data privacy, and existing vehicle flows pass.

- [x] **Step 6: Commit the vehicle entry/API changes on `main`**

Run `git diff --check`; commit with `feat: collect a fare benchmark for each vehicle`.

### Task 4: Calculate and snapshot separate outbound and return quote lines

**Files:**
- Modify: `fave-worker/src/bookings.ts`
- Modify: `fave-worker/src/google-maps.ts` only if a typed route failure or route metadata helper is needed
- Modify: `tests/quote-snapshot.test.mjs` and current booking integration tests

- [x] **Step 1: Add failing quote snapshot tests for two directions and saved calculation inputs**

Test a selected vehicle with one benchmark, an outbound route distance, a separately requested return route distance, lodging nights/rate, and current non-transport fare policy components. Assert the quote contains `Outbound transport`, `Return transport`, and `Driver lodging`, with each direction's own meters, duration, quantity, calculated amount, and selected-vehicle rate basis. Assert the snapshot also contains the driver-entered benchmark amount, currency, route ID/version/distance, derivation version, driver and vehicle identifiers, dates/night count, policy version, deposit basis, and expiry. Reject a missing approval/basis, failed route leg, invalid rounding config, missing vehicle rate, or stale offer; prove the global UGX 2,000/km policy component is never used as a fallback or double-counted.

- [x] **Step 2: Run quote tests and confirm the expected one-route/missing-rate failures**

Run `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test tests/quote-snapshot.test.mjs`. Expected: new assertions fail because quote construction currently uses one route and a policy-wide per-kilometer rate.

- [x] **Step 3: Extend quote snapshot construction using the pure calculation module**

Replace the single-route transport calculation with a typed outbound/return input pair and selected vehicle's approved benchmark snapshot. Preserve accepted non-transport fare-policy components, replace the global transport component with two distinct transport lines, and retain the separately registered driver lodging rate. Do not show either final line before the selected driver accepts. If either route or any approved rate basis is missing, transition the offer to quote failure and return no partial price.

- [x] **Step 4: Fetch Google Maps directions independently after driver acceptance**

Call the existing route service once for pickup → destination and once for destination → pickup. Preserve each route's distance and duration. Reject either provider failure; do not substitute the first route for the second. Keep the offer's 15-minute deadline and accepted-driver/vehicle relationship checks in force through quote persistence.

- [x] **Step 5: Verify quote and immutability regression tests**

Run quote snapshot tests and all current booking tests. Expected: distinct directional distances price independently, lodging remains separate, missing rates fail closed, immutable quote and booking snapshots retain the full calculation, and offer/deposit state transitions remain atomic.

- [x] **Step 6: Commit quote calculation and tests on `main`**

Run `git diff --check`; commit with `feat: quote outbound and return transport by vehicle`.

### Task 5: Render the approved line items and retain extension basis

**Files:**
- Modify: `src/lib/marketplace.ts`
- Modify: `src/app/trips/index.tsx`
- Modify: `fave-worker/src/trip-extensions.ts` only as required by the snapshot shape
- Modify: `tests/trip-extension-quote.test.mjs`
- Modify: `tests/trip-quote-display.test.mjs`
- Create: `tests/vehicle-fare-quote-ui.test.mjs`

- [x] **Step 1: Add failing client contract and extension tests**

Assert the client quote type accepts the full fare basis and two route legs; UI strings include separate outbound and return lines with each actual distance, rate, amount, and lodging nights/rate; and no synthetic aggregate route masks different directional distances. Test that an accommodation-only extension uses the source accepted lodging rate and retains the source vehicle benchmark snapshot without recalculating transport. Test that changing route/distance requires a replacement quote and explicit client acceptance rather than mutating the accepted snapshot.

- [x] **Step 2: Run the focused UI/extension tests and verify they fail**

Run the focused UI and extension Node tests. Expected: client quote types contain one route and current extension snapshots only include per-night components.

- [x] **Step 3: Update typed quote and accepted-snapshot contracts**

Add outbound and return route data and immutable vehicle benchmark calculation metadata to the client quote types. Preserve a validated rate basis in accepted quote data used by the extension helper. Keep extension amounts limited to the policy-defined added-night lines; do not add an unapproved transport extension multiplier.

- [x] **Step 4: Render route-by-route transport line items**

Show two separate labeled transport rows and each leg's Google Maps driving distance; show the rate calculation and line total for each, keep driver lodging as its own nightly row, and display total/deposit/expiry from the server quote. Do not recompute prices in the client. Keep the booking progress, driver-acceptance wait, no-payment-before-acceptance, terms, and existing mobile/web behavior intact.

- [x] **Step 5: Run focused UI/extension tests, Expo lint, and app typecheck**

Run the focused tests, `npm run lint`, and `npm run typecheck`. Expected: UI renders the two server-calculated lines and extension calculation preserves the immutable source rate.

- [x] **Step 6: Commit quote presentation and extension tests on `main`**

Run `git diff --check`; commit with `feat: show separate vehicle transport legs`.

### Task 6: Verify end-to-end behavior and update product policy draft

**Files:**
- Modify: `docs/policies/mvp-booking-policy-draft.md`
- Modify: `docs/superpowers/specs/2026-10-14-per-vehicle-fare-calculation-design.md` only to record implementation facts or owner decisions
- Modify: any test or source file above only if a verification failure demonstrates a requirement gap

- [x] **Step 1: Update the inactive product-policy draft**

Replace the obsolete single passenger-route rate draft with the owner-confirmed per-car Kampala–Jinja round-trip benchmark and separately displayed outbound and return charges. State that the amount combines vehicle operating cost and type value and is distinct from driver lodging. Preserve the 2,000/km value as a comparison/reference only. Keep exact benchmark route, component rounding, actual-cost validation, fare policy approval, provider terms, and legal/launch approval marked as unresolved activation gates.

- [x] **Step 2: Run the whole repository test suite and static checks**

Run `npm test`, `npm run lint`, and `npm run typecheck` at the repository root. Run `npm run typecheck` and `npx wrangler deploy --dry-run` in `fave-worker/`. Expected: all non-environment-dependent tests, app/Worker types, lint, and Wrangler configuration pass; report loopback-only skips precisely.

- [ ] **Step 3: Manually test the browser booking flow**

> **Blocked on signed-in browser access:** the local app's `/` and `/driver` routes both show the sign-in screen when no session exists. The Google OAuth account chooser currently offers two accounts and awaits the owner’s selection. Only these unauthenticated access gates have been manually verified so far; do not enter credentials on the owner’s behalf.

Use the signed-in app at `http://localhost:8081`. Verify driver benchmark entry is one amount per car when an approved basis is configured, invalid amounts are blocked, client vehicle selection is unchanged, the final price remains hidden while the selected driver is deciding, and accepted quotes show the separate outbound and return distances/amounts plus lodging. Verify approved terms and active policy gates still block payment when unpublished. The local web API proxy currently targets the production Worker; do not create test vehicles, offers, quotes, or notifications in production. Use an isolated local Worker/D1 fixture for populated flows, then leave user-facing browser state clean.

- [ ] **Step 4: Review the whole diff and verify branch/worktree state**

Run `git diff --check`, inspect all changed migrations, pricing arithmetic, privacy projections, quote calculations, extension snapshots, app rendering, and policy draft. Confirm the current branch is `main`, no untracked implementation files remain, and all changes are committed locally.

- [ ] **Step 5: Push the completed implementation commits to `origin/main`**

The user has authorized pushing `main`. Push only after the implementation tests and manual browser checks pass. Verify `git status --short --branch` reports `main...origin/main` with no local changes. Do not deploy a pricing policy or activate customer-facing pricing; reference-route, rounding, business-cost, provider, counsel, and launch gates remain closed.

## Self-review against the design

- Per-car one-question benchmark and strict server validation: Tasks 2–3.
- Saved derivation basis, route/version, no guessed route or silent rebase: Tasks 1–3.
- Accepted-driver sequencing, independent Google Maps directions, no partial/fallback quote: Task 4.
- Separate outbound/return lines and distinct distances, same car rate, lodging separate: Tasks 4–5.
- Immutable quote, policy/deposit/expiry, and extension behavior: Tasks 4–5.
- Privacy, missing-rate behavior, activation/legal/provider gates, browser validation, and no production test data: Tasks 2–6.
- Placeholder scan: no TODO/TBD implementation decisions are deferred to an engineer; unresolved activation inputs are explicitly owner/provider/counsel decisions and the implementation remains fail-closed until they are approved.

### Owner-confirmed UGX/nearest rounding — 16 October 2026

- Owner confirmed all client prices in Uganda shillings, rounded to the nearest
  whole shilling. Provider-fee inclusion is a separate pending question. Updated
  the business policy, finished client copy, counsel brief and research record;
  this is no fare/legal activation or legal sign-off.
- Added explicit nearest_per_leg to the saved calculation basis. BigInt ratio
  arithmetic rounds each leg half-up only after multiplying the original
  benchmark amount and exact metres; the displayed per-km figure is approximate
  and does not feed the calculation. The total sums rounded components; nearest
  deposits use integer arithmetic. Reject zero-rounded deposits, unsafe amounts
  and non-UGX policies for a UGX car benchmark.
- New estimates select the active approved policy's explicit nearest rule while
  retaining the existing car's original amount/route/distance ratio. They do not
  rewrite the car or any saved estimate/quote. An absent/malformed active basis
  fails closed rather than silently using a different rounding rule. Old saved
  ceiling calculations, fixed-price staff confirmation and accepted extensions
  retain their saved rule and amounts.
- Reproduced missing-mode/currency behavior, zero deposit, existing-car rollover,
  and malformed-policy fallback failures before their fixes. Coverage includes
  exact half-shilling boundaries, a large safe integer amount, retained fractional
  unit rate, nearest and historical extension snapshots, and immutable old
  estimates after policy/reference changes.
- Full suite: 304 passed, zero failures/skips, using --test-concurrency=2. An earlier
  concurrent build/full-suite run hit the existing decoder subprocess timeout;
  its timeout and security expectations were not relaxed. The lower-concurrency
  rerun passed that test. Lint, app TypeScript and Worker TypeScript also passed.
- Review found an existing-car rollout gap; fixed by applying only the active
  policy's rounding field to the new estimate snapshot, not rebasing its distance.
  Independent follow-up review found no remaining material findings.
- Manual browser: fresh exported app plus an isolated, disposable synthetic
  database/identity/maps fixture. The exact saved rate was2500.00625UGX/km for a
  400001UGX/160000m benchmark and80001m legs. The UI displays approximate2500UGX/km,
  two200003UGX transport lines,84000UGX lodging, total484006UGX and deposit242003UGX.
  No test consent, checkout, phone call, notification or payment was submitted to
  production. Approved fare-policy count remained zero on the read-only check.
- At390px the old row put both amount boxes at x412–476, outside the viewport.
  Bounded wrapping details and a right-aligned amount column corrected this to
  x257–358 at390px and x187–288 at320px. Both transport amounts and the total are
  visible; screenshot:/tmp/fave-nearest-ugx-quote.jpg. No console warnings/errors.
  Test server/tab stopped and viewport reset after verification.
- Rollback compatibility: before nearest pricing is activated, retain a rollback
  build that understands nearest_per_leg. An older ceiling-only build cannot
  validate new nearest snapshots/extensions. Do not rewrite accepted snapshots to
  make a rollback appear compatible; retain the original rounding and price.


### Nearest-UGX release checkpoint

- Main implementation9497de5be02da3d0cb3b293fba295c5e840ea1fe passed exact-commit
  CI38945587084. Production web export and Worker packaging dry run passed.
- Versione9a7194a-5f71-4fe5-a2cc-963fbb20f473, tagmain-9497de5, serves100% traffic
  in deployment16db8cb4-7cca-4beb-9936-af3f593df30c, created
  2026-10-16T18:17:38.437912Z. Runtime and all17 bindings match the preceding
  version5255a7e9-cbbf-4eb3-a5ae-0bd191972e92. No migration or trigger changes.
- Read-only production checks passed: health/database200ok; signed-out request,
  catalog and review-security APIs401JSON; console200HTML. The active approved
  fare-policy count remained zero after release. No fare/legal registry activation,
  provider enablement or live charge was performed.
- Updated issue#15 with the owner-confirmed currency/rounding decision; fee
  inclusion remains the next pending owner question. Canonical benchmark endpoints,
  road distance, provider terms and remaining launch decisions are still open.
