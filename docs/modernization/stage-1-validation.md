# Stage 1: dependable baseline

Baseline: security commit `b3bdca5cfac49516fd350acdda537abfa42eff39` (upstream v1.1.16 / Expo 49). This is not the older Expo 44 baseline used by PR #3. Main is not changed.

## Changes

- Align React 18.2 test renderer, Expo 49 Jest preset and Jest 29 types; use one maintained React Native testing-library API instead of mixing two generations.
- Restore required fixture props, participant-session setup and real hash/UUID behavior at the mocked native Crypto boundary. Application persistence logic remains real in the tests.
- Remove an invalid nested Jest test declaration while preserving its UTC assertion.
- Preserve response/scheduling snapshots. Refresh six native slider render snapshots and five intentionally redacted diagnostic snapshots.
- Forward disabled state to duration choices and test both number and unit controls. Add disabled saved-value coverage for multiple-text questions. Keep editable multiple-text inputs uncontrolled, avoiding an unnecessary behavior change exposed in review.
- Restore accessible labels/roles for survey action buttons and expose Next's disabled state.
- Vendor the exact existing schema commit with provenance rather than bypassing a changed historical archive checksum.
- Install least-privilege, pinned-action CI: locked install, typecheck, full Jest and all three security regression scripts. No credentials, deployment, or external diagnostics enrollment.

## Local validation

Environment: Linux, Node 18.20.8, Yarn 3.1.1, UTC. A fresh isolated directory without node_modules or Yarn install-state completed `yarn install --immutable`, including the existing Firebase patch and native SQLite installation. Shared package-download cache was allowed; the dependency directory was new.

Final acceptance commands:

```
node .yarn/releases/yarn-3.1.1.cjs install --immutable
node node_modules/typescript/bin/tsc --noEmit
node node_modules/jest/bin/jest.js --runInBand --watch=false --coverage=false
node tests/security/secure-resume.cjs
node scripts/security/check-network-boundaries.cjs
node scripts/test-security-diagnostics.cjs
```

The full suite contains 12 suites, 245 tests and 282 snapshots. No tests are skipped and no force-exit option is used. The two added tests cover disabled duration controls and disabled retained text. Security scripts use synthetic data and include interrupted secure writes, migration, namespace isolation, terminal resume, cleanup/logout, network boundaries and diagnostics.

## Limits

The CI configuration is committed, but remote execution must be checked against the published commit. Local success is not a claim of remote CI success. Node 18 and Expo 49 are temporary baseline versions, not the final supported stack. Stage 3 owns the incremental supported-stack migration.

No device/emulator, iOS build, production backend, notification delivery or app-store signing validation is implied. Existing PNA cancellation/disabled handling and broader persistence/upload correctness are recorded for stage 2. The schema comparison establishes matching generated JavaScript and declared provenance, not recovery of the missing historic archive.
