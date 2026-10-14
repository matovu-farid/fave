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
- [ ] After the owner chooses one of the two Google accounts in the browser, manually verify signed-in Home → Account (`/account`) and Back to Home. Direct `/account` while signed out correctly presents sign-in.
