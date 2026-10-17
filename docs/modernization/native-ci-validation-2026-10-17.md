# Native CI validation checkpoint — October 17, 2026

## Scope and status

Development baseline only. Changes remain uncommitted in the isolated detached checkout at `96d48a9f1964f4772134c6a0961d8a44da3f2842`. No commit, push, branch change, merge, deployment, or PR status change was performed in this step. PRs #6, #8 and #9 remain open drafts. The prior data-preservation changes remain intact; completed-answer review remains deferred.

## Existing exact-head GitHub evidence

The following results belong to the existing published heads, not this uncommitted patch. Successful runs from earlier commits are not substitutes for missing head checks.

| Draft PR | Reviewed head SHA | Existing CI evidence |
| --- | --- | --- |
| #6 | `e2c9f1ea9ac00e2bea45d26dd8606272c44f1b57` | [test passed](https://github.com/socialdecisionslab/wellping2026/actions/runs/39053627373); [Android and iOS builds passed](https://github.com/socialdecisionslab/wellping2026/actions/runs/39053625139); [iOS smoke passed](https://github.com/socialdecisionslab/wellping2026/actions/runs/39053625226); [Android smoke failed](https://github.com/socialdecisionslab/wellping2026/actions/runs/39053625286). |
| #8 | `154e2fe678c04dbaa2dbf57f62892601f852d476` | [test passed](https://github.com/socialdecisionslab/wellping2026/actions/runs/39054274274); [Android and iOS builds passed](https://github.com/socialdecisionslab/wellping2026/actions/runs/39054274297); [iOS smoke passed](https://github.com/socialdecisionslab/wellping2026/actions/runs/39054274321); [Android smoke failed](https://github.com/socialdecisionslab/wellping2026/actions/runs/39054274271), with emulator acceleration unavailable before app launch. |
| #9 | `96d48a9f1964f4772134c6a0961d8a44da3f2842` | [test passed](https://github.com/socialdecisionslab/wellping2026/actions/runs/39055326947); no native check runs on this head. |

Android acceleration failure is an infrastructure blocker, not an app regression or successful smoke test. Historical iOS smoke verifies launch/reopen, not saved-answer recovery or backend integration.

## Local CI changes

- `native-preview.yml` now covers pushes and PR base branches for `main` and all three stacked branches, including draft PRs and head updates. No path filters: documentation-only changes also produce a check rather than leaving required checks pending. Push/PR concurrency groups are separate.
- Android/iOS builds and smoke jobs explicitly check out the PR head SHA (or dispatch/push SHA). PR workflow definitions still follow GitHub's event revision semantics; native source validation deliberately tests the head rather than the synthetic merge commit. Existing general `test` PR runs continue to test the merge checkout.
- Smoke workflows are reusable dependencies of the build workflow. They download only the current run's platform artifact, eliminating branch polling, stale-run selection and cross-workflow timing races. They verify source SHA and workflow run ID before launch and retain machine-readable identity evidence. These markers detect accidental mismatches, not malicious workflow authors or binary tampering; independent code review remains necessary.
- `native-validation` runs after all four dependencies and succeeds only when every build and smoke result is `success`. Failed, cancelled, skipped or missing results cannot become a green aggregate. Whole-run cancellation may cancel the aggregate; it is not a success.
- Missing Android `/dev/kvm` access produces explicit infrastructure evidence and a failed gate. This patch does not bypass runner permissions or claim to repair host acceleration.
- Workflow permissions remain read-only; no secrets, deployment, participant backend, or privileged PR event is introduced. All native builds remain synthetic local-mode builds.

## Local regression validation

Fresh `yarn test:ci` passes TypeScript, all 32 Jest suites (444 tests, 282 snapshots), and all five security scripts. `yarn lint` also passes. Bundle and localhost manifest results remain evidence from the preceding engineering step; they were not rerun for this workflow-only follow-up.

`node scripts/check-native-workflows.cjs` passes: branch/event/path coverage, exact checkout and artifact binding, 11 negative configuration mutations, SHA/run rejection cases, and 17 aggregate failure cases. The existing `test` job runs this guard. The guard executes the actual identity shell script and aggregate shell command, not only a second implementation of their logic.

`bash -n scripts/native/build-identity.sh`, `git diff --check`, and actionlint 1.7.12 pass. Actionlint was downloaded from the official release with its SHA-256 verified; optional shellcheck/pyflakes integrations were unavailable and disabled. These local checks do not establish GitHub runner success, emitted check names, artifact transfer, emulator execution or native compilation for the new patch.

## Human inspection and approval gates

1. Review this uncommitted diff and authorize commit/push separately, deciding how to distribute the changes through #6 → #8 → #9 without changing their draft status. Remote validation of an uncommitted candidate is impossible; rerunning an old published SHA would not validate these edits.
2. Once authorized and published, record the new full head SHA, run the parent workflow, and verify both platforms' build identities, smoke evidence, and the final `native-validation` check on that exact head. Repeat after every head change. Confirm all four dependencies pass and that the PR check UI reports the expected final context. Test a failed dependency on a disposable candidate before declaring enforcement verified.
3. An administrator must configure and verify `main` protection. It remains unprotected in the observed branch response. Require independent approval and the existing `test` context; add `native-validation` only after the workflow is published, its context is observed and runner access is resolved. Verify stale approvals invalidate and missing/failed checks actually block merging. Local workflow files do not enforce repository protection.
4. Approve the added CI cost: all changed files trigger native jobs, and stack pushes with open PRs can generate both push and PR runs. Decide on a supported accelerated Android runner if `/dev/kvm` remains unavailable; do not waive smoke success silently.
5. Approve the [proposed retention boundaries](data-retention-development.md). Unsubmitted/unsynced answers must survive crashes/logout without crossing participant ownership boundaries; no new automatic purge policy is introduced here.

Physical-device testing, notification delivery on devices, OS-restart recovery, accessibility and backend ownership/upload validation remain explicitly unverified for this candidate. None of these results authorize participant deployment or merging.
