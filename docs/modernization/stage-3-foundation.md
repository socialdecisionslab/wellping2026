# Stage 3: controlled mobile foundation maintenance

## Baseline and decisions

Starts from tested Stage 2 client commit `9a576ac3ea772d10bf63ca79f6b1bae8a8e2eabf` on PR7. Both exact-head checks passed: [push CI](https://github.com/socialdecisionslab/wellping2026/actions/runs/39052684568) and [PR CI](https://github.com/socialdecisionslab/wellping2026/actions/runs/39052690601). Stage 2 backend/device release gates remain open.

PR6 already upgraded the app to Expo 57 / React Native 0.86.3. This tranche keeps that runtime and refreshes compatible package ranges, rather than simultaneously changing survey reliability and the newly released SDK58 lifecycle/notification behavior. Expo's [SDK58 announcement](https://expo.dev/changelog/sdk-58) was published October 15, 2026; it still describes SDK57 as the default new-project version until the newer store Expo Go arrives. This is a deliberate incremental baseline, not a claim that SDK57 is the newest release or has indefinite support. Reassess SDK58 after the current native tests and research protocol characterization.

Follow the [official incremental upgrade guide](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/) for the next SDK. A new native binary is required for native dependency changes; do not ship them as an assumed-compatible OTA update.

## Changes

- TypeScript 6.0.3, as required by the online Expo compatibility check. Explicit Jest/Node/React ambient types and explicit VM-test module interoperability avoid relying on changed compiler defaults.
- Supported ESLint 10.13.0 and typescript-eslint 8.71.2 replace the broken legacy Universe configuration. CI now runs correctness lint. Public error wrappers deliberately do not preserve private backend errors as `cause`; control-character rejection patterns are intentional. Legacy callback signatures and boundary `any` remain outside this lint gate, with strict TypeScript and contract tests retained.
- Refresh compatible direct/transitive dependency ranges without changing the vendored study schema. In particular js-yaml stays on its 3.x API (3.15.2), preserving `safeLoad` semantics rather than silently migrating research configuration parsing across a major version.
- Pin `@grpc/grpc-js` to 1.14.6 to address GHSA-m9gg-hp2v-232j in Firebase's unused Firestore Node dependency. The app uses Firebase Auth and Realtime Database, not Firestore. Import smoke checks do not constitute backend integration validation.
- Isolated native build and smoke workflows include this review branch. Smoke jobs select and verify the exact commit's artifact, not whichever build happens to be latest. They retain read-only GitHub token permissions and do not persist checkout credentials. Android acceleration must already be available; the workflow no longer broadens host device permissions to obtain it.

Independent review found that smoke-only changes could request an exact-commit artifact without triggering its build. Shared native inputs and smoke paths now trigger the corresponding build; an offline CI configuration regression check enforces trigger coverage and exact-commit artifact selection.

## Validation and remaining gates

Local validation passed: immutable install, ESLint, TypeScript, 30 Jest suites / 427 tests / 282 unchanged snapshots, all five security scripts including 430 journal restart cases, online Expo dependency check, and both isolated mobile bundles/manifests. The Android cold-manifest request initially exceeded its single-request timeout; the smoke harness now waits independently for each platform with a bounded deadline, and rerun passed. Exact native workflow outcomes must still be recorded before treating this tranche as finished. Earlier PR6 binaries do not validate this dependency tree. Native build/simulator evidence does not establish physical-phone behavior, actual notifications, backend contracts, or iOS answer persistence unless specifically exercised.

The recorded [registry audit](dependency-audit-2026-10-17.json) decreased from 112 to 9 findings (2 high, 7 moderate, including deprecation notices). Registry audit is not a proof of exploitability or absence of vulnerabilities. Compatible refresh removed all initially reported critical advisories, but upstream high-severity reports remain for [braces <=3.0.3](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) and [node-forge <=1.4.0](https://github.com/advisories/GHSA-86w9-cpqp-85rv). The registry's latest versions on October 17, 2026 were still those versions. Do not suppress the findings or bypass cryptographic verification; retain them as release-review risks and recheck for upstream fixes. These paths are development glob processing and Expo signing tooling, not evidence of an observed participant-data compromise.

No deployment, store submission, production signing credentials, live participant data, backend access or new persistent authentication is part of this work.
