# Modernization stack review — October 17, 2026

Status: human inspection checkpoint, not merge or release approval. Review covers the PR diffs, critical persistence/enrollment/upload/navigation paths, CI configuration, exact-head GitHub checks, and reconciliation of PR #5. It is not an exhaustive security certification or physical-device validation.

## Follow-up implementation

The user confirmed that completed-answer review is deferred and data preservation/security are required. PR #5's remaining product-scope question is resolved; its older UI should not be restored. The target remains an unreleased development baseline, with #6/#8/#9 left draft and unmerged.

Local follow-up changes fix exhausted-cache scheduling by checking whether today's schedule was retained, rather than whether any cache exists. Regressions cover expired cache, day rollover, future-only cache and same-day restart. Three new tests failed before the fix and all four passed afterward. Two added logout regressions cover unsynced-answer preservation and archive isolation after interrupted teardown. See [the proposed retention rules](data-retention-development.md), which still require maintainer approval. These changes are not yet part of the remote PR heads or native artifacts; the original findings below describe the reviewed commits.

Follow-up validation: immutable install, lint, TypeScript, all 32 Jest suites / 444 tests / 282 unchanged snapshots, all five security scripts (including 430 journal mutation/restart cases), isolated iOS/Android bundles, production iOS/Android bundles, and both localhost manifests passed. The initial localhost attempt failed on the default port; the isolated retry on port 19817 passed without stopping the existing process. `git diff --check` passed. Native builds/smoke workflows have not been run against this uncommitted patch. Native trigger coverage is the next engineering tranche; actual retention-policy approval remains a separate human decision.

## Reviewed state

