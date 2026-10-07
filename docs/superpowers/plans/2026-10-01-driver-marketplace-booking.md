# Driver Marketplace and Booking Implementation Plan

> **For agentic workers:** Implement this plan inline in the current workspace, in task order. Keep the four GitHub issues in progress until all acceptance criteria are met. Steps use checkbox syntax for tracking.

> **Scope update — 2026-10-04:** Ugandan counsel approved decision D-13: V1 does not require one-time-code phone verification for driver applications or approvals, client bookings, or assignment-time contact release. Phone numbers remain contact details, and separate client consent is still required before sharing them with an assigned driver. This supersedes the older phone-verification steps below. Other legal documents, verification checklists, retention rules, and regulatory decisions remain subject to their own approval.

**Goal:** Add secure driver application and verification workflows, approved vehicle listings and date availability, and a client trip request flow to the Expo app and Hono Worker.

**Architecture:** Keep identity/session handling in Better Auth, add role-checked domain APIs backed by D1, and store private ID and vehicle evidence in a private R2 bucket served only through authenticated Worker routes. The mobile app consumes those APIs through authenticatedFetch and keeps public vehicle data separate from reviewer-only evidence. Terms, counsel-required checklists, retention, and fare/hold policy are configuration gates; missing prerequisites prevent submission, approval, publishing, or booking rather than falling back to demo values.

**Tech Stack:** Expo SDK 57, Expo Router, React Native, expo-image-picker, Hono, Cloudflare D1, private R2, TypeScript.

---

## File structure

- Create `fave-worker/migrations/0002_driver_marketplace.sql` for roles, policy records, driver applications, vehicle records/media, availability, quotes/bookings, and audit events.
- Create `fave-worker/src/marketplace-auth.ts` for session lookup and role checks.
- Create `fave-worker/src/private-files.ts` for upload validation, private R2 storage, and role-scoped file reads.
- Create `fave-worker/src/drivers.ts` for application state and admin review APIs.
- Create `fave-worker/src/vehicles.ts` for vehicle CRUD, evidence review, client-safe catalog, and availability.
- Create `fave-worker/src/bookings.ts` for trip validation, quote snapshots, availability revalidation, and expiring holds.
- Modify `fave-worker/src/index.ts` only to compose routes and CORS policy.
- Modify `fave-worker/wrangler.jsonc` to bind the private R2 bucket used by the Worker.
- Create `src/lib/marketplace.ts` for typed authenticated API calls and safe error decoding.
- Create `src/components/marketplace/*` for focused form, status, vehicle, and prerequisite-gate components.
- Create Expo Router screens under `src/app/driver/*`, `src/app/trips/*`, and `src/app/admin/*`; keep route files as thin composition layers.
- Modify `src/components/app-tabs.tsx` and `.web.tsx` to expose Trips and Driver areas to signed-in users, with admin review links rendered only for authorized admin profile state.
- Modify `app.json` for the Expo ImagePicker config plugin and a photo-library permission message that explains upload purpose.

## Task 1: Add domain schema and authorization primitives

1. Add D1 tables for user roles, versioned policy documents, acknowledgements, driver applications, review decisions, audit events, vehicles, vehicle media metadata, vehicle decisions, availability, quote policy, quotes, and bookings.
2. Add constraints and indexes for user ownership, permitted state values, overlapping date lookup, unique current application, and idempotent hold references.
3. Add session and role helpers that return `401` for unauthenticated requests and `403` for insufficient role. Admin membership comes only from provisioned server-side role rows; there is no self-service admin grant endpoint.
4. Add fail-closed prerequisite readers. An absent current counsel-approved document, approved verification checklist, retention policy, or active fare/hold policy is unavailable, never inferred from a proposed default.
5. Add a restricted audit helper which records actor, action, target, prior/new state, reason, and timestamp without including national IDs, file bytes, addresses, or raw request bodies.

## Task 2: Implement private file handling and driver registration

1. Bind a private R2 bucket and add an authenticated upload route accepting one image/PDF with a strict byte limit, allowlisted MIME type, and file-signature validation. Generate opaque object keys server-side and omit client filenames and keys from public responses.
2. Add a private-file read route requiring an authorized role and reason for sensitive ID evidence; audit each read. Keep original documents private and never return bucket URLs.
3. Add driver application submission/status/resubmission routes. Validate legal name and contact phone, require a current driver policy acknowledgement and every active checklist item, save sensitive ID fields only in the protected application store, and begin submitted applications as `pending_verification`. Phone numbers are contact details only; V1 does not require one-time-code verification.
4. Expose a driver-safe status response containing state, next action, and the applicant-visible rejection reason only.
5. Add driver onboarding and application-status screens with purpose/reviewer disclosure, image selection, policy acceptance records from the current policy registry, and a visible blocked state when required documents, policy, or retention rules are unavailable.

## Task 3: Implement protected driver verification

1. Add an admin-only pending-application queue which omits national-ID values and file contents.
2. Add a narrow evidence-review route requiring an admin role and audit reason; return only documents named in the active checklist.
3. Add approve, reject, and suspend actions with a non-empty reason, valid state transition, active checklist completion, current policy acceptance, actor/time, and prior/new state in one D1 batch. Phone verification is not required under D-13.
4. Make every vehicle creation, vehicle publication, client selection, and assignment eligibility check read the authoritative driver state server-side.
5. Document operator provisioning of admin role rows and private R2 setup without adding a bootstrap admin secret or self-promotion path.

## Task 4: Implement vehicle listings, images, review, and availability

