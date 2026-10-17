# Autonomous progress

Baseline: `ba0e1078009d07fe14030b7d7d34a18e92ec09a3`.
Branch: `codex/autonomous-reliability-20261017` in an isolated checkout. Previous checkout edits are untouched.

| Unit | Outcome | Commit / verification |
| --- | --- | --- |
| BASE | Inspected lifecycle, storage, CI, history and open PRs; installed pinned environment | Baseline SHA above; 444 tests, 282 snapshots, lint, TypeScript, five security scripts, both bundle graphs and localhost manifests passed |
| DOCS | Added architecture, roadmap, onboarding, testing, decisions and release gates | `fd55523485b6a5f3786dbf14cc47bc5eb6f88e8b`; corrected obsolete Yarn commands and security-script count |
| OWNER-REFRESH | Bound background study staging to initiating owner under existing journal lock | `3db65c1185eb18483df3dfdbbeb503dceb326e48`; 17 focused tests, lint, TypeScript, full 33 suites / 451 tests / 282 snapshots and five security scripts passed; regression first reproduced stale writes |
| HOME-ERROR | Coalesced foreground, timer and notification checks; failures remove subscriptions and show existing recovery/retry without clearing the ping | `bf4734e6373167348806a3cd40d3702f1340966b`; regression fails against prior HomeScreen (3 overlapping calls), passes after fix; lint, TypeScript, 451 tests, 282 snapshots, five security scripts and both synthetic/production mobile bundles passed |
| AUDIT-GUARD | Refreshed full audit, traced moderate tooling exposure, extended shipped-module exclusions to sprintf-js and uuid, recorded published IDs | This commit; both production bundle graphs passed the four-module guard; native workflow regression guard (15 mutations / 17 aggregate cases), actionlint and diff whitespace checks passed; audit remains exit 1 |

No new dependency, persisted format or backend contract is introduced. Native-device and backend validation remain unverified. Baseline exact-head native run 39062340822 now passed both builds, Android/iOS smoke and `native-validation` at `ba0e107`. New source commits need their own CI runs.

Known warnings: test-renderer act warnings and dependency peer warnings. Two tooling advisories remain under the approved development-only exception, not remediated by application tests. Real-data retention and participant deployment require separate approvals.

Scheduling review: current reminder times add elapsed seconds to local midnight. Changing this to wall-clock arithmetic on DST transitions could alter a research protocol; do not change it without study-owner intent and compatibility fixtures. Same-day restart, expired cache and rollover already have regression coverage. Native delivery during timezone changes remains unverified.

Published as [draft PR #12](https://github.com/socialdecisionslab/wellping2026/pull/12), based on #9. The authorized GitHub connector created tree-identical commits because terminal HTTPS credentials are unavailable. Local unpublished commit IDs were replaced with these published IDs after fetching and verifying identical trees; no published history was rewritten. Original checkout edits were not included.

Audit refreshed at `bf4734e` using `corepack yarn npm audit --all --recursive --json`: exit 1, nine entries including five deprecations, two high advisories and two moderate advisories. The high findings remain covered only by the existing limited exception. Moderate sprintf-js and uuid findings are not covered by that exception; see the dependency follow-up. No findings were suppressed and package/lock files remain unchanged.

PR `pull_request` CI and native workflows started on exact head `bf4734e`; push application CI also started. Native push triggers intentionally list the original integration branches, not this new working branch; the PR targets a covered base and has no changed-file exclusion. Subsequent documentation commits require fresh exact-head CI too. Do not infer their results from earlier runs.

Next: inspect PR #12 exact-head CI, request independent review, and validate on physical devices/backends when available. Compatible dependency remediation, real-data governance and DST protocol intent remain unresolved. Keep #6/#8/#9/#12 draft and unmerged. No release or merge approval was granted.
