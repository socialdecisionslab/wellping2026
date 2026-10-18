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

## PR #12 lifecycle review follow-up

Starting head: `43638130a92bc7d720cf7bcb0d08523abff0bc43`; its application CI and native builds/smokes passed, but review identified missing concurrency and lifecycle cases. The GitHub discussion contained validation notes, not additional inline findings; this follow-up implements the specific concerns supplied in the conversation.

- Replaced separate startup/refresh promises with one serialized lane and a pending-refresh flag. Events arriving during a read cause a trailing check; receipt and response listeners are both covered.
- Installed listeners before initialization, delayed timer/ready state until recovery finishes, and separated subscription disposal from React unmount and explicit recovery start.
- Fenced startup, refresh, resume, accepted-save completion and authentication callbacks by lifecycle generation. Superseded work cannot publish state, show stale errors, start a later auth request or tear down replacement subscriptions. New work on the same component waits for old work to settle.
- Added deterministic deferred-promise regressions for initialization events, trailing checks, repeated failures/recovery, unmount, stale rejections, resume/save retention and authentication-read errors. Existing participant-data journal tests remain unchanged.
- No dependencies, persistent state formats, study schedules, response formats or backend contracts changed. Already-started external operations are not cancellable through the Home generation guard; physical-device and backend validation remain separate gates.

Validation and exact published SHA will be recorded in the PR conversation after the final automated checks. The two high dependency advisories remain under the existing limited development exception; two moderate advisories are not automatically accepted. No merge, deployment or unrelated PR modification is authorized. Review the #6 → #8 → #9 → #12 dependency chain before any future integration.

Local follow-up validation passed: lint, TypeScript, 33 suites / 451 tests / 282 snapshots, all five security scripts including the expanded lifecycle cases, isolated and production Android/iOS bundles, both localhost manifests, native workflow guard (15 mutations / 17 aggregate cases), actionlint and whitespace checks. The dependency audit was refreshed and still exits 1 with the same nine entries; no suppression or dependency change was made.

Second implementation review checked queue ordering, events at task completion, invalidation after each awaited lifecycle read, identity-checked task cleanup, listener disposal, repeated recovery, accepted-write draining, stale auth callbacks and fail-closed missing-resume evidence. This is an implementation self-review, not independent approval. Exact-head native CI and an independent review of this follow-up remain required; prior green CI is not evidence for the new source.

The review also found a conditional journal-activity read that could fall through to a second read after invalidation. Initialization now reads activity once, checks its generation, and reuses the result. A deferred inactive-result regression proves that unmount prevents the second read and all subsequent state updates. The initial follow-up `a3f49be` passed application CI, but final native evidence must belong to the subsequent candidate containing this correction.

## P2 resume retry / expiration follow-up

The independent review of `2fddc558f8d9cf11938d11589209421ee2a13568` reproduced a resume retry outside the lifecycle lane and stale `resumeError` after expiration. That commit's green CI did not cover these races.

The recovery button now queues the captured ping in the same lane as initialization/refresh. Expiration checks take priority; superseded requests are skipped. Resume publication rechecks existing expiry rules, journal activity, lifecycle generation and ping identity. Both ping-clearing transitions clear the obsolete resume error and in-memory snapshot without deleting persisted responses. Controlled-promise regressions exercise both operation orders, delayed success/failure and replacement pings. No schedule, backend contract, response format or retention policy changed. Final validation and exact-head CI evidence will be recorded on PR #12; it remains draft pending independent re-review.

The new regressions fail against the previous HomeScreen on stale snapshot/error cleanup and pass with the fix. Local validation passed: 33 suites / 451 tests / 282 snapshots, TypeScript, lint, all five security scripts, both isolated/production platform bundles, both localhost manifests, native workflow guard and actionlint. The implementation review checked queue priority, generation invalidation, functional state-update identity guards and both successful/failed resume paths. Dependency findings and physical-device/backend validation remain unresolved; no additional risk acceptance, merge or deployment is authorized.

## Preservation callback boundary follow-up — October 18

Independent review of `a14e081` requested a deferred React completion-callback regression. The new synthetic test confirms that dropping that callback prevents the old implementation from starting its accepted-write drain and leaves preservation unresolved. Recovery initialization awaits that promise, so it can also stall.

Preservation now starts its promise chain independently of React's state-completion callback. The pending UI update remains, accepted writes are still awaited, and existing generation guards suppress detached success/error publication. Survey input acceptance already checks its event time and registers accepted answers synchronously in the shared write lane; UI commit completion is not the durability boundary. No persistence, ownership, scheduling, or backend semantics changed.

Deterministic cases with withheld callbacks cover unmount and recovery restart, successful and rejected pending writes, waiting rather than bypassing preservation, cleared task references, recovered loading/error state, and harmless late callbacks. The targeted regression fails on `a14e081` and passes with the fix. Final local checks and exact published-head CI results are recorded in the PR conversation, not inferred from the earlier green runs. Keep PR #12 draft pending re-review of this fix and the full stacked chain. Dependency findings, physical-device/backend validation, and real-participant retention decisions remain unresolved.
