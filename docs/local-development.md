# Modern local development

This branch targets Expo 57.0.30, React Native 0.86.3 and React 19.2.3. It is a development candidate for the first study, not a participant release.

## Install and verify

Use Node **22.23.3** (`.nvmrc`). Its bundled Corepack selects **Yarn 4.18.1** from `package.json`; no global Expo CLI is needed. The first install needs registry access.

```sh
nvm install
nvm use
node scripts/check-environment.cjs
corepack yarn install --immutable
corepack yarn test:ci
corepack yarn smoke:local
```

The lockfile and vendored original study schema are checked in. Dependency lifecycle scripts remain disabled. `test:ci` type-checks the app, runs survey and storage regression tests, and runs the five security scripts. `smoke:local` compiles both mobile JavaScript bundles into a temporary directory, checks the local app identities and disabled updates, verifies production enrollment is absent, and removes the output. It also starts a temporary localhost server and checks both native manifests and the reachable bundle host before shutting it down. It does not run a phone or simulator.

## Preview the existing questionnaire

```sh
corepack yarn start:local
```

The app opens the existing 16-question social-interaction questionnaire, preserving its wording, branching, and answer codes. Use fictitious names and answers. After finishing, you can switch to the shorter two-question fixture. Saved progress and answers are separated by questionnaire and from ordinary app storage.

The local app has no enrollment, notification scheduling, dashboard, or upload flow. Its study envelope has no backend and uses `example.invalid` for unused links. Application fetch calls are rejected. It uses `app.wellping.local` on both platforms and disables over-the-air updates and production deep links.

The server uses localhost, normally port 8081, with watchers disabled for portability. Restart it after editing. The URL is for an installed native development client, not a browser survey. Use a development build matching this branch, rather than relying on Expo Go.

## Build and run a native development client

These commands generate disposable native projects from the Expo configuration. Generated `ios/` and `android/` directories are ignored; regenerate after configuration/dependency changes. All local commands must retain `WELLPING_LOCAL_ONLY=1` (the scripts set it).

```sh
# macOS, full Xcode 26.4+ selected, iOS simulator and CocoaPods installed:
corepack yarn ios:local

# Java 17 and Android Studio/SDK installed, emulator running or USB phone attached:
corepack yarn android:local
```

For a USB Android phone, use `adb reverse tcp:8081 tcp:8081` to reach localhost. A physical iPhone needs Apple signing and a reachable development server; the localhost runner is intended for the simulator. The `development`/`preview` EAS profiles contain local test builds. The guarded `staging`/`production` profiles require the lab inputs in the [release runbook](release/deployment.md); cloud account/project setup and physical iPhone signing remain external prerequisites. The previous production submission profile was removed because it referenced the original app's store account.

Native project generation and JavaScript compilation are separate from a successful native build. This Mac currently has only Xcode Command Line Tools, no full Xcode, Java runtime, or Android SDK. GitHub-hosted native builds now compile the standalone Android APK and iOS simulator app; see [device testing](device-testing.md) for artifacts and verification results. Installation, notifications and storage behavior on physical phones remain to be verified.

## Verification and limitations

The Expo 54 compatibility checkpoint passed 254 tests and 282 snapshots before moving to Expo 57. The target framework passes the original regression suite and security checks; additional tests cover the existing questionnaire and isolated saved progress. Both local and ordinary application JavaScript graphs compile for iOS and Android. Native projects generate successfully for both platforms.

Tests mock native storage and notifications. They do not establish device durability, delivery timing, study-server behavior, or app-store acceptance. Review the current PR results and [December readiness plan](december-readiness.md) before enrollment. Existing React test warnings about asynchronous updates remain visible; they are not suppressed.

If a command reports a Node mismatch, select `.nvmrc`. If dependencies are missing, rerun the immutable install. If a lockfile update is requested unexpectedly, stop and investigate rather than disabling immutability or checksum validation.
