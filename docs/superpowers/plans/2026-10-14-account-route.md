# Dedicated Account Route Implementation Plan

> **For agentic workers:** Inline execution on `main`; keep the route migration small and verify each step before continuing.

**Goal:** Make Account a real, directly navigable screen while preserving the existing native-tab experience.

**Confirmed account rule (14 October 2026):** One Fave sign-in may have both a client profile and a driver profile. Keep their workflows separate; having one profile does not grant the permissions of another role. The Account screen explains that the same sign-in supports both profiles.

**Architecture:** Move the existing home, explore, driver, trips, alerts, and operations routes into an Expo Router `(tabs)` group. Use a root Stack for `(tabs)` and `/account`, keep authentication/theme/notification-response setup at the root, and open Account from Home with a normal router push.

**Tech Stack:** Expo SDK 57, Expo Router, React Native, Node test runner.

---

### Task 1: Specify the route hierarchy

**Files:** `tests/account-screen.test.mjs`, `src/app/_layout.tsx`, `src/app/(tabs)/_layout.tsx`, `src/app/account.tsx`

- [x] Write tests that require a root Stack, a nested tabs layout, a standalone Account route, and Home navigation to `/account`.
- [x] Run the focused test and verify it fails because the route is currently local Home state.

### Task 2: Move the existing tab routes

**Files:** `src/app/index.tsx`, `src/app/explore.tsx`, `src/app/driver/index.tsx`, `src/app/trips/index.tsx`, `src/app/notifications.tsx`, `src/app/admin/index.tsx`, related UI source tests

- [x] Move existing tab screens into `src/app/(tabs)/` without changing their public URLs.
- [x] Fix relative imports affected by the new directory depth and update source-based tests.

### Task 3: Implement the root Stack and Account route

**Files:** `src/app/_layout.tsx`, `src/app/(tabs)/_layout.tsx`, `src/app/account.tsx`, `src/app/index.tsx`, `src/components/account-screen.tsx`

- [x] Keep theme, auth gating, splash, and notification-response subscription in the root layout.
- [x] Put `AppTabs` in the `(tabs)` group layout.
- [x] Make `/account` render the existing profile screen and make Home push that route.

### Task 4: Verify the migration

- [x] Run the focused account and route-dependent tests, then `npm test`, `npx tsc --noEmit`, and `npx expo lint`.
- [x] Manually verify signed-in Home → Account (`/account`) and Back to Home. Direct `/account` while signed out correctly presents sign-in.

**Browser evidence — 2026-10-16:** Signed in with the Google account selected by the owner, opened Account from Home, loaded the client/driver profile response, returned using Back to home, and confirmed the session survived a full browser reload. Account correctly disables profile saving while current approved client terms/privacy are missing. No profile, policy acceptance, or driver application was submitted.

### Sign-out failure recovery — 17 October 2026

- Regression coverage reproduced the real Account handler navigating home after
  Better Auth returned a structured error. A thrown request could also leave the
  button busy indefinitely. Account now handles returned and thrown failures with
  a generic retryable inline error, resets busy in finally, and navigates only
  after successful sign-out. Push-token cleanup failure still does not block the
  authentication request; no authentication configuration or privilege changed.
- Added four behavior tests rendering the actual Account component with controlled
  hooks and service boundaries: returned error plus retry, rejected request,
  push-cleanup failure with successful sign-out, and pending-request busy state.
  The returned-error test failed before the fix with an unexpected Home navigation.
- Isolated browser test used the actual static app and Better Auth Worker with a
  synthetic session and a temporary 503 sign-out endpoint. Failure stayed on
  Account, showed the generic error and re-enabled Sign out. Restoring the local
  endpoint and retrying displayed the signed-out Google/Apple screen. Checked the
  error at 390px and restored viewport. Proof: /tmp/fave-account-signout-retry.jpg.
  No real account, policy acceptance, booking, driver call or charge was changed.
- Focused eight Account tests passed; full suite 322 passed with zero failures or
  skips. App lint and app/Worker typechecks passed. Independent security/correctness
  review found no actionable issue. Export/deletion workflow remains separate:
  direct deletion of the identity currently cascades to trip/consent records, so
  it cannot implement the required retention-aware lifecycle.
