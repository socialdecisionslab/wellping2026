# Native test builds

The **Native test builds** workflow compiles standalone local-mode builds on GitHub's Android and macOS build machines. It requires no participant backend or signing secrets. Builds use the pinned dependencies and the existing questionnaire, with synthetic answers only.

The Android APK uses the generated development signing key and package `app.wellping.local`. It is intended for lab testing, not Play Store distribution. The iOS artifact is an unsigned Apple-silicon simulator app, not an iPhone installer. A physical iPhone build requires Apple signing and provisioning; do not confuse these two outputs.

Download artifacts from the successful workflow run linked on PR #6. Artifacts expire after 14 days; the workflow can generate them again. A build's commit identifies exactly which source was tested.

## Android installation

Unzip **Well-Ping-Local-Android** and open `app-release.apk` on the test phone. Android may require allowing installation from the browser or file manager. Alternatively, with USB debugging enabled and Android platform tools installed:

```sh
adb install -r app-release.apk
```

The app should show **Well Ping — synthetic local test**, then the existing questionnaire. It should open without a development server or study login.

## iOS simulator

On a Mac with Xcode and a running iOS simulator, unzip the simulator artifact to obtain `WellPingLocal.app`, then run:

```sh
xcrun simctl install booted WellPingLocal.app
xcrun simctl launch booted app.wellping.local
```

For a physical iPhone, the next dependency is an Apple developer team and registered test device, or a locally signed development build through Xcode. Never paste account passwords, private keys or signing certificates into chat or the repository.

## First device check

Record the build commit, phone model, OS version, and result for each check:

1. Open the app without a development server. Confirm the local-test title and existing questionnaire.
2. Enter fictitious answers. Advance several questions, close the app completely, and reopen. Confirm the saved question and answers resume.
3. Finish the survey. Confirm the saved-on-device message, then reopen to confirm completion persists.
4. Start another survey and repeat in airplane mode.
5. Check small screens, keyboard dismissal, large text and a screen reader. Record any clipped text or inaccessible controls.

These builds intentionally have no notifications or uploads. Test reminder timing and end-to-end exports in the later staging-backend phase. Build success alone is not a device-test result.