1. Add driver-owned vehicle create/update routes limited to approved drivers. Capture make, model, year, passenger/luggage capacity, comfort/accessibility details, and private registration fields.
2. Store original vehicle evidence privately. Keep public-facing photos in a separate approval state; do not expose photos until an authorized reviewer approves them.
3. Add admin-only vehicle review actions with reasons and audit history. Return vehicle facts and approved photos from a client-safe catalog that excludes driver identity/contact and private fields.
4. Add date-aware driver availability and upcoming hold/trip reads. Reject unavailable ranges and overlaps with live pending holds or confirmed trips.
5. Add driver listing editor, photo review state, availability calendar/list, and an admin-only review screen/API surface.

## Task 5: Implement client trip request and vehicle selection

1. Add a trip request route that validates Uganda pickup coverage via the existing Google Maps helper, destination in Uganda, party/luggage limits, Kampala-local dates, and maximum seven-day duration.
2. Return only approved, available vehicles with approved client-facing photos and vehicle facts. Do not include driver identity or contact information.
3. Build immutable quote records from the current active fare policy and existing Maps route estimate. Return distance/time, price breakdown/currency, policy version, expiry, and an opaque quote ID; return a clear unavailable error when fare rules are not configured.
4. Add booking confirmation that rechecks client profile/contact details, separate contact-sharing consent, current required terms, quote freshness, and vehicle availability in an atomic D1 batch before creating a configurable expiring hold. Phone verification is not required under D-13.
5. Store exact itinerary, party details, selected vehicle, quote snapshot, and accepted policy versions with the booking. Release expired holds using the active hold policy and require explicit reconfirmation for changed quotes.
6. Add trip request, available vehicle selection, quote review, and booking status screens. Keep the submit action disabled with a concrete explanation while any required prerequisite is unavailable.

## Task 6: Integrate and verify

1. Add typed mobile API functions for each server route and map API errors to user-facing state without logging personal fields.
2. Verify unauthorized users cannot access domain routes, non-admins cannot review, non-approved drivers cannot list vehicles, unapproved vehicles never appear in client choices, and overlapping active holds cannot both be created.
3. Verify uploads with an invalid MIME/signature/oversize body fail before storage and no sensitive values appear in API responses, public file URLs, logs, or the rendered client catalog.
4. Run `npx expo lint`, `npx tsc --noEmit`, and Worker TypeScript checking; run Expo web and Worker locally, then inspect the signed-in app in the browser at a mobile viewport.
5. Leave the four issues in **In progress** until all upstream prerequisites and their acceptance criteria are actually available; do not close issues based solely on placeholder gates.

## Current hard gates

- #14 has not supplied counsel-approved driver/client terms, verification checklist, or retention/deletion policy. Decision D-13 removes phone OTP as a prerequisite; it does not approve the remaining policies.
- #15 has not finalized fare calculation or hold expiry policy; its dated defaults are explicitly working proposals.
- #21 still owns client profile and contact-sharing consent records. Phone verification is out of V1 scope under D-13.
- #22 phone-code verification is out of V1 scope under D-13.
- #17 owns the full staff operations console; the requested #7 scope here is its protected review API/workflow, not a replacement console.
- GitHub CLI authentication is currently invalid (`gh auth status` on 2026-10-03). Local branch changes are writable; use the signed-in GitHub browser for project tracking and PR creation until CLI authentication is restored.

## Current acceptance audit — 2026-10-03

This is an implementation audit, not a release approval. The draft policy documents in `docs/compliance/` are not counsel-approved and must not be activated as current policy records.

| Issue | Implemented in this branch | Acceptance evidence still missing |
| --- | --- | --- |
| #6 Driver registration | `src/app/driver/index.tsx` and `fave-worker/src/drivers.ts` collect a Ugandan citizen affirmation, National ID number and images, private checklist evidence, policy acknowledgement, and applicant-visible status/resubmission. Driver identity is not requested in client routes. | Current counsel-approved driver terms/privacy, checklist, and retention policy (#14). Phone OTP is not required under counsel-approved decision D-13. User-directed scope is citizen drivers only; foreign nationals and refugees are declined. The passport-style image is a separate driver photo, not another identity document. |
| #7 Admin verification | `fave-worker/src/drivers.ts` provides role-checked pending review, reasoned identity/document access with audit events, approve/reject/suspend transitions, and server-side approval eligibility checks. | Counsel-approved checklist and retention rules (#14), provisioned designated reviewers, and the operations console owned by #17. Phone OTP is not required under D-13. |
| #8 Vehicle listings | `fave-worker/src/vehicles.ts` and `src/app/driver/index.tsx` provide driver-owned listings, private evidence, individually approved client photos, corrections, and unavailable-date/hold views. Vehicle and driver approval are rechecked server-side. | Counsel/authority-approved vehicle checklist and retention policy (#14), including required permits, roadworthiness and insurance evidence. The Cloudflare Images binding must be enabled before vehicle photo uploads can run in production. |
| #10 Trip request | `fave-worker/src/bookings.ts`, `src/app/trips/index.tsx`, and the Maps API provide private pickup address/pin handling, Uganda destination checks, approved-vehicle selection, quote snapshots, separate phone-sharing consent, and atomic expiring holds. Client APIs omit driver identity and ID fields. | Current client/booking disclosures and fare/hold policy (#14/#15), client profile and contact-sharing consent (#21), configured Maps key (#18), and deposit processing (#11). Phone OTP is not required under D-13. Authenticated end-to-end behavior remains unverified. |

Static verification on 2026-10-03: `npx expo lint`, `npx tsc --noEmit`, `npx tsc --noEmit -p fave-worker/tsconfig.json`, and `git diff --check` passed. These checks do not replace browser, D1 integration, or external-provider verification. The marketplace branch is based on the open Maps PR #23 because trip pickup and route validation depend on it; keep #23 unchanged and target it as the base for any dependent marketplace review.
