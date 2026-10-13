# Explore page design

## Problem

The `/explore` tab still shows Expo's starter tutorial, so it does not help a signed-in Fave user continue into the product. The home screen and `/trips` already provide the trip and vehicle-selection flows.

## Approaches considered

1. **Replace the tutorial with a concise Fave introduction and a trip-planning call to action.** This makes Explore useful while keeping trip entry and vehicle search in their existing route. Recommended.
2. **Redirect Explore directly to `/trips`.** This removes the starter screen but makes the Explore tab redundant and can unexpectedly move users away from the destination they selected.
3. **Build a separate destination or vehicle catalogue on Explore.** This would duplicate information and availability behavior already owned by `/trips`, and could show stale options.

## Design

Replace the Expo tutorial content on `/explore` with a mobile-first, single-column Fave discovery page. Use the current theme, spacing tokens, and marketplace UI components. The page will have a short Fave heading, one sentence explaining that users can plan journeys around Uganda, a brief three-step explanation (enter trip details, compare approved vehicles, review the itemized quote), and one primary **Plan a trip** button that navigates to the existing `/trips` screen. Keep the page informational; do not add a second search form, destination catalogue, or vehicle availability data.

The content must not imply that a booking is guaranteed or that a vehicle is available before the trip search runs. Keep copy consistent with the current trip flow and accessible button semantics. No backend, policy, payment, or profile behavior changes are in scope.

## Alternatives and error handling

The only interaction is navigation to `/trips`; it uses Expo Router's existing route. If client terms are not published, the existing trip screen continues to explain that client setup is paused. Explore itself requires no API call and remains useful while booking is paused.

## Verification

- Confirm the Expo starter tutorial text and external tutorial links are gone from `/explore`.
- Confirm the Explore screen content presents the Fave purpose and trip steps within a narrow/mobile viewport without clipping or horizontal overflow. Check the content area separately from the shared app tab navigation.
- Activate **Plan a trip** and confirm it opens `/trips`.
- Confirm the existing home, driver, and trip tabs remain reachable.
- Run the repository lint and TypeScript checks; manually check the rendered screen in the browser at `http://localhost:8081/`.

The shared web tab navigation currently makes the overall document 21px wider than a 375px viewport. That layout is outside this Explore-page change; track and fix it separately rather than treating tab-bar width as Explore content overflow.

## Scope boundary

This page is an entry point only. Search criteria, pickup validation, vehicle availability, quotes, and booking readiness remain owned by `/trips` and its existing API.
