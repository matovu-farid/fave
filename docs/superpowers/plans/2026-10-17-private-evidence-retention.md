# Private evidence retention repair

**Scope:** existing #6/#8/#14 evidence-retention and verification requirements. Execute inline on `main`; no branch or worktree. Preserve saved retention decisions, not introduce or activate a new legal schedule.

**Root cause:** resubmission overwrote all older file deadlines with `now`. Driver purge also treated the application's mutable deadline as a file deadline. Both purge paths deleted R2 content before the final conditional database operation, allowing stale candidates and audit failures to leave live references without files. Expiring an older vehicle proof could pause a listing even when current proof remained valid.

**Repair:** retain each file's collection/deadline/policy snapshot. In one D1 batch, conditionally retire only a file whose own deadline is still due, insert a durable deletion job and audit retirement. After commit, delete its R2 object and atomically complete the job/audit; leave failed jobs for retry. Application ID-number redaction uses submission-version and deadline guards and never deletes unrelated files. Pause a vehicle only after a successful retirement leaves it ineligible. Private retirement jobs have no public route and contain opaque keys/identifiers, not document contents.

## Tasks and evidence

- [x] Verify issue #6 is In progress and record pickup; inspect current SQL and D1/R2 contracts.
- [x] Reproduce seven failures with production handlers, all migrations and real SQLite before implementation.
- [x] Add migration 0022 and shared retirement/retry module; remove resubmission rebasing and mutable-parent file expiry.
- [x] Verify fifteen focused behavior cases including deadlines, rollback, current-submission approval, replacement records, storage failure, completion-audit retry and concurrent sweeps.
- [x] Run full regression suite, lint and app/Worker typechecks; independent security/correctness review and repairs.
- [x] Manually test actual Driver resubmission and current-only applicant view with disposable synthetic data in the browser; verify retained file metadata and purge state separately.
- [x] Build/export and Worker dry-run, commit/push main, exact-commit CI, migrate/release with runtime/binding checks, and record deployment evidence.

## Publication and operational limits

This implements saved-deadline and deletion-retry correctness, not the full notice's category mapping, lawful holds, decision-access windows, necessity reviews or backup lifecycle. Keep legal/retention registry activation blocked until those requirements are implemented and approved. Retaining a superseded file does not make it current or eligible for approval. Already deleted files cannot be recovered by this repair.

Migration 0022 adds only a cleanup table/index and does not update evidence, policy periods, memberships or active records. A rollback to pre-repair Worker code reintroduces unsafe purge/resubmission behavior and ignores pending cleanup jobs; do not use it as a routine rollback while private records are active. Keep the additive table and prefer a forward repair. Confirm current production evidence/policy counts and deployment configuration before release.

Sources: [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/), [R2 Worker API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/), and the [driver policy research/operational gap](../../legal/driver-policy-research-and-review.md).

## Verification checkpoint — 17 October 2026

- The first seven real-SQLite behavior cases failed before the fix, with premature expiry, lost R2 objects, invalid listing pause and missing durable retry reproduced. Fifteen focused cases now pass; the additional cases cover rollback, shorter replacement policy, stale application redaction, exact/null deadlines, public-photo exclusion, completion-audit failure and live-reference protection.
- Independent correctness/security review found retry starvation: the oldest hundred failed R2 jobs could prevent a later job being attempted. A 101-job regression failed against creation-order selection. Selection now prefers unattempted/least-recently-attempted jobs with a matching index. The reviewer rechecked and found no material issue remaining.
- Full suite: 342 passed, zero failures/skips. App lint, app/Worker TypeScript, static web export and Worker packaging dry-run passed. Two older isolated route-test loaders were updated for the new background-retirement import; their permission/response assertions are unchanged. The fixture now supplies the standard atob/btoa Web Crypto helpers so real field encryption runs in the resubmission tests.
- Isolated actual Worker/Better Auth/static-app browser walkthrough: synthetic correction form, three selected one-pixel PNGs, non-binding test disclosures, citizenship affirmation and synthetic identity; submitted successfully to pending verification. Backend metadata proved original collection/deadline snapshots unchanged and six objects retained through a normal sweep. Simulating expiry of only the three prior files removed exactly those files, leaving all three current pending files and zero cleanup jobs. Reload still showed only the current pending submission at 390px, with no console warnings/errors. Current-only staff approval was verified separately by the real API regression, which rejected approval based on earlier approved files.
- Screenshot: `/tmp/fave-retention-resubmission.png`. No real person, production policy acceptance, ID upload, reviewer decision, booking or payment was created for testing. Synthetic local retention is test data, not approval of a live retention period. Restore viewport and stop the fixture after release checks.

## Production release checkpoint — 17 October 2026

- Main commit `b21e2638cfc8eb2b5ba6513915f2ac721ced7645` passed [CI38988641044](https://github.com/matovu-farid/fave/actions/runs/38988641044). Fresh production static export has no local fixture API references; Worker packaging dry-run passed.
- Migration `0022_private_evidence_deletion_jobs.sql` applied successfully to remote `fave-db`. Subsequent migration listing reports none pending. It creates only the cleanup table/index; no retention or pricing policy was activated.
- Worker version `323bd116-7c76-4744-957e-7b69b8720196` (`main-b21e263`) serves 100% traffic in deployment `68482a1c-9956-4536-8cd5-499087e521a1`, created `2026-10-17T01:01:58.331951Z`. Runtime and all 17 bindings exactly match predecessor `6d556b96-9f17-4df4-866f-84ed8be68e07`. No trigger or non-versioned setting changed.
- Production checks: `/health` reports status/database ok; `/driver` resolves to HTML200; anonymous staff-security, driver-review, vehicle-review and driver-application endpoints return JSON401. An initial Python client was rejected by Cloudflare1010; curl checks succeeded. An unknown `/api/drivers/me` path correctly returns JSON404; actual application route is `/api/drivers/application`.
- Aggregate production counts after release: zero driver applications, driver documents, private vehicle evidence, cleanup jobs, active retention policies and active fare policies. This is a non-destructive smoke check, not a production evidence-purge trial.
- Synthetic browser fixture stopped, viewport restored and test tab closed; owner production tab preserved. Native/EAS binary delivery and new physical-device testing are not claimed.
