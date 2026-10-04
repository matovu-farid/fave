This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

## GitHub Project workflow for agents

For implementation work in this repository, track the work in the [Fave GitHub Project](https://github.com/users/matovu-farid/projects/11) before changing code:

1. Reuse an existing issue if one already covers the task. Otherwise, create a concise issue with the goal and acceptance criteria, add it to the Fave project, and place it in **Backlog**.
2. Pick up the issue from the project before implementation by moving it to **In progress**. Keep the issue updated as work proceeds. Read-only investigation does not need an issue.
3. Open a pull request for completed work and include `Closes #<issue-number>` in the PR description so GitHub closes the issue when the PR is merged. Keep the PR linked to its issue.
4. Do not mark work **Done** manually before it is merged. The project workflows move linked PRs to **In review**, move issues back to **In progress** when changes are requested, and move closed or merged work to **Done**.

### Reviews for PRs authored as the repository owner

GitHub does not allow a pull request author to approve their own PR. Agents operating through the repository owner's account must not try to self-approve or work around that rule. Request an approval from another eligible reviewer when branch rules require one. If no separate reviewer is available, run the applicable checks and report that a human approval is still needed. Repository administrators may be able to merge without an approval by changing branch protection or using an allowed bypass, but this does not count as self-review; do not change those protections as part of routine agent work.
