# Testing

| Command | Evidence |
| --- | --- |
| `corepack yarn lint` | Static lint rules |
| `corepack yarn test:ci` | TypeScript, Jest and offline security regressions |
| `node tests/security/home-recovery.cjs` | Deterministic Home initialization/refresh serialization, notification trailing checks, repeated failure/retry, stale callback fencing, save preservation and authentication-read errors |
| `corepack yarn jest --runInBand src/__tests__/helpers/studyRefreshOwnership.test.ts src/__tests__/RootRecovery.test.tsx` | Study-refresh ownership and recovery regression cases |
| `node scripts/smoke-local.cjs` | Synthetic Android/iOS bundle construction |
| `node scripts/check-production-bundles.cjs` | Production bundle graphs and excluded tooling modules |
| `WELLPING_SMOKE_PORT=19827 node scripts/smoke-server.cjs` | Local development manifest serving |

Use deterministic synthetic fixtures and clocks. Test storage failure and account transitions with real journal logic rather than replacing the ownership boundary with mocks. Never update snapshots simply to hide a behavioral regression.

Home lifecycle regressions execute the actual component methods with deferred promises and synthetic platform adapters. They control completion order without wall-clock sleeps: events during startup and an active read, unmount during refresh or resume, rejection of superseded startup, repeated failures/recovery, and late save/authentication completions. These are JavaScript lifecycle tests, not proof of native notification delivery or cancellation of an already-started platform operation.

Resume-retry coverage includes retry-before-expiration and expiration-before-retry, successful and failed delayed reads, replaced ping identity, clearing stale recovery UI, and skipping a queued retry after its ping expires. The tests call the actual recovery button handler and share the real Home work lane; persistence remains synthetic.

CI must report `test` and `native-validation` on the exact candidate SHA. Missing, skipped or blocked mandatory smoke tests are not passes. Android KVM access is narrowly scoped on a hosted runner; paid or self-hosted infrastructure needs separate approval.

JavaScript graphs do not establish native compatibility. Native smoke does not establish physical-device notification delivery, production backend acknowledgements, backup restoration or real-data retention compliance. See [release checklist](RELEASE_CHECKLIST.md).
