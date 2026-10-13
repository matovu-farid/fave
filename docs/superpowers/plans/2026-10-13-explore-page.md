# Explore Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Expo tutorial at `/explore` with a Fave introduction that sends users into the existing trip-planning flow.

**Architecture:** Keep Explore as a static, mobile-first React Native screen. Reuse the app's themed components, shared card/button components, and Expo Router navigation. Keep all trip inputs, availability, quotes, and booking behavior in `/trips`.

**Tech Stack:** Expo SDK 57, Expo Router, React Native, existing Fave marketplace UI components.

---

## Files

- Modify `src/app/explore.tsx`: replace tutorial content with the Fave introduction, three steps, and trip-planning button.
- Do not change shared components, app routes, APIs, policy documents, or dependencies.

### Task 1: Replace the Explore starter screen

**Files:**
- Modify: `src/app/explore.tsx`

- [x] **Step 1: Replace the full screen**

  Remove the Expo starter tutorial and build a themed, single-column Fave introduction with three trip-planning steps and a primary **Plan a trip** action. Keep trip inputs and search behavior on `/trips`; use the existing `ActionButton`, `Card`, and `SectionTitle` components. Number each step with the selected theme treatment and provide web-specific top spacing so the heading is clear below the tab navigation.

- [x] **Step 2: Run repository lint and type checks**

Run `npx expo lint` and `npx tsc --noEmit` from the repository root. Both commands must exit successfully. Fix only diagnostics introduced by this screen.

- [x] **Step 3: Manually verify the browser flow**

At `http://localhost:8081/explore`, confirm the page shows the Fave heading, three ordered steps, and **Plan a trip** button; confirm no Expo tutorial copy or external tutorial links remain. Activate the button and verify `/trips` opens. At a narrow browser viewport, check that Explore content itself is not clipped or horizontally overflowing and confirm Home, Driver, and Trips navigation remains available. The shared web tab navigation currently makes the overall document 21px wider than a 375px viewport; this is a separate follow-up. Do not submit personal details or a booking.

- [x] **Step 4: Review and commit the implementation on `main`**

Run `git diff --check`, inspect `git diff -- src/app/explore.tsx`, then commit only `src/app/explore.tsx` with message `feat: replace Explore starter screen`.

## Verification map

- Intro, three steps, no duplicate trip flow: rendered Explore screen.
- Navigation destination: browser URL after pressing the primary button is `/trips`.
- Mobile layout and tab access: rendered browser screen at a narrow viewport.
- Static correctness: `npx expo lint`, `npx tsc --noEmit`, and `git diff --check`.
