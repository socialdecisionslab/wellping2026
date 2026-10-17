# Native test builds

The **Native test builds** workflow compiles standalone local-mode builds on GitHub's Android and macOS build machines. It requires no participant backend or signing secrets. Builds use the pinned dependencies and the existing questionnaire, with synthetic answers only.

The Android APK uses the generated development signing key and package `app.wellping.local`. It is intended for lab testing, not Play Store distribution. The native build produces an Apple-silicon simulator app with a simulator-only identity and keychain entitlement embedded by Xcode. The separate simulator smoke workflow checks rendering after launch/reopen and publishes **Well-Ping-Local-Tested-iOS-Simulator**. Use that tested artifact, rather than an unverified intermediate. Neither is an iPhone installer. A physical iPhone build requires Apple signing and provisioning; do not confuse these two outputs.

Download the Android artifact from a successful **Native test builds** run and the tested iOS artifact from a successful **iPhone simulator smoke test** run linked on PR #6. Artifacts expire after 14 days; the workflow can generate them again. A build's commit identifies exactly which source was tested.

## Verified results (October 17, 2026)

- [Native build 39000758124](https://github.com/socialdecisionslab/wellping2026/actions/runs/39000758124) compiled both platforms at commit `2984368b3f658b40d0b6386901d32a1f9e094b55` and verified the Android package identity and signature.
- [Android emulator test 39001804549](https://github.com/socialdecisionslab/wellping2026/actions/runs/39001804549) installed that APK on Android API 36, rendered the existing questionnaire, advanced one question, force-stopped the app, and verified the same saved question and choices after relaunch. The comparison permits the questionnaire's existing choice randomization. Screenshot and XML evidence are attached to that run.
- Android installer SHA-256: `4512ba82fecae7b6a7477c8f50c34ab891a00982fe8eb1ea9186efb01b356d37`.
- [iPhone simulator test 39002231370](https://github.com/socialdecisionslab/wellping2026/actions/runs/39002231370) passed launch, process survival, termination/relaunch, and OCR checks for the actual questionnaire on both screenshots. The tested iOS build is commit `29ecb3f894786f4be1c7e88086e93956619edd3e`, from [native build 39002105686](https://github.com/socialdecisionslab/wellping2026/actions/runs/39002105686). Screenshots were also visually inspected. The reopen image includes a simulator system notification; the questionnaire remains visible. This test does not exercise answering or saved-question resume on iOS.
- [Android repeat test 39002231363](https://github.com/socialdecisionslab/wellping2026/actions/runs/39002231363) also passed against the newer native build.
- Physical phone installation, full survey completion, retained answers after OS restart, accessibility, reminders and backend uploads are not established by these checks.

## Device requirements

This test APK supports 64-bit ARM Android phones running Android 7.0 or later, plus x86_64 emulators. It does not include a 32-bit ARM build. The iOS runtime requires iOS 16.4 or later. Confirm the pilot phones meet these requirements.

## Android installation

Unzip **Well-Ping-Local-Android** and open `app-release.apk` on the test phone. Android may require allowing installation from the browser or file manager. Alternatively, with USB debugging enabled and Android platform tools installed:

```sh
adb install -r app-release.apk
```

The app should show **Well Ping — synthetic local test**, then the existing questionnaire. It should open without a development server or study login.

## iOS simulator

On a Mac with Xcode and a running iOS simulator, unzip the tested simulator artifact and its enclosed ZIP to obtain `WellPingLocal.app`, then run:

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

## Apple account setup

Rui confirmed that an Apple Developer Program account still needs to be created. First ask [UF IT](https://it.ufl.edu/get-help/) or research software support whether an institutional developer team can host this study app and grant the lab access. If a new institutional enrollment is needed, an authorized representative should complete it under the university's legal entity, rather than the lab's informal name.

Apple's [enrollment guide](https://developer.apple.com/help/account/membership/program-enrollment/) explains organization verification and signing authority. Accredited educational institutions may request a [membership fee waiver](https://developer.apple.com/help/account/membership/fee-waivers). A personal account is another route, but institutional ownership is preferable for continuity of a lab app. No enrollment or purchase has been submitted by this workflow.

Once the team is active, configure the lab-owned app identifier, signing and test device provisioning. The Android APK and simulator work do not depend on this enrollment.
