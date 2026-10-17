# Modernization stages

Work is based on security hardening commit `b3bdca5cfac49516fd350acdda537abfa42eff39`, which incorporates upstream v1.1.16 rather than the older fork main. Review changes against that baseline; merging and deploying are separate decisions.

1. Dependable baseline tests/type checks and least-privilege CI.
2. Security and offline data reliability, with synthetic integration tests.
3. Incremental supported Expo/React Native/dependency upgrades.
4. Participant onboarding, accessibility, save/upload status and recovery.
5. Researcher study/version/schedule/completion/export workflows.
6. Reproducible releases, privacy-safe diagnostics, backup/restore and operations.

Each completed implementation stage is published separately and verified remotely before moving on. Code-level checks do not substitute for backend or physical-device validation.

## Validation boundaries

- Use synthetic study data only. Do not connect tests to production studies.
- No main-branch writes, merges, deployments, external telemetry enrollment, or paid services.
- Android/iOS hardware validation requires actual devices. A Linux build is not iOS validation.
- Existing backend credential transport cannot be changed on an assumed API contract.
- Researcher authorization and access control require enforcement by the actual backend, not a UI-only role selector.

## Stage 1 baseline

The pre-modernization baseline used React 18 with a React 17 test renderer and Expo 49 with the Expo 44 test preset. Typecheck also found test fixtures missing required screen props and duration-choice controls that did not forward disabled state. These are repaired rather than excluded from checks.

CI uses a locked dependency installation, TypeScript, the complete Jest suite, and security regression scripts. Actions are pinned to immutable commits, checkout does not persist credentials, token permission is read-only, runs have timeouts/concurrency cancellation, and there is no deployment or secret-consuming step. The temporary Node 18 baseline matches the old mobile SDK and is not the final supported runtime target.

## Stage 2 correctness gates identified during baseline repair

- Prefer-not-to-answer currently writes before its confirmation dialog and does not consistently respect completed/disabled state. Test the Cancel path, disabled forms, and persistence failures before changing this flow.
- Await durable answer writes before navigation/completion. Serialize upload acknowledgments with edits so an older upload cannot remove newer pending observations.
- Retry Firebase uploads using stable logical record identities and atomic updates, preserving existing remote records. Do not claim exactly-once delivery for a backend without a verified idempotency contract.
- Preserve rejected study configuration and reconcile PR #1's behavior against the newer security baseline.
- Treat legacy plaintext migration as copy/verify/quarantine work; ambiguous ownership must never cause silent adoption or deletion.
