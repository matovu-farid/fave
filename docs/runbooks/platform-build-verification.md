# Platform bundle verification

Issue #20 requires the Expo app to remain usable across its supported platforms.
CI exports iOS, Android and web production bundles after lint, regression tests
and app typechecking. Worker typechecking stays in its independent job.

Use the installed Expo CLI and the existing npm lockfile. The project uses
Expo SDK 57. Run from the repository root:

```sh
CI=1 EXPO_NO_DOTENV=1 EXPO_PUBLIC_API_URL=https://api.fave.fidexa.org \
  npx expo export --platform all --max-workers 2 \
  --output-dir /tmp/fave-platform-verification --clear
```

The explicit API URL matches the existing EAS build profiles. Disabling local
dotenv prevents a developer's local API override from entering this check.
Two Metro workers bound the build's concurrency on CI. The separate temporary
output leaves the Worker deployment's `dist` directory alone. CI does not upload
or deploy these bundles, use signing credentials or enable any production policy.

Success requires the export process to exit zero and produce both native launch
bundles, metadata and static web routes. A typecheck alone cannot detect every
platform-specific module-resolution or bundler failure. Inspect the actual export
log and artifacts when diagnosing a failure; do not remove a platform from the
check or bypass an unresolved failure.

This validates JavaScript/assets and native-platform module resolution. Signed
EAS builds, installation, native permissions, sign-in, device push and real-device
journeys still need their own evidence. For a release, use the existing EAS
profiles and the separate Worker/web packaging procedure; an export is not a
binary or OTA publication.

Sources: [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/) and
[Expo CLI export](https://docs.expo.dev/more/expo-cli/#exporting).

## Verification record — 17 October 2026

- Main `3c1f47a5bcd50231ae556218ed5ec94a14688432` passed
  [CI run 38992174600](https://github.com/matovu-farid/fave/actions/runs/38992174600).
  The new Bundle iOS, Android, and web step completed successfully, as did
  regression tests, Expo lint and app/Worker TypeScript checks. Each step's
  conclusion was checked in the completed run, not inferred from another job.
  CI reports 344 tests passed, zero failures and zero skips.
- The same all-platform command completed locally with exit zero. Inspected
  `metadata.json`, a non-empty iOS Hermes bundle (4,091,719 bytes), a non-empty
  Android Hermes bundle (4,302,216 bytes), web scripts and 21 static routes,
  including Trips. Native bundles were produced from 1,699 iOS and 1,794 Android
  modules; the web entry used 1,321 modules. Output is isolated at
  `/tmp/fave-platform-verification`; logs are in `/tmp/fave-platform-export-before.log`.
- Fresh local Expo lint and app/Worker typechecks passed. Workflow YAML parsed
  successfully; independent review found no material issues. The existing
  deliberate typecheck-failure dispatch still stops before the bundle step.
- Application source, dependencies, build profiles, authentication, production
  policy settings and deployed Worker were not changed by this CI improvement.
  The earlier review-focus concern was resolved by tracing the existing parent
  security hook, which clears access on blur and refreshes on focus; no speculative
  review-screen patch was made.
