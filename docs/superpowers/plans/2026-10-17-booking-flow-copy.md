# Booking flow copy repair

Tracks #10, #12 and #17 under the already approved staff-confirmed availability
design. Work stays on main. This is a correction to the existing interface, not
a new booking, payment or suspension rule.

## Defect and repair

Although new requests use estimate → staff call → same-price confirmed quote,
Operations unconditionally showed empty driver-offer sections describing a
15-minute response window. Approved drivers also saw a “No new trip offers”
empty state. These described the retired process as if it still applied to new
requests.

- Operations shows the earlier-offer section only when pending, processing or
  recent earlier records exist. It distinguishes those records and their original
  response windows from new staff availability checks.
- Driver explains that Fave calls to check the requested dates. Earlier offers,
  when present, retain their original acceptance/decline controls and deadlines.
- The client waiting card for an earlier offer is labelled as an earlier request.
  The current staff-check card and accepted-quote continuation remain unchanged.
- No API, authentication, rate, timing, payment or data lifecycle changes.

## Verification

The existing 28 focused Operations, Driver-status and trip-availability checks
passed, including legacy call recording, driver response controls, accepted-quote
continuation and current requests having no driver timeout. Lint, app/Worker
types and the local web export passed. Independent review found no concrete
issues. The scoped copy/layout detector reported no findings.

Manually reviewed the actual app and Worker with isolated synthetic data:
Operations with a pending staff check and no earlier-offer sections; Driver with
the new availability instruction and no empty offer list; client waiting at the
Availability check step with its saved estimate, withdrawal and no-payment copy.
Desktop and 390×844 phone layouts were inspected; viewport reset and fixture
stopped afterward. Screenshots: `/tmp/fave-staff-availability-copy-phone.png` and
`/tmp/fave-driver-availability-copy-phone.png`.

Source `c79531aa8a722897a555a9887c9a1337ad878d30` passed
[CI39022349089](https://github.com/matovu-farid/fave/actions/runs/39022349089):
627 tests with zero failures/skips, lint, app/Worker types and iOS/Android/web
bundles. The web correction is released. Live health/database, canonical console,
anonymous API denials and cache protection passed; the served bundle matches the
verified production artifact. No physical-device update or observation is claimed.
Existing broader payment, legal, incident, suspension and launch requirements
remain open.
