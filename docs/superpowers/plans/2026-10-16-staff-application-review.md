# Owner-verified staff application review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline. Steps use checkbox syntax for tracking. The owner explicitly requires main; do not create a branch, PR or worktree.

**Goal:** Let the owner review driver and vehicle applications individually after a ten-minute unlock using either a passkey or an authenticator code.

**Architecture:** Better Auth 1.7.5 verifies both methods. A request-scoped integration checks reviewer membership and origin before its security endpoints, records short-lived session-bound proof only after verification, and blocks alternative enrollment/management paths. Dedicated review middleware protects existing evidence and decision handlers. Queues expose a minimal safe contract; focused static Expo routes fetch private detail only after unlock. Exported assets are hosted by the existing Worker.

**Tech Stack:** Expo SDK57, React Native Web, Hono, D1 SQLite, private R2, Better Auth 1.7.5, @better-auth/passkey1.7.5, built-in twoFactor.

## File map

- `fave-worker/migrations/0020_staff_review_security.sql`: plugin schemas, explicit reviewer membership, expiring proof, throttling and replay records.
- `fave-worker/src/review-access.ts`: authoritative session lookup, reviewer/proof checks, origin selection, proof persistence and explicit lock.
- `fave-worker/src/review-auth.ts`: request-local Better Auth hooks and plugin configuration; no global request state.
- `fave-worker/src/admin-review-security.ts`: safe security status and lock endpoints.
- `fave-worker/src/auth.ts`: install the focused security configuration alongside Expo/social auth.
- `fave-worker/src/drivers.ts`, `vehicles.ts`: protect existing direct endpoints, sanitize queues, add focused detail contracts without changing eligibility rules.
- `src/lib/staff-review.ts`: typed fetch wrappers; no persistent private cache.
- `src/components/staff-review/`: security setup/unlock, queue, focused detail, evidence and decision forms.
- `src/app/(tabs)/admin/{drivers,vehicles,review-security}.tsx`: static review routes with opaque query IDs.
- `src/app/(tabs)/admin/index.tsx`: review links.
- `fave-worker/wrangler.jsonc`, `src/index.ts`, build script: assets with explicit API routing/404 behavior.
- `tests/staff-review-security.test.mjs`, `tests/staff-review-contracts.test.mjs`: SQL/Hono and real Better Auth cryptography integration.
- `docs/runbooks/staff-review-security.md`: audited provisioning, operator recovery, canonical origin and release/rollback checks.

## Task 1: Security storage and proof boundary

- [x] Add a regression before changing handlers: a normal operations member’s `POST /driver-app/documents/national_id_front/decision` must return403 and leave document/audit unchanged.

```js
const f = availabilityFixture(t)
f.sql.exec("UPDATE driver_applications SET status = 'pending_verification'; UPDATE driver_application_documents SET review_status = 'pending'")
const result = await f.reviewDriver('POST', '/driver-app/documents/national_id_front/decision', {body:{decision:'approve',reason:'Checklist checked'}})
assert.equal(result.status, 403)
assert.equal(f.sql.prepare("SELECT review_status FROM driver_application_documents WHERE id='national_id_front'").get().review_status,'pending')
```

- [x] Run `node --experimental-strip-types --test tests/staff-review-security.test.mjs`; confirm the current handler returns200, proving the missing permission boundary.
- [x] Add migration0020 with exact plugin1.7.5 fields and FK-bound membership/proof. Proof has session ID, user ID, origin, method, credential ID and expiry. Store no code/assertion payload. Do not seed a reviewer.
- [x] Implement authoritative session validation and proof SQL. Require membership active, actual session unexpired, proof unexpired and originating credential still present/verified. All sensitive responses are private/no-store. Lock deletes proof for the actual session only.
- [x] Add negative tests for normal staff/client/driver, wrong user/session/origin, expiry, credential/member/session revocation; add positive cases for both methods. Existing review fixtures opt into synthetic reviewer/proof explicitly where they test document behavior.
- [x] Run focused security and driver regression tests, then Worker TypeScript.

## Task 2: Better Auth verification and enrollment

- [x] Pin and install `@better-auth/passkey@1.7.5`, retaining Better Auth/core/Expo1.7.5. Resolve peers explicitly rather than force or legacy-peer-deps.
- [x] Write handler tests using the real Better Auth instance, synthetic SQL database, signed cookies and generated credentials/codes. Normal users cannot call passkey/two-factor endpoints, even when skipping UI. OAuth alone grants no proof.
- [x] Implement supported before/after hooks: provisioned reviewer, exact configured origin, recent first enrollment or valid existing proof for method changes. Permit only selected TOTP/passkey paths; block OTP, backup-code, URI re-export, trusted-device and alternate removal bypasses.
- [x] Configure `twoFactor({issuer:'Fave staff',allowPasswordless:true})`; retain setup verification. Require exact six digits, enforce a durable owner attempt budget and single-use code reservation. Grant proof only after successful `verify-totp` and verified factor lookup, using the resulting session when enrollment rotates it.
- [x] Configure passkey RP from validated origin. In supported verification callbacks reject absent signed user verification and cross-user credential; use the actual newly issued session after authentication. Enrollment itself grants no review proof. Require verification before adding methods and disallow removing the final usable method.
- [x] Test real valid/invalid TOTP, replay/concurrent verification, rate limit, pending enrollment, wrong account, passkey wrong RP/origin/no UV/expired or replayed challenge. Test that factor deletion invalidates proof. Test no credential data appears in errors.
- [x] Run auth-origin, session and full security tests, Worker TypeScript. Commit verified security foundation on main.