| PR | Head | Base | Disposition |
| --- | --- | --- | --- |
| [#6](https://github.com/socialdecisionslab/wellping2026/pull/6) | `e2c9f1ea9ac00e2bea45d26dd8606272c44f1b57` | `main` at `3242243` | Keep draft for human review. Includes merged #7 data reliability, not only the earlier runtime upgrade. |
| [#8](https://github.com/socialdecisionslab/wellping2026/pull/8) | `154e2fe678c04dbaa2dbf57f62892601f852d476` | #6 branch | Keep as dependency/tooling/native-workflow tranche. |
| [#9](https://github.com/socialdecisionslab/wellping2026/pull/9) | `96d48a9f1964f4772134c6a0961d8a44da3f2842` | #8 branch | Keep as participant-experience tranche. |
| [#5](https://github.com/socialdecisionslab/wellping2026/pull/5) | `79587f93b7de01ac3a79ae003aed8570e4125e00` | old security branch `b3bdca5` | Closed as superseded after the user deferred completed-answer review. No merge or branch deletion. |

No formal review submissions or inline review threads were present on #6/#8/#9 when checked. All three are draft and reported mergeable; mergeability alone is not approval. The working checkout originally remained at `b76b14e`; this review uses an isolated detached worktree at #9, leaving that checkout unchanged.

## Evidence and findings

- #6 exact-head [CI 39053627373](https://github.com/socialdecisionslab/wellping2026/actions/runs/39053627373) passed 30 suites, 427 tests and 282 snapshots. Its current checks also show native Android/iOS builds and iOS launch passing, with Android emulator execution failing. The former 257-test PR description referred to an earlier commit.
- #8 exact-head [CI](https://github.com/socialdecisionslab/wellping2026/actions/runs/39054274274), [native builds](https://github.com/socialdecisionslab/wellping2026/actions/runs/39054274297) and [iOS launch/reopen](https://github.com/socialdecisionslab/wellping2026/actions/runs/39054274321) passed. [Android smoke](https://github.com/socialdecisionslab/wellping2026/actions/runs/39054274271) stopped at acceleration access, before launching the emulator. Treat this as an infrastructure blocker, not an app failure or a waived test.
- #9 exact-head [CI](https://github.com/socialdecisionslab/wellping2026/actions/runs/39055326947) passed lint, TypeScript, 32 suites/438 tests/282 snapshots, five security scripts, and isolated plus production JavaScript bundle checks. Native build/smoke checks do not exist on this head.
- **Integration blocker:** the native workflows allow only `codex/modernize-mobile-runtime` and `modernization/mobile-foundation-pr7`. They omit the #9 branch and `main`. The configuration regression checks build/smoke consistency, but does not require those missing branches. Extend the intended branch/PR coverage together, then verify exact-head builds and smoke tests before treating the integrated candidate as natively tested.
- **Inherited release blocker:** `notifications.ts:131–135` starts tomorrow whenever the stored schedule is nonempty. An exhausted schedule can therefore skip today's future reminders. A synthetic reproduction against #9 at October 17, 10 a.m. ET with a noon reminder and yesterday's cached entry scheduled October 18 first. Fix with exhausted-cache and same-day restart tests; this defect was not introduced by #8/#9.
- **Human design review:** the custom journal, owner fencing, interrupted enrollment/logout, retained archives and revision acknowledgements are substantial correctness changes in #6. Synthetic restart evidence is valuable, but backend acknowledgements/deduplication, query-carried authentication, archive retention/recovery and native SecureStore behavior remain unresolved deployment gates.
- #9's sync wording correctly distinguishes historical acknowledgement from verification of the current backend. Its accessibility tests establish component semantics, not VoiceOver/TalkBack operation or full-screen usability. Review the actual survey and Home screens on devices.

## PR #5 reconciliation

| Original contribution | Current disposition |
| --- | --- |
| Expo 49/Node 18/Jest alignment | Superseded by the tested Expo 57/Node 22 stack; do not restore its lockfile. |
| Vendored schema and provenance | Both archives were extracted without running package code. Their complete `src/` and `lib/` directory trees compare byte-for-byte equal. Metadata/provenance and tarball hashes differ; keep the current artifact and its own provenance. |
| Test-library APIs, crypto fixtures and safe synthetic tests | Reimplemented on the current runtime; current exact-head CI supplies stronger aggregate evidence. Do not transplant obsolete fixture APIs. |
| Accessible Next/PNA controls | Current survey uses labelled native Buttons and guards accepted events/navigation. |
| Disabled duration/text controls when reviewing completed responses | Not retained as the same product flow. Current Home shows completion instead of mounting an editable survey for a completed ping. Current question props do not expose the older `isDisabled` review mode. |
| Older staged plan | Preserve as history on #5; the active stack starts from the reconciled original baseline. |

The user confirmed that reviewing completed answers inside the app is deferred, resolving the closure condition for #5. If required in the future, create a bounded read-only review feature with disabled duration/text/choice tests on the current renderer. Do not merge the old upstream UI merely to recover this feature. This is a product-scope decision, not evidence that the current navigation guards lose accepted responses.

## Main branch protection — administrator action required

The repository rulesets API returned an empty list and `main` was unprotected. The connector reports no administration permission; the signed-in browser settings page says “You don't have access to repository options.” No rule was created. A local document cannot enforce GitHub protection.

Configure an active branch ruleset targeting exactly `refs/heads/main`:

1. Require a pull request and at least one approving review from another eligible reviewer. Confirm such a reviewer is available before enabling; the PR author cannot approve their own work.
2. Dismiss stale approvals after new commits, require approval of the latest reviewable push by someone other than its pusher, and require review conversations resolved.
3. Require the observed status context **`test`**, with source **GitHub Actions** (app ID `15368`), and require the branch up to date before merging. `CI` is the workflow display name, not the observed job/check name. Keep this context stable.
4. Block force pushes and deletion of `main`; use no routine bypass actors. Do not require linear history without first deciding how to integrate the existing stacked ancestry.
5. Verify enforcement from a PR targeting `main`: missing approval must block merging, pending/failed `test` must block merging, and a changed head must invalidate stale approval.

Native `android`, `ios-simulator`, `launch` and `launch-and-resume` are currently path/branch-filtered, and Android smoke is blocked. Do not make those unconditional required checks until their trigger and runner design guarantees a result on each relevant PR. They remain explicit candidate-validation gates rather than being silently treated as successful.

## Human inspection checkpoint and integration order

1. Completed-answer review is deferred and #5 is closed as superseded. Inspect #6's data lifecycle/retention design and select an independent reviewer with repository access.
2. Have an administrator enable and verify the rules above. This is currently blocked by account permissions, not an automatic approval rejection.
3. Inspect the uncommitted follow-up diff, including the scheduling correction, recovery regressions and proposed retention rules. Native trigger extensions and exact-source artifact checks are now implemented locally; [the native CI follow-up](native-ci-validation-2026-10-17.md) distinguishes local checks from remote results. Publication and execution of these workflow changes remain outstanding.
4. Resolve the native coverage blocker and rerun the exact proposed candidate. Keep notification/backend/device gates visible even if accepting the code as an unreleased development baseline.
5. Integrate #6 → #8 → #9 only after human approval and required CI. Retarget #8 to `main` after #6 lands, and #9 after #8 lands. Recheck the incremental diff and CI at each step; squash/rebase merging a base can change the descendant comparison. Do not mark descendants merged just because a base landed.
6. Preserve #5's branch/history after its superseded closure. Do not deploy as part of this integration.
