# Private evidence retirement and deletion

This runbook covers the saved-deadline repair, not approval of new retention periods or the full legal-hold/backup lifecycle. The [implementation evidence](../superpowers/plans/2026-10-17-private-evidence-retention.md) and [driver policy readiness record](../legal/driver-policy-research-and-review.md) define the remaining gates.

## Normal flow

Hourly maintenance selects expired driver and private vehicle evidence. Each row's saved `retention_expires_at` controls its file, independently of the application's current deadline. Missing file deadlines fail closed. Resubmission creates fresh rows and leaves earlier snapshots unchanged; earlier evidence never satisfies the current-submission approval checks.

A D1 batch conditionally creates a `private_evidence_deletion_jobs` row, removes the still-expired live evidence reference and records retirement. A stale candidate whose deadline changed before that batch is not retired. Required current vehicle evidence loss pauses the listing; deleting older proof while valid current proof exists does not pause it.

Only after retirement commits does cleanup delete the opaque R2 object. Storage failure leaves a durable job with `R2_DELETE_FAILED`. The next sweep retries. An R2 success followed by a database/audit failure also leaves the job; idempotent deletion permits retry. Completion removes the job and writes one final audit in a D1 batch. Concurrent sweeps may repeat an R2 delete, but cannot duplicate the committed completion audit. Unattempted jobs run before previously attempted jobs, then least-recently-attempted order prevents permanently failing objects starving later ones.

An application's submitted ID number has a separate version/deadline-guarded redaction. It does not shorten or delete its files. A concurrently replaced submission wins over an old redaction candidate.

## Operations

Use the authorized Cloudflare/D1 operations path. Summarize counts and generic codes; do not put object keys, government identifiers, document content or raw storage errors in routine logs or issue comments.

```sql
SELECT target_type, COUNT(*) AS pending,
       MIN(created_at) AS oldest_queued_at,
       MAX(attempts) AS maximum_attempts
FROM private_evidence_deletion_jobs GROUP BY target_type;

SELECT target_type, last_error_code, COUNT(*) AS count
FROM private_evidence_deletion_jobs GROUP BY target_type, last_error_code;
```

Rising age/count requires investigation of R2 binding/authorization and storage availability. The hourly sweep retries automatically after recovery; do not manually mark a job complete or delete its audit to hide a failure. A job still referenced by either driver evidence or vehicle media is excluded from deletion. Investigate such inconsistencies through restricted access; normal uploads always create new opaque keys. Do not reattach retired keys or revive a retired proof by editing the database.

Retirement is not proof that physical deletion completed. Only the `*_retention_expired` completion event records successful object deletion. `*_retention_deletion_queued` records the earlier retirement. A cleanup job surviving a crash preserves the obligation to finish removal.

Migration 0022 is additive and changes no policy, membership or evidence row. Keep it through code rollback. Older Worker code ignores jobs and reintroduces premature/stale deletion behavior, so prefer a forward repair when private evidence is active. D1/R2 changes are not rolled back with Worker code. This patch cannot recover content already deleted by an earlier version.

Do not activate the finished privacy notice solely because these checks pass: lawful category mapping, approved periods, holds, post-decision access, necessity reviews, rights handling and backup expiry remain separate requirements.