## Task 3: Safe queues and protected detail

- [x] Write API tests: queue excludes phone, registration/ID numbers, file keys and internal notes; private detail returns428 without fresh proof; current evidence audit occurs before file return; stale decisions retain409.
- [x] Add route-wide reviewer middleware to both admin routers, with proof required except safe pending list. Replace general operations-role checks with reviewer checks. Keep existing reason, checklist, retention, document-version and SQL conflict guards.
- [x] Add static `GET /:id/review` detail endpoints: safe facts, current checklist/document metadata and internal reasons after proof. Identity values remain behind existing purpose/audit POST endpoints. Do not include object keys.
- [x] Make `/pending` minimal safe oldest-first queues and add typed client contracts. Bound queue sizes; provide explicit empty/error states.
- [x] Run contract/security/document regressions and full test suite. Commit API changes.

## Task 4: Security and review UI

- [x] Fetch SDK57/router static docs before API edits. Use existing mobile-first marketplace components and static routes with an opaque query ID.
- [x] Add a web-only Better Auth security client. Keep native ordinary client free of browser-only dependencies; native review entry links to the canonical browser console.
- [x] Build security screen: first-method setup, local enrollment QR/manual secret only during setup, confirmation code, passkey registration, choice of either enrolled method to unlock, visible expiry and Lock now. Never persist URI/code/proof in browser storage. User performs credential enrollment.
- [x] Build separate driver/vehicle queues and one detail at a time. Locked views fetch no private detail. On unlock load detail; on expiry/lock/visibility change/unmount clear private values and revoke object URLs. Recheck server access before each private action.
- [x] Evidence opening requires purpose. Show protected image/PDF in an isolated viewer, no public source URL. Decision form separates internal reason from applicant correction, repeats target/decision in confirmation, disables duplicate submissions, refreshes after success/conflict.
- [x] Run lint and app TypeScript; export web to validate route generation.

## Task 5: Hosting, independent review and browser validation

- [x] Add Worker assets for Expo static output, with Worker-first `/api/*` and `/health`; unknown API paths must return JSON404. No private data in export. Production `apiBaseUrl` uses canonical same-origin for the hosted console; retain localhost proxy behavior.
- [x] Add packaging tests for API precedence, health and asset fallback. Run full tests, lint, app/Worker typecheck, Expo export and Worker dry-run.
- [x] Request independent security and implementation review through requesting-code-review. Assign read-only focused review, main only, no branch/worktree, no real private data. Fix every material finding and rerun affected checks.
- [x] Manually test isolated synthetic queues, both security choices, detail, navigation, correction/conflict/loading, evidence cleanup and relock at desktop and390px widths. Do not open genuine IDs or approve actual applicants for testing. Record what requires the owner’s real device ceremony.

## Task 6: Provisioning and release

- [x] Document a stable-user-ID, audited operator provisioning/recovery procedure. Recovery revokes sessions, proof and old methods only after identity check. No self-promotion endpoint or email matching grants permission.
- [x] Update #7/#8/#17 with tested scope, remaining owner enrollment and deployment steps. Leave issues open until acceptance is established.
- [x] Commit main, push under existing authorization and check CI. Apply reviewed migration and publish verified Worker/static assets under existing production authorization, preserving previous version/config/bindings and rollback. Never activate fares or policies.
- [x] Open the canonical security screen for owner enrollment when deployed and provisioned. Report genuine remaining user action as one simple question. A synthetic assertion is not proof of owner browser enrollment.

## Coverage review

The six tasks cover both accepted verification methods, ten-minute server proof, owner-only review membership, safe queues, separate static detail screens, purpose/audit, current checklist/retention/stale decisions, transient private content, same-origin hosting, existing social/native flows, tests, independent review and owner enrollment. Payment/incident/policy publication is outside this feature. No branch/worktree/PR is authorized.


## Implementation evidence — 16 October 2026

Implemented on main, with both requested verification methods. Independent review
found two lock-versus-passkey orderings; both were corrected using issuance-time
challenge generations and an atomic generation check when proof/audit are written.
An independent reproduction now returns403 and no proof. Also corrected vehicle
media rejection so stale document/parent state cannot mutate a listing or write
an audit before returning409; six positive/conflict regressions pass.

- Full suite:254 tests pass, zero failures/skips. Expo lint, app TypeScript and
  Worker TypeScript pass. Static Expo export and Worker/assets dry-run pass;
  final production artifact checks are recorded below when released.
