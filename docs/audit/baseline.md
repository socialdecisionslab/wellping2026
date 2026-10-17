# Measured baseline — October 17, 2026

Starting commit: `ba0e1078009d07fe14030b7d7d34a18e92ec09a3`.
Isolated branch: `codex/autonomous-reliability-20261017`.
Runtime used: Node 22.23.3, Corepack Yarn 4.18.1. Dependencies installed using the unchanged lockfile and `corepack yarn install --immutable`.

| Check | Result before source changes |
| --- | --- |
| `node scripts/check-environment.cjs` | Passed |
| `corepack yarn install --immutable` | Passed; peer-dependency warnings remain |
| `corepack yarn lint` | Passed |
| `corepack yarn test:ci` | Passed: TypeScript, 32 suites, 444 tests, 282 snapshots, five security scripts |
| `node scripts/smoke-local.cjs` | Passed both platform graphs |
| `node scripts/check-production-bundles.cjs` | Passed both platform graphs and tooling-module exclusions |
| Workflow regression guard | Passed 15 mutation and 17 aggregate cases |
| `WELLPING_SMOKE_PORT=19827 node scripts/smoke-server.cjs` | Passed both localhost manifests |

React test-renderer asynchronous act warnings remain. Install reports intentionally disabled dependency build scripts and peer mismatches; neither is evidence of native compatibility. No native emulator or physical-device execution was performed locally.

Remote baseline runs 39062340822 (PR) and 39062337895 (push) reported passing application tests, both native builds and Android smoke at inspection. iOS smoke was still running then; no final native aggregate is claimed here. New commits require new exact-head CI evidence.

The unchanged dependency audit has two high-severity tooling findings under a time-limited development-only exception; see [decisions](../DECISIONS.md). Bundle absence is narrower evidence than absence from all native artifacts. Physical-device, backend and real participant validation remain unverified.

Draft PRs #6, #8 and #9 form the reviewed modernization stack. #10 adds researcher tooling and #11 operational safeguards; neither is integrated here. The initial issue inventory returned no non-PR open issues. Existing unrelated edits in the previous checkout were preserved.
