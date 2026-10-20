# Downstream reconciliation checkpoint: October 17, 2026

PR9 upstream `ba0e1078009d07fe14030b7d7d34a18e92ec09a3` was stable before integration. Its exact CI and native runs passed, including mandatory Android emulator smoke and iOS launch/reopen. Run evidence: https://github.com/socialdecisionslab/wellping2026/actions/runs/39062340822 and https://github.com/socialdecisionslab/wellping2026/actions/runs/39062337895 . Those are upstream evidence, not downstream-head proof.

PR10 integrated it additively as `55dbe29f8c276554d4777bd24085873fc2222548`, preserving both parents and every upstream edit. This operations follow-on likewise preserves prior `215c47bb8ba3fb77e905d20ef108e460af5c75dc` and that PR10 commit. No PR was merged, no history rewritten, no main change or deployment. The shared production-bundle checker retains both operations recovery-module assertions and upstream dependency-exclusion assertions.

The user explicitly approved carrying the narrow runner permission adjustment into downstream stages. It targets only the current GitHub-hosted Ubuntu runner user on `/dev/kvm` using an ACL. Android smoke remains mandatory, failure remains a failure, and this does not grant permissions on user devices, self-hosted machines or production systems.

## Fresh dependency re-audit

Before publishing this operations integration, ran pinned `yarn npm audit --recursive --all --json` against the unchanged dependency versions/lockfile. The registry returned nine package entries, including deprecations: two high and seven moderate. Exit1 represents findings, not a clean audit. High findings remain braces3.0.3 and node-forge1.4.0. Raw output: [reconciliation-audit-2026-10-17.jsonl](reconciliation-audit-2026-10-17.jsonl). No dependencies, overrides, advisory suppressions or security checks were changed. Production JS bundle checks exclude these two dependencies from the generated source-map graph; this is not proof of zero tooling/native exposure.

The preserved upstream dependency-exception document is external project history. The KVM approval is not dependency-risk acceptance, permission to merge or production-release approval. Existing institutional/backend/device gates remain open. Do not automatically renew an exception or infer acceptance from CI.

## Verification boundaries

PR10 local aggregate passed32 suites444 tests282 unchanged snapshots,18 console tests,5 security scripts, workflow regression checks and both isolated/production platform bundles. This operations integration passed33 suites448 tests282 unchanged snapshots,24 console/backup/release tests,5 security scripts, workflow regression checks and both isolated/production platform bundles. Remote checks must be read against the exact published commit; earlier green runs cannot be relabeled.

Native workflow trigger coverage includes PR10's target but not PR11's target. Thus PR11's new source has JavaScript/typecheck/security validation, not an exact-head native/device run. Preserve that distinction even when upstream/PR10 native validation is successful. Physical-phone persistence, full participant UI/accessibility, live backend authorization/credential transport, retention and production release gates are unchanged. Completed-answer review remains deferred.
