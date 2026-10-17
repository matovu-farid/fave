# Automatic account exports implementation plan

> For agentic workers: use subagent-driven-development for independent tasks,
> followed by spec/privacy and code-quality review. Stay on current main; no branch
> or worktree creation. No commits by workers; root integrates and validates.

**Goal:** deliver the owner-approved automatic private ZIP containing owned
account records and retained own ID uploads, with recent sign-in authorization,
truthful request/generation status and tracked exceptional access decisions.

**Architecture:** an account-export router owns fresh-session request state and
transactional audit. A separate projector streams allowlisted owned data and
original uploads into a ZIP writer with backpressure. The Account/web download UI
handles renewed sign-in and receipt/status; protected owner follow-up covers only
exceptional mixed-person/missing-source records. No public archive URL or stored
archive copy is created. Deletion restrictions do not block access.

**Tech stack:** existing Hono/Better Auth/D1/R2, streaming ZIP library verified in
workerd, Expo SDK57/Router and React Native Web; no new native dependency.

## Contracts

- `ExportEntry = { name:string, stream:ReadableStream<Uint8Array> }`.
- `ExportCoverage = { complete:boolean, exceptions:Array<{category:string,code:string,count:number}>, counts:Record<string,number> }`.
- `prepareAccountExport(env,userId,generatedAt)` returns `{entries:AsyncIterable<ExportEntry>,coverage:ExportCoverage}`; coverage finalizes when entries are exhausted and the final manifest is included. No raw credentials/object keys or other users' rows.
- `createExportZip(entries,{beforeEntry?,onComplete?,onFailure?})` returns a readable byte stream; cancellation/errors propagate to producer and status, no whole-file buffer. Validate names, serial writes and ZIP64 support.
- Own request `POST /api/account/exports` JSON `{confirmed:true,requestKey:string}` creates/reuses a receipt. `GET /api/account/exports` returns bounded `{requests,nextCursor,canDownload,freshUntil}` (older pages use an ownership-scoped opaque cursor); own detail returns `{request,canDownload,freshUntil}`.
- Receipt: `{id,status:'requested'|'streaming'|'ready'|'failed',requestedAt,generatedAt:number|null,needsFollowUp:boolean,downloadedAt:number|null,failureCode:string|null}`.
- `GET /api/account/exports/:id/archive` streams attachment for current owner with sign-in within ten minutes. Never expose bearer URLs or R2 keys. Status endpoints remain accessible to older sessions; archive needs fresh authorization.
- `POST /api/account/exports/:id/acknowledge` records user's explicit receipt report; does not close unresolved statutory cases.
- Admin `GET /api/admin/account-exports/pending` safe paginated queue `{requests,nextCursor}`; POST `/:id/detail` requires fresh owner review proof and transactional audit, returns requester and exceptional categories. POST `/:id/decision` JSON `{message:string}` records a written follow-up response, not an unsupported fulfilled/erased assertion.

## Tasks

- [x] Root: migration0025 requests/generations/exceptions/response records, owned API,
  fresh live session/revocation checks, atomic idempotency/generation claim/audit,
  bounded receipt list and server rate/duplicate controls. Integration tests first.
- [x] Data worker: complete owned-source inventory and nested JSON projection,
  paginated JSON streams, owned originals/ID decryption, explicit exceptions and
  archive manifest. No blanket internal-opinion exemption. Canary/privacy tests.
- [x] Archive worker: verified streaming ZIP dependency, safe entry names, serial
  writes, errors/cancel/backpressure and independent ZIP-reader integrity tests.
- [x] UI worker: Account card/web route, authenticated attachment download,
  recent-sign-in recovery with correct return route, truthful receipt/retry,
  explicit download acknowledgement, owner exception queue/response UI and real
  component regressions. Native opens the secure web route. No native modules.
- [x] Integrate with actual Worker index, API helpers and synthetic browser fixture.
  Test both-role ownership, cross-account/file denial, full pagination, secrets,
  old/revoked sessions, midstream failures/cancel, source expiry, duplicate/stale
  actions, archive byte equality, locked owner access and original deletion gates.
- [x] Independent spec/privacy and quality review; repair findings. Full tests,
  lint, app/Worker typechecks, web/native exports and actual browser checks.
- [x] Commit/push main, exact-commit CI, additive migration before code, staged
  upload/binding/runtime verification and authorized production release. Record
  minimal product/validation summary in #21/#20; no real-user export smoke test.

## Preserved scope

The archive is not account erasure, does not reset request deadlines, and cannot
claim all statutory obligations fulfilled while mixed-person/processor/backup
access decisions remain open. Formal identity-proof/Form8 handling and responsible
operating verification remain explicit legal work; social re-sign-in is a technical
security check. No legal policy, retention period, fare or payment approval is
activated by this feature.

## Validation record — 17 October 2026

Independent review found and repaired interrupted-stream cleanup, stalled-read
revocation, partial-exception persistence, false completion audit, expired-lease
recovery, unbounded receipt listing, notification copy/reference omission and
retained own security-audit omission after sign-out. Targeted current projection,
API and actual-component tests pass 35/35. The broader suite passed 467/467 with
no skips before the final added pagination/projection regressions; exact-commit
CI remains required for release.

Synthetic browser checks exercised explicit confirmation, saved receipt,
authenticated ZIP download, independent Python ZIP integrity, explicit receipt
acknowledgement, owner audited detail and written response, lock hiding private
details and the client reading their response. Mobile layout was inspected.
No real user's archive or identity evidence was downloaded for these checks.

Final release source `fed74cea1e1cd5bba967d9ca64a017e4b1a6f5a0` passed
[CI39018021304](https://github.com/matovu-farid/fave/actions/runs/39018021304):
472 tests, zero failures/skips, lint, both typechecks and iOS/Android/web bundles.
Production account-download and owner-follow-up pages respond successfully;
anonymous private API/archive access is rejected with no-store responses, and
health/database checks pass. No real account export was created by verification.

The final browser recheck also caught and repaired sign-out resetting the route:
renewed sign-in now starts from the fixed secure download page. A synthetic
driver archive independently verified the decrypted own ID and byte equality for
all three retained test ID uploads, without unrelated client identity. The owner
written-response/lock/client-readback journey passed. Issue21 remains open for
its broader rights and erasure scope.
