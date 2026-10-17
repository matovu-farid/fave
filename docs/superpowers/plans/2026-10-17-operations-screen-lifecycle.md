# Operations screen contact and action lifecycle repair

Tracks #17 and the existing approved staff-confirmed availability design. This
repairs the current workflow; the separately proposed suspension rules are not
implemented. Continue on main without branches or worktrees.

## Reproduced failures

Actual-component tests at base `e42cfde` reproduced contacts surviving navigation,
late contact responses restoring old private state, background/account changes
retaining contact, duplicate confirmation requests and older queue reads replacing
newer state. The original controller lived inside the Operations page and had no
focus/context generation or synchronous action lock.

Independent review reproduced three additional cases: a local call invalidating
an outstanding access-denied response, legacy call logging becoming unreachable
after backgrounding, and a write committing after foreground refresh without
immediate reconciliation.

## Repair

- [x] Extract the existing network/action controller into a focused hook; preserve
  the existing current availability and legacy-offer views and API contracts.
- [x] Scope state to the actual signed-in user/session and focused, visible,
  active screen. Clear queue, contacts, call/confirmation drafts and messages on
  leaving, backgrounding, identity change, access loss or failed queue refresh.
- [x] Reject late responses from old contexts; order queue reads; prevent repeated
  action presses synchronously. Same-context access denial wins even if its queue
  read has been superseded by an action.
- [x] Reconcile settled writes against current server state after returning;
  preserve committed decisions without restoring old contact or success messages.
- [x] Preserve a manual call-recording entry point for legacy offers after staff
  return from the phone app and open the contact again.
- [x] Fourteen actual-component regressions, including positive call/save/quote
  progression and independent review reproductions, pass.
- [x] Independent re-review: previous findings fixed; no additional concrete
  regressions found. Two additional reviewer probes passed.
- [x] Full regressions, lint, app/Worker types and all platform bundle gates.
- [x] Synthetic actual-app/browser call-to-quote and contact-clearing checks,
  with a phone layout. No real contact or booking action as a test.
- [x] Commit/push main, exact-source CI, verify hosted artifact and authorized
  release with configuration preserved; production read-only checks and issue
  update. No database migration or role grant is required.

Physical-device dialer behavior remains separately unobserved. Browser and
controlled AppState tests do not establish a physical-device result.

## Validation — 17 October 2026

The full regression suite passed 620 tests, zero failures or skips. Expo lint,
app and Worker typechecks passed; iOS, Android and web exports passed with the
canonical production API. The local browser test used a separately built local
artifact with the actual app, Better Auth and Worker against an isolated database.
Clearing the Metro cache was necessary when changing the artifact API target;
the resulting local and production targets were checked explicitly.

Browser checks verified audited synthetic contact access, navigating away and
returning with contact hidden, delayed contact response rejected after navigation,
recording a reached call, and confirming the requested dates at the saved amount.
The request moved to Quote sent with its configured date hold and contact hidden.
Phone layout checked at 390×844, then the viewport override reset. Screenshot:
`/tmp/fave-operations-quote-phone.png`. No production contact or booking decision
was used. The synthetic fare-policy window is not production policy activation.

The initial UI source `7bc0b3a` passed
[CI39021222872](https://github.com/matovu-farid/fave/actions/runs/39021222872)
with 620 tests and all checks, then was released. Live health and anonymous access
checks exposed a pre-existing gap in the two booking-operations API routes:
responses lacked explicit cache protection. Seven additional tests reproduced
the gap for signed-out, unauthorized and authorized responses, plus unknown admin
routes. A shared admin API middleware adds private/no-store and no-cache headers;
authorization, response bodies, streaming and the UI artifact remain unchanged.
The follow-up receives its own validation/release gate before closing this repair.

The follow-up passed 627 full-suite tests, zero failures/skips, lint, both
typechecks and Worker packaging. Independent review found no remaining issue;
additional checks exercised handled server errors, raw streams and preflights.
The manually tested web artifact is unchanged by the Worker-only header repair.

Final source `7f96e12c1fe3e7a934192df6320f37225933afa3` passed
[CI39021711184](https://github.com/matovu-farid/fave/actions/runs/39021711184):
627 tests, zero failures/skips, lint, app/Worker typechecks and all platform
bundles. The final repair is released. Live health/database and canonical console
checks passed, anonymous operations requests returned 401 with private/no-store
and no-cache headers, and the served web bundle matches the verified artifact.
No real driver contact or booking decision was used in these checks. Issue17
remains open for its broader workflow and operating requirements.
