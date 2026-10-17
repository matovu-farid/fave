# Staff review revocation boundary repair

Issue #17 is In progress in the Fave project. This repairs the already-approved
staff-review authorization rules; it adds no role, permission, workflow or policy.
Stay on main, preserve unrelated changes, no branch/worktree/PR.

## Evidence and invariant

A synthetic real-handler/SQL probe removed the review proof immediately before
a document-decision batch. The API still returned200, changed the document to
approved and wrote an audit despite zero remaining proofs. Entry middleware alone
cannot enforce revocation across asynchronous reads and writes. Private response
handlers likewise perform decrypt/storage work after their original check.

Bind each protected request to the initial live session, user, origin, exact
verified proof and lock generation. A lock/revocation must invalidate that request;
a later unlock cannot revive the old action. Recheck within decision transactions
and before private response bytes, including after delayed file reads. Preserve
current evidence/checklist/retention/stale-state guards and conditional audits.
A decision committed while authorized remains a committed decision; a later lock
must not be described as rolling it back.

## Work

- [x] Root: failing middleware response/stream tests; shared proof snapshot,
  transaction guard/bindings and response-stream cancellation/revalidation.
- [x] Driver task: reproduce and fix authorization races for document and driver
  approve/reject/suspend transactions; no writes/audits/corrections after revoked
  original proof. Preserve all current eligibility guards and conflict behavior.
- [x] Vehicle task: reproduce and fix media/listing decision races with the same
  contract, including no correction/audit side effects on authorization failure.
- [x] Independent spec/security and code-quality review; repair findings. Full
  regression suite, lint, app/Worker typechecks and synthetic browser lock/retry.
- [ ] Commit/push main, exact-source CI and authorized production release, then
  anonymous smoke verification and minimal issue update. No real identity reads
  or driver/vehicle decisions for production verification.

## Shared contract

`review-access.ts` will export `ReviewEnvironment`, a per-request
`reviewAuthorization` context snapshot, `reviewGuardSelect`,
`reviewGuardBindings(snapshot, now)` and `reviewSnapshotValid(env,snapshot)`.
Decision handlers append `AND EXISTS (${reviewGuardSelect})` inside the same
conditional update as their existing eligibility predicates. Append corresponding
bindings in query order. On no change, a now-invalid snapshot returns428 so the
console can relock; a valid snapshot retains the existing409 conflict.

Root owns shared authorization/response modules and middleware tests. Driver task
owns drivers.ts and focused driver race tests/necessary driver test adapters.
Vehicle task owns vehicles.ts and focused vehicle race tests. No worker commits.

## Verification record

The initial document probe returned200, changed state and created an audit with
zero live proofs. Four private-response/stream tests failed before the shared
repair. Driver and vehicle suites reproduced unauthorized target/correction/audit
writes before their transaction guards; six account-admin tests separately
reproduced borrowing a replacement proof or lock/unlock before their guards.
A final-validator database failure regression reproduced the uncancelled source
before cleanup was repaired.

The request snapshot includes exact proof fields and both current/source session
lock generations, covering rotated sessions and same-millisecond unlocks. SQL
expiry also uses statement time rather than relying only on a clock sampled
before a queued transaction. The millisecond function was verified against the
current D1 runtime; see [SQLite date functions](https://www.sqlite.org/lang_datefunc.html).

Independent security/spec and quality reviews found no remaining scoped issue.
Full local verification passed606 tests with zero failures/skips, Expo lint and
app/Worker typechecks. Browser testing used the actual app/Better Auth/Worker
handlers with isolated synthetic records: a normal document approval saved, then
locking during a held private-file read kept the page locked after release and
cancelled the source. The earlier valid decision/audit remained intact. No real
review, private identity read, policy change or payment was used for verification.

This is a revocation-boundary repair, not completion of the broader operations
console, driver suspension/recovery workflow, payment or incident tooling.