- Real Better Auth tests use signed synthetic sessions, generated EC passkey
  signatures and actual TOTP verification. They cover UV, RP/origin, ownership,
  fresh enrollment, pending enrollment/session rotation, replay/throttling,
  revocation, final-method guards and both lock races. No real credentials used.
- Browser: isolated loopback synthetic database and files, separate from production.
  Verified safe driver/vehicle queues, locked details, incorrect/correct code,
  focused detail/checklist/blockers, purpose-gated identity/file viewing, document
  confirmation/save/refresh, close/lock cleanup and back navigation. Direct page
  reload now remains on the review route. Phone390px and desktop checked; no
  horizontal overflow. Compact decision forms reveal only when requested.
- Real owner passkey enrollment/verification and authenticator setup remain owner
  actions on the canonical production domain. Synthetic assertions do not replace
  that acceptance. No real applicant evidence opened or eligibility decision made.
- Generated bundle contains public application code only. No fare or legal-policy
  publication is part of this release. Existing development-tool dependency
  advisories were inspected and documented separately from auth runtime changes.


## Production release evidence

- Main implementation commit:a07c4f576053e42a76b2eb8a39c0a1411a298649.
- CI38904373016 completed successfully for that exact commit.
- Applied additive migration0020_staff_review_security.sql successfully; no
  pre-existing data tables removed. Provisioned the owner-confirmed stable user ID
  through the audited operator procedure:one active reviewer, one grant audit.
- Worker version:e53416a8-1d01-4666-b26f-6e97fb56e654, tagmain-a07c4f5.
- Deployment:1a789099-5db5-4f7f-ab6a-4e90f887c5b9, created2026-10-16T13:15:22.15871Z,
  serving100% of traffic. Existing bindings and runtime date/flags/usage preserved;
  only the approved ASSETS binding and static routing configuration added.
- Rollback version:7cc8058b-5450-485d-bdcc-800eb8b6acd1. Retain additive schema;
  do not drop credential tables/triggers during rollback. Reassess access gates
  before restoring older code which did not enforce reviewer verification.
- Production health200/databaseok. Unknown API and auth routes404JSON.
  Unauthenticated review security, driver pending and vehicle pending APIs401JSON
  withprivate/no-store. All three static review pages200HTML withprivate/no-store.
- Production data gates remain0 active approved fares and0 approved client terms/
  privacy documents. No applicant evidence was accessed and no real application
  decision was made in production.
- Opened https://api.fave.fidexa.org/admin/review-security for the owner. At the
  release checkpoint the page showed Google/Apple sign-in and owner enrollment was
  pending. The acceptance record below supersedes that pending setup status.
  Related broader issues remainInprogress and the overall goal is open.

### Owner acceptance — 16 October 2026

- [x] Owner signed into the canonical production staff console with the provisioned identity.
- [x] Owner enrolled a real authenticator app and confirmed successful verification
  and “Reviews unlocked.” Explicit “Lock reviews now” was exercised in the
  production browser; the page returned to “Unlock private reviews” and “Reviews
  are locked.” The owner also confirmed the locked state with a screenshot.
- The ten-minute expiry is covered by automated tests; this owner ceremony checked
  enrollment, unlock and explicit lock rather than waiting for automatic expiry.
  Real owner passkey enrollment remains untested and optional. No real applicant
  evidence was opened or application decision made during this check.

### Review locking and navigation recovery — 17 October 2026

The approved hide/lock requirement had a client request-order race: returning
before server revocation completed could restore the old unlocked status. A failed
lock likewise allowed refresh to restore it. Two actual-hook regressions failed
before the fix. Independent review reproduced a second route mounting past a
per-hook barrier; coordination now belongs to the shared review service.

Both explicit and background lock requests share one in-flight revocation and
security refresh waits for it. Failure retains the requirement and a generic
retryable error. A same-tab sessionStorage marker contains only the value `1`,
never credentials, identity, OTP, enrollment URI or proof; a full reload retries
an unfinished lock. A successful lock clears the marker. Keepalive reduces
cancellation during unload, but does not guarantee network delivery. If browser
storage is unavailable, only the in-memory barrier can survive navigation; a
fresh tab has no marker. Server proof expiry and authorization remain enforced.

Six focused tests execute the actual service and security hook with controlled
HTTP and React lifecycle boundaries: delayed hide/show, failed lock/retry, stale
status response, route remount sharing the pending lock, reload after background
failure and reload after explicit failure. The two reload regressions also failed
before their corresponding repair. Final independent review found no remaining
material issue; limitations above are explicit.

Local full-suite verification executed 350 tests: 349 passed and the existing
1.5-second decoder subprocess timeout failed under host contention. The unchanged
decoder regression passed on the subsequent focused rerun; a diagnostic measured
correct parsing at about 13 ms. No timeout or parser implementation was changed.
Exact-commit CI and browser/release evidence are recorded on issue #17 after the
remaining checks complete.
