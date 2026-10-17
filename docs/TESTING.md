# Testing

| Command | Evidence |
| --- | --- |
| `corepack yarn lint` | Static lint rules |
| `corepack yarn test:ci` | TypeScript, Jest and offline security regressions |
| `corepack yarn jest --runInBand src/__tests__/helpers/studyRefreshOwnership.test.ts src/__tests__/RootRecovery.test.tsx` | Study-refresh ownership and recovery regression cases |
| `node scripts/smoke-local.cjs` | Synthetic Android/iOS bundle construction |
| `node scripts/check-production-bundles.cjs` | Production bundle graphs and excluded tooling modules |
| `WELLPING_SMOKE_PORT=19827 node scripts/smoke-server.cjs` | Local development manifest serving |

Use deterministic synthetic fixtures and clocks. Test storage failure and account transitions with real journal logic rather than replacing the ownership boundary with mocks. Never update snapshots simply to hide a behavioral regression.

CI must report `test` and `native-validation` on the exact candidate SHA. Missing, skipped or blocked mandatory smoke tests are not passes. Android KVM access is narrowly scoped on a hosted runner; paid or self-hosted infrastructure needs separate approval.

JavaScript graphs do not establish native compatibility. Native smoke does not establish physical-device notification delivery, production backend acknowledgements, backup restoration or real-data retention compliance. See [release checklist](RELEASE_CHECKLIST.md).
