# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## iOS 27 startup

Fave enables `ios.enableSceneSupport` through `expo-build-properties` because
apps built with Xcode 27 must adopt the UIKit scene lifecycle to launch on
iOS 27. See [Expo's SDK 57 scene support guide](https://github.com/expo/fyi/blob/main/ios-scene-lifecycle.md#staying-on-sdk-57-with-xcode-27).

After changing native configuration, rebuild the development app for a physical
iPhone with `npx eas-cli@latest build --profile development-device --platform ios`
and install the new build. Start Metro with `npx expo start --dev-client`.
Scanning a Metro QR code reloads JavaScript; it does not replace an older native
app that lacks scene support.

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

### Other setup steps

- To set up ESLint for linting, run `npx expo lint`, or follow our guide on ["Using ESLint and Prettier"](https://docs.expo.dev/guides/using-eslint/)
- If you'd like to set up unit testing, follow our guide on ["Unit Testing with Jest"](https://docs.expo.dev/develop/unit-testing/)
- Learn more about the TypeScript setup in this template in our guide on ["Using TypeScript"](https://docs.expo.dev/guides/typescript/)

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.

## Continuous integration

The `CI` workflow runs these checks for pull requests and pushes to `main`:

- **Expo checks** installs the root dependencies, then runs `npm run lint`,
  `npm test`, and `npm run typecheck`.
- **Worker checks** installs `fave-worker` dependencies, then runs its
  `npm run typecheck` script.

Both jobs use the committed npm lockfiles and read-only repository access. They
never deploy the app or Worker. Require the `Expo checks` and `Worker checks`
status checks before merging if branch protection is enabled.

After this workflow revision is on GitHub's default branch, verify that GitHub
Actions reports a real typecheck failure by opening the repository's **Actions**
tab, selecting **CI**, choosing **Run workflow**, and setting `fail_check` to
`expo` or `worker`. The selected typecheck receives a temporary
invalid TypeScript file, then removes it when the check exits; the other job
runs normally. Choose `none` for a normal run. These files exist only in the
GitHub runner checkout and are never committed.
