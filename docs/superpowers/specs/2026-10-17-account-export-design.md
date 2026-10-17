# Automatic account downloads and access-request fulfillment

**Status:** concrete design for owner review; not shipped or legal-operating approval.
**Issue:** [#21](https://github.com/matovu-farid/fave/issues/21).
**Baseline:** main `f46c403059d50f99d237bd52d0159bb629efddba`.
All implementation stays on main. Preserve deletion-request restrictions and
existing-trip access; requesting or downloading an export does not request deletion.

## Owner decisions

- Allow automatic downloads; do not make every export wait for owner approval.
- Include the requesting driver's own uploaded ID documents.
- One identity may have client and driver profiles; export both owned purposes.
- Existing deletion requests must not prevent authentication or data access.

## Chosen client flow

Account gains **Download my information**, describing the archive before it runs:
“Contains private information, including your ID uploads; save it somewhere secure.”
A Google/Apple sign-in within the last ten minutes is required before disclosing a full archive or ID
originals; an old session gets a clear sign-in-again action. This is a technical
account-security control, not a statement that social sign-in alone satisfies
every statutory identity-proof requirement.

The service saves an opaque request reference and original receipt time, then
prepares a private ZIP containing a readable index, structured JSON and the
requester's own retained uploads. It does not email the archive or create a public
or bearer download link. Download access is authenticated and session-owned on
every request. Mobile uses the secure web download page, with sign-in there if
needed; no native filesystem permission or new native build is assumed.

Show preparing, available, failed/retry and downloaded states truthfully. A
preparation failure never produces a fulfilled state. Repeated taps and retries
reuse an in-flight request rather than generating competing archives. A later
request for updated information has its own reference/time. A server audit records
receipt, preparation result and download access without storing archive contents,
ID values, tokens or source storage keys in logs.

## Service boundary and persistence

Use a separate authenticated account-export router; do not repurpose the immutable
deletion receipt or Better Auth's identity-deletion controls. Request rows preserve
the first receipt time; append generation/access/decision records rather than
resetting the request clock on retries. Bind a generation to the same authenticated
identity/session and ignore stale results from earlier generations.

- `POST /api/account/exports`: explicit confirmed request, session-owned identity,
  recent sign-in and normal JSON/origin protections; return the opaque receipt.
- `GET /api/account/exports` and `GET /api/account/exports/:id`: own request/status,
  coverage and outstanding access-decision information; never another account's
  request or a credential-bearing archive link.
- `GET /api/account/exports/:id/archive`: a browser attachment streamed through the
  Worker after current ownership/session/recent-sign-in authorization. An opaque
  ID is not sufficient authority. Do not use cross-origin CORS to expose bytes.
- A separate acknowledgement endpoint may record the user's report of receipt;
  serving an attachment alone cannot establish that report or close exceptions.
- Exceptional-record handling uses an owner-only queue/detail/decision API with
  the existing fresh review proof and transactional disclosure/decision audit.

Generate archives on demand without adding a persistent untracked ZIP copy. The
index describes when collection occurred; do not imply that independent paged
reads form a transactional database snapshot. If a source changes, record a new
generation rather than claiming its bytes are the unchanged earlier archive.
Recheck session revocation at protected file boundaries and during long transfers;
stop rather than finishing a now-unauthorized archive. Source records and legally
required audit/retention history remain unaffected by downloading.

## Completeness and exceptions

The automatic archive covers the requester's Fave account, both profiles, own
trip/estimate/consent/notification records and retained uploaded originals. A
manifest identifies each included category, collection time, unavailable originals,
redacted fields and any records needing a separate access decision. Do not present
a capped first page as a complete export. Read every page; larger exports use
streaming/parts with a complete index rather than silently dropping records.

A preparation failure, a missing retained original or unresolved mixed-person
record must not be disguised as full rights fulfillment. The user can download
the automatically safe material immediately; any remaining access case stays open
with a specific explanation and tracked follow-up. The owner reviews only the
exceptional material, not every ordinary download. The user sees the written
decision/action and complaint route. No ordinary staff role gains ID access.

Staff opinions about a requester are not categorically excluded as “internal.”
Separate the requester's personal information from other people's information,
confidential sources, secrets and applicable lawful restrictions. Free-text calls,
review reasons and audit descriptions cannot be dumped wholesale or reliably
redacted by a name blacklist. Their access assessment and lawful redaction need
recorded handling; an automated ZIP does not silently settle those cases.

## Current-source data inventory

Every query starts from the authenticated user, not a submitted user ID. Allowlist
columns and project nested JSON by its recorded schema/version; never dump a row,
provider payload or arbitrary JSON column unchanged merely because its parent is
owned. The same identity may appear as both client and driver on different records.

| Source | Requester's export / required handling |
| --- | --- |
| `user` | Own name, email/verification, profile-image reference and timestamps. Do not fetch a remote provider URL into the archive. |
| `account` | Own provider/link metadata and permitted scope description. Never access/refresh/ID tokens, password material or credentials. |
| `session` | Non-secret own session/device/activity metadata where lawfully accessible; no live/reusable session token or credential. Distinguish active metadata from an unavailable historical record. |
| `client_profiles`, `phone_verifications` | Own collected contact fields and recorded legacy verification facts; do not invent OTP verification in V1. |
| `driver_applications` | Own collected profile, status, rates, applicant messages and submitted/decision/retention facts. Full own ID number requires the same protected download authorization; never expose ciphertext or key. Internal reasons need access assessment. |
| `driver_application_documents` | All retained own submission versions, safe metadata and available original bytes. Do not return another driver's files or raw R2 keys. Explain an original that is no longer held. |
| `vehicles`, `vehicle_media`, `vehicle_unavailability` | Own vehicle facts, rate benchmark/calculation, availability, applicant messages, retained originals and history actually held. Review mixed-person private evidence/notes as needed. |
| `policy_acceptances`, referenced `policy_documents` | Own acceptance version/language/context/time and applicable policy content, including old versions actually accepted. Do not substitute only today's terms. |
| `trip_estimates`, `trip_quotes` | Own client inputs, exact route, dates, car/rate/quote calculation and terms/consent snapshots. For driver-related work, project the driver's own work/rate facts without unrelated client identity/contact/location. |
| `availability_requests`, `availability_request_calls` | Own request/status/hold/decision facts. Calls and free-text notes require mixed-person access assessment; staff contact is not automatically requester data. |
| `driver_trip_offers`, `driver_trip_offer_followups` | Retained legacy own request/response/work facts; redact unrelated counterparty identity/contact and assess free text. Do not resurrect the retired offer-creation flow. |
| `bookings`, `booking_contact_consents` | Own itinerary, accepted fare/terms, state, consent and recorded history. For the driver's export, apply purpose-based projection to client contact/locations; operational access is not automatic permission to disclose another person's record through a rights export. |
| `notifications`, referenced `notification_events` | Own inbox copy/state/time and necessary own domain references. Do not dump shared event payloads or another recipient's updates. |
| `notification_push_tokens` | Own device/platform/registration facts; no reusable push token. |
| `notification_outbox`, `notification_deliveries`, `notification_retry_audit` | Own notification delivery facts and categories; omit transport credentials and protect other staff/recipients. Do not expose raw provider error bodies. |
| `account_deletion_requests` | Own saved receipt/status/time; downloading does not clear its new-work restrictions. |
| `marketplace_audit_events` | Relevant events about the requester or their owned records, not every event they acted on as staff. Project non-sensitive facts; assess free-text reasons and third-party identities rather than automatically including/excluding all notes. |
| `admin_memberships`, `review_memberships` | Own role/grant facts where applicable; no other membership roster, reviewer identity mapping or reusable authority proof. |
| `passkey`, `twoFactor`, `verification`, `review_session_proofs`, `review_auth_attempts`, `review_used_codes`, `review_webauthn_challenges`, `review_session_locks` | No credentials, TOTP secrets, recovery codes, OTP/challenge values, session proofs or credential identifiers. Relevant non-secret personal security activity is assessed separately; exclusion of secrets is not a blanket exclusion of all security-related personal information. |
| `private_evidence_deletion_jobs` | Safe explanation of own file availability/removal where appropriate; never object keys or unrelated jobs. |
| Checklist, fare and retention policy tables | Include only the policy/version facts actually applicable to the requester/owned records; no global administration dump. |
| Provider payment ledger, incident/completion stores, external processors, backups and device drafts | No complete implementation exists for all these sources. Explicitly distinguish not held by this module, data on the user's device, separately controlled processor data and records needing controller follow-up. Never fabricate a payment record or claim a database ZIP covers every processor/backup. |

## Authorization and delivery invariants

- Request ownership, current session and recent sign-in are checked server-side;
  clear UI state on account/focus change, sign-out and stale responses.
- Archive and file routes use private/no-store, attachment disposition and fixed
  server-generated names; content cannot execute as HTML or control ZIP paths.
- Download identifiers are opaque references, not bearer credentials. No object
  key or signed public URL enters the response, ordinary queues or analytics.
- Staff follow-up uses designated owner membership plus fresh review proof and
  an access/decision audit. A lock/revocation wins over an in-flight disclosure.
- Validate ownership through application/vehicle joins before every original read.
  Handle missing/expired versions and encrypted-field failures explicitly.
- Stream bounded chunks and observe backpressure. Set justified size/part limits
  that preserve access to the complete set; do not buffer a large archive in a
  Worker or create untracked persistent copies. Verify selected library/runtime
  support, ZIP64/part behavior, CPU limits and cleanup before release.
- A network-start audit is not proof that the client received a complete archive.
  Record generation and client download acknowledgement separately; neither
  automatically closes an unresolved legal access case.
- Preserve request receipt/decision/delivery audit and applicable retention/holds;
  no source-record erasure, new retention period or policy activation is part of
  this download feature.

## Verified legal inputs and remaining operating verification

The [Data Protection and Privacy Act, section 24](https://ulii.org/en/akn/ug/act/2019/9/eng%402023-12-31)
requires appropriate identity information, access to relevant data/recipient
information, protection of other individuals with usable redaction, and prompt
compliance within thirty days subject to its qualifications. Its personal-data
definition includes relevant opinions. Retaining records does not itself make
their personal information inaccessible to the subject.

The [2021 Regulations, regulation 35 and Form 8](https://pdpo.go.ug/media/2022/03/Data_Protection_and_Privacy_Regulations-2021.pdf)
specify the access form, listed identity documents and a decision within seven
days; a refusal needs reasons. Decision and fulfillment are distinct events.
Receipt/retry/download expiry must not reset either request clock. No fee,
extension or blanket refusal is invented here. The official PDF's cached text was
retrievable through indexed searches on 17 October; direct PDF retrieval failed.
Before a formal access process goes live, verify the current form/identity-proof
procedure, accessible alternatives and operating responsibility with counsel.
Do not introduce routine client ID collection by assuming a social-sign-in gate
resolves that legal procedure.

Existing client/driver notices preserve a support route and do not establish
complete export, processor search, redaction, backup or erasure procedures.
Publish any required revised notice as a new reviewed version; never silently
rewrite an already accepted policy body. Data subject rights remain available
through support while any software component is not yet ready.

## Implementation and acceptance sequence

1. Lock the archive scope and user flow, plus the secure identity/exception
   handling boundary. Track the work under existing issue #21, In progress.
2. Write migration-backed ownership/completeness/audit/race regressions and real
   component tests before implementation. Include two users with both roles,
   another driver's file and distinctive credential/third-party canary values.
3. Add separate request/status, safe data-projection and streaming archive modules.
   Keep binary/crypto/ZIP and domain projection responsibilities independently
   testable. Schema coverage must identify new tables needing an export decision.
4. Add explicit confirmation/recent-sign-in UI, status/retry/download and complete
   archive index; mobile opens secure web download. No new native module implied.
5. Exercise retained multiple document versions, revoked sessions, missing files,
   failed decrypt/storage/database, midstream failure/cancellation, large records,
   pagination/parts, duplicate actions and account switches. Validate archives with
   a standard independent ZIP reader and verify byte equality for own originals.
6. Independently review privacy/scope and implementation. Run full tests, lint,
   both typechecks and exports; manually exercise the actual app/Worker with
   synthetic records, including phone layout and denied cross-account requests.
7. Publish main and require exact-commit CI before any authorized production
   release. Verify live guards without creating a real user export or downloading
   real identity evidence as a production smoke test.

## Completion boundary

Success is a functioning automatic, authenticated download including owned
retained uploads, with truthful coverage/status and operational handling for any
remaining access decision. A manifest of omissions alone is not full #21
fulfillment. Account erasure, lawful category holds/backup propagation, external
processor requests and full launch readiness retain their original issue scope.
