# iPhone development build and capability verification

Use the existing `development-device` profile for a registered physical iPhone.
`development` targets the simulator. Both profiles use the production API; a
native test must not create invented trips, charges or policy acceptances there.
Development-client builds load current JavaScript from Metro. A new native module
or entitlement also requires a compatible signed binary, not just a Metro reload.

## Preserve the app's capabilities

Fave's Apple sign-in currently uses Better Auth's browser OAuth flow. Its existing
Apple App ID must retain Sign In with Apple. `app.json` explicitly declares
`ios.entitlements["com.apple.developer.applesignin"] = ["Default"]`; the existing
`expo-notifications` plugin adds `aps-environment`. Keep these declarations in the
Expo config rather than editing generated native folders or adding an unused
native authentication library.

Inspect what EAS actually reads:

```sh
npx expo config --type introspect
```

The generated `ios.entitlements` must include both the Apple sign-in array and
push environment. EAS normally synchronizes these with Apple's App ID and
regenerates its provisioning profile. A remotely enabled supported capability
absent from the generated entitlements can be disabled during sync.

Do not carry the earlier `EXPO_NO_CAPABILITY_SYNC=1` workaround into a new push
build. That can reuse a profile without the push entitlement and fail at signing.
After changing capabilities, refresh the existing signing setup:

```sh
npx eas-cli@latest credentials:configure-build --platform ios --profile development-device
```

Use the existing Apple account, distribution certificate and intended registered
iPhone. Enter any required sign-in or verification directly in the terminal; do
not copy passwords, verification codes, private keys or device tokens into issues.
A new APNs sending key is separate from a provisioning profile and must also be
configured in the same EAS project before remote push delivery can be verified.

Then build from the checked-out `main` revision with normal capability sync:

```sh
npx eas-cli@latest build --platform ios --profile development-device
```

Record the exact Git SHA, build ID, native fingerprint, final EAS status and
artifact availability. A queued/submitted build is not an installable result.
Inspect a failed build's specific error before retrying; keep polling the same
build ID while it is running.

## Device evidence

After a successful build, install it on the provisioned iPhone, connect it to the
current Metro project, and confirm sign-in, session persistence and sign-out.
In Alerts, test permission refusal, explicit opt-in, opt-out and a return from
Settings. Do not collect the user's OS permission on their behalf.

Use only an authorized notification to the intended tester for a real push check.
Record observed foreground/background/cold-start behavior and the authenticated
inbox destination. A direct Expo test proves the transport only; the app's Queue,
audience checks and domain producers require their own evidence. Never insert
fake production booking/payment/safety events to make that test pass. Ordinary
pushes defer during21:00–08:00 Kampala time; urgent bypass still respects expiry,
recipient ownership and device opt-out. Expo ticket/receipt success does not prove
that the device displayed the notification or that the user saw it.

Sources: [Expo iOS capability sync](https://docs.expo.dev/build-reference/ios-capabilities/),
[SDK57 app entitlements](https://docs.expo.dev/versions/v57.0.0/config/app/#entitlements),
[internal distribution](https://docs.expo.dev/build/internal-distribution/), and
[push setup and credentials](https://docs.expo.dev/push-notifications/push-notifications-setup/).

## Reproduction — 17 October 2026

- Latest previous finished device build067b61c4-ee84-44a6-8881-b2c52caed745
  (12October, commitbec7eb0da15ee995c8f7e5fe126808db2e2928aa) predates the
  notification module/plugin; its native fingerprint differs from current main.
- Build6ec5554e-2f78-4ece-9896-b4e0036342f6 from main9708167 used the prior sync
  workaround and failed with `XCODE_BUILD_ERROR`: the reused profile lacked Push
  Notifications and `aps-environment`. No installable artifact was produced.
- SDK57 introspection reproduced the mismatch: push was present, Apple sign-in
  absent. Adding the explicit Apple sign-in entitlement preserves push and keeps
  bundle identifier, plugins and Info.plist unchanged. Independent config review
  found no further required library/config changes. Lint and app/Worker TypeScript
  checks passed. This local check alone does not prove a refreshed profile or
  APNs sending credentials are usable.
- Existing Metro served a valid SDK57 iOS manifest for the expected project/bundle
  identifier and compiled the current iOS development bundle with HTTP200, the
  latest inbox action and the production API URL. This is JavaScript evidence,
  not a signed-binary or physical-device push result.
- The existing Apple login was restored through EAS/Keychain. With normal sync,
  EAS reported Push Notifications enabled and no capability-identifier changes,
  then refreshed the existing ad-hoc profile for the same registered iPhone using
  the existing distribution certificate. The signing command completed
  successfully. This repairs the remote profile configuration; a successful
  signed artifact and real device observation still require separate evidence.
