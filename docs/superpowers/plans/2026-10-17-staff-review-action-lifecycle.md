# Staff review action lifecycle repair

Issue: #17. Scope: the approved staff-review design's action locking, stale
response handling and recoverable decision drafts. Work stays on main.

## Problem and repair

An old identity/evidence/decision failure could update a review after leaving
and returning. An old completion could also clear a newer request's busy state.
The render-time busy check allowed same-render duplicate requests.

Each action now takes a synchronous token. Leaving, locking or clearing the
application invalidates it. Only the current action can update private content,
handle errors or release busy state. Read generations remain separate so an
active conflict can refresh the checklist and still release its own action.

Independent review found that an ignored duplicate decision fulfilled its
promise, causing the real decision form to erase its draft. Ignored decisions
now reject; the existing form preserves its draft and permits retry.

## Validation

- Seven original regression failures reproduced stale errors, busy-state races
  and duplicate private requests before the repair.
- A further failing regression executes the actual decision form and parent
  callback: two confirmation clicks issue one request, preserve reason and
  correction through a 503, then clear the form after a successful retry.
- Ten action tests plus six existing visibility/lock tests pass. Active 409
  recovery and object URL revocation remain covered. Independent re-review
  reports no remaining actionable findings.
- Full suite: 375 passed, zero failures/skips. Expo lint, app TypeScript and
  Worker TypeScript pass. Web export to a disposable local fixture succeeds.
- Manually tested the exported app with the real Worker/Better Auth handlers
  and isolated SQLite/synthetic identity/image: reveal/hide identity, open/close
  evidence, delayed active 503 and successful retry, Home/Operations return with
  purpose and identity cleared, explicit lock removing application details.
  Phone viewport 390 x 844; no browser warnings/errors. No real account,
  credential, driver decision, booking, call or payment changed.
- Timing races are demonstrated by controlled actual-component tests. The
  browser test verifies ordinary recovery/cleanup, not every response ordering.

No schema migration, pricing/retention policy activation, credential change or
new native build is required. Production release uses the normal exact-main CI
and Worker version/binding verification gates.
