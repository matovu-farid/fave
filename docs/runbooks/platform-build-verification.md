# Platform bundle verification

Issue #20 requires the Expo app to remain usable across its supported platforms.
CI exports iOS, Android and web production bundles after lint, regression tests
and app typechecking. Worker typechecking stays in its independent job.

Use the installed Expo CLI and the existing npm lockfile. The project uses
Expo SDK57. Run from the repository root:

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

Sources: [Expo SDK57](https://docs.expo.dev/versions/v57.0.0/) and
[Expo CLI export](https://docs.expo.dev/more/expo-cli/#exporting).
