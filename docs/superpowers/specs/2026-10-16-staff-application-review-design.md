# Staff application review with owner passkey access

Status: Proposed final design for owner review. Layout, initial reviewer scope and
passkey choice were confirmed on 16 October 2026. Implementation has not started.

Related: #7 driver verification, #8 vehicle review, #17 operations console.
This implements their application-review workflow; payment, incident and policy
management remain separate work under their owning issues.

## Confirmed owner choices

- Separate driver and vehicle review screens, with one application detail shown
  at a time.
- Only the owner may review driver identity documents initially.
- Use a passkey rather than an authenticator-app code for sensitive review and
  approval.
- Work inline on `main`, without branches or worktrees. Test in the browser.

## Experience

Admin gains links to **Driver applications** and **Vehicle applications**. Each
queue lists the oldest outstanding submissions first with name or car facts,
submission time, status and checklist progress. Routine lists exclude identity
numbers, registration numbers, private files, phone numbers and internal notes.

Selecting an application opens its focused detail view and preserves a clear
route back to the queue. The existing booking call queue and notification health
remain available on Admin. Use the existing mobile-first cards, typography,
spacing, field and button components; preserve keyboard focus and readable
single-column review on small screens.

The owner chooses **Unlock reviews with passkey**. The browser performs user
verification using a device PIN, biometric or security key. The server grants
that session ten minutes of review access. The UI shows when it expires and
clears private fields/images on lock, expiry, sign-out or leaving the application.
The owner can lock it immediately. Unsupported or cancelled passkey prompts show
a clear retry/support path and never fall back to a weaker review method.

Private evidence starts hidden. Opening it requires an entered review purpose;
the API records access before returning the content. Documents are viewed inside
the review screen, without public links, browser persistence or analytics. Close
the viewer to revoke temporary image references and remove private content.

Approve/reject each current document with an internal reason. Rejection requires
a separate, clearly labelled correction message visible to the driver. Show the
current checklist and blockers before the final application/listing decision.
Repeat the target and decision in the confirmation control. Prevent duplicate
submissions, refresh server state afterward and preserve a draft reason only in
memory after a recoverable failure. A changed submission/status returns conflict
and asks the reviewer to refresh, without silently retrying the action.

## Permissions and strong verification

Existing operations membership does not imply review permission. Add a separate,
audited reviewer membership tied to the owner's stable Better Auth user ID.
Provision it through an explicit operator procedure, never a public signup,
email-domain rule, shared credential or self-promotion endpoint. No other member
receives review permission by default. Apply it to both driver and vehicle
review endpoints so vehicle evidence does not become an alternate private path.

Safe review queues require the reviewer membership. Private detail/evidence and
document/application decisions additionally require a recent server-verified
passkey assertion. Proof is bound to the actual authenticated session, user,
credential and origin, expires after ten minutes and is invalidated by sign-out,
session revocation, reviewer revocation, credential removal or an explicit lock.
An email address, UI flag, fresh OAuth login or registered-passkey count alone is
not proof of passkey verification.

First registration requires the provisioned owner and a recent authenticated
session, with browser user verification required. Existing passkeys must be
verified before adding/removing credentials; prevent removing the final usable
key through the ordinary interface. Offer an additional recovery passkey. Lost
key recovery requires a documented operator identity check, audit and revocation
of old review access; do not add email/SMS or password fallback for ID review.
The owner performs actual credential enrollment and device approval.

WebAuthn challenge validation must enforce the expected RP/origin, ownership,
user verification, expiry and single-use semantics. Persist proof only after
successful cryptographic verification. Keep CSRF/origin checks and appropriate
rate limits. Every sensitive response uses private/no-store caching, and logs or
errors must not contain identity contents, credentials or assertion payloads.

## Authentication and hosting

Use the official `@better-auth/passkey` plugin version 1.7.5, matching installed
Better Auth 1.7.5; no incidental authentication upgrade. Keep Google and Apple
sign-in for clients/drivers. Passkey review is a distinct privileged step.

The matching published package was inspected without installing it. Its
registration/authentication verification defaults do not require the signed
user-verification flag, and authentication creates a new session. Integration
must explicitly reject a verified response without that flag through the
supported verification hooks, pin the credential to the current reviewer and
record proof for the resulting session. Merely asking the browser to prefer a
biometric or checking that a credential exists is insufficient. Ordinary users
must not gain new passkey-management endpoints as a side effect of this owner
review feature.

Serve the exported web review routes from the existing Worker at
`https://api.fave.fidexa.org/admin`, keeping a stable production origin for
passkeys. Local development uses the already approved localhost origin and its
separate RP scope; a localhost credential does not become a production-domain
credential. Never trust an arbitrary forwarded origin or select an RP from an
unvalidated client parameter. Do not silently reuse a proof across RP scopes.

Use Expo's existing static web output and static review routes; select a detail
through an opaque query ID rather than embedding private records into a build.
Worker assets must preserve `/api/*` and `/health` handling, including JSON API
404 responses. Builds contain code/public assets only, never private evidence or
pre-rendered authenticated data. Prepare and verify the hosted result before
production publication; do not change fare/policy activation as a side effect.

## API and code boundaries

Keep authorization/proof logic in a focused review-access module and passkey
integration separate from the long driver/vehicle routers. Reuse existing
decision/evidence rules and their atomic state guards rather than adding a
second review implementation. Add minimal typed queue/detail wrappers and
focused components for queue, application detail and security state.

The existing pending endpoints lack a safe focused detail contract. Define that
contract explicitly, keeping internal/private fields behind the stronger check.
Do not return the full existing pending object and merely hide fields in UI.
Driver suspension beyond pending review and vehicle suspension require their own
lookup/action support; do not present controls that their APIs cannot execute.

## Verification and release requirements

- Exercise real migrations, handlers, authorization and SQL with synthetic
  applications: owner versus ordinary operations member/client/driver;
  expired/revoked/wrong-session proof; replayed, mismatched or unverified
  passkey assertions; private response caching and access audit ordering.
- Verify enrollment/credential management cannot bypass the passkey gate, no
  arbitrary-origin RP, no cross-account credential use and no policy activation.
- Retain document approval/rejection, correction-message, current-checklist,
  retention, resubmission and stale-write regression coverage.
- Manually test queues/detail, back navigation, loading/empty/error/conflict,
  hidden/revealed evidence, expiry/relock and duplicate submission at phone and
  desktop sizes. Use isolated synthetic data; do not approve a real driver or
  open a real ID merely to demonstrate the screen.
- Have the owner complete production passkey enrollment/verification. Automated
  tests and a registered key alone do not prove that real browser ceremony.
- Run Expo lint, app/Worker TypeScript, relevant regression tests and web/Worker
  packaging. Record CI, migration and release evidence; retain rollback details.

## Sources checked during design

- [Better Auth passkeys](https://better-auth.com/docs/plugins/passkey): plugin,
  RP/origin and user-verification options. The registry confirms 1.7.5 exists and
  its Better Auth peer range includes the installed version.
- [Better Auth two-factor behavior](https://better-auth.com/docs/plugins/2fa):
  default social sign-in is not a substitute for an explicit strong-review check;
  an authenticator-code design was not selected by the owner.
- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/) and
  [static rendering](https://docs.expo.dev/router/web/static-rendering/) for the
  existing Expo Router/static web build constraints.
