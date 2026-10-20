# Pull request consolidation — October 20, 2026

The user requested resolution of all open PRs after the initial mobile assessment. PR #14 is the single integration candidate targeting `main`. Superseded PRs can be closed once their exact heads are verified as ancestors of the published candidate; closure does not claim they were individually merged into `main`. Source branches and commit history are retained.

## Included work

| Prior PR | Included source head | Disposition in #14 |
| --- | --- | --- |
| #6 | `b5362eb65de6817d1f960f9a4c3ec5008ad07a27` | Runtime modernization, data journal and revised #13 guarded-release integration retained. |
| #8 | `154e2fe678c04dbaa2dbf57f62892601f852d476` | Foundation, dependency refresh and native CI retained through #12 ancestry. |
| #9 | `ba0e1078009d07fe14030b7d7d34a18e92ec09a3` | Participant sync feedback, accessible choices and reminder-cache correction retained. |
| #10 | `55dbe29f8c276554d4777bd24085873fc2222548` | Local researcher workbench retained through #11 ancestry. |
| #11 | `00beac1c4a173e24bb81814dc939cfb2a75c763a` | Workspace backup/restore, recovery boundary, bounded local diagnostics and source provenance integrated. |
| #12 | `a1759cd79b91175a8bb0e524376c571d48457414` | Owner-fenced study refresh, serialized lifecycle and preservation/resume fixes retained. |

The original PR #14 checkpoint `c72b460e3e56e8d578b6860a5c640cb1b0473048` passed [application CI](https://github.com/socialdecisionslab/wellping2026/actions/runs/39357743895) and [both native builds, Android/iOS smoke and native-validation](https://github.com/socialdecisionslab/wellping2026/actions/runs/39357743928). Those results establish the Android readiness correction at that checkpoint. The later combined candidate requires fresh results; final published-head evidence is recorded in the PR conversation to avoid a documentation-only commit invalidating it again.

No unresolved inline review threads were present on any of the seven open PRs at inspection. Earlier implementation findings were checked against the retained save lane, study envelope, upload/receipt fencing, owner-bound refresh and lifecycle regressions. None of these findings was dismissed as a substitute for a fix.

## Integration review and local verification

The #10/#11 integration had three content conflicts: app entry, package scripts and generated-file ignores. The release enrollment guard stays outside the recovery boundary, so an unconfigured production build cannot enter enrollment. Four new app-entry tests cover blocked production, configured production, local development and protected render recovery. Existing non-destructive recovery tests exercise accepted-save drainage and retry before restart advice.

The researcher server binds only to loopback, rejects untrusted Host/Origin requests, bounds requests and returns sanitized failures. Study/history/import/backup validation preserves originals, rejects lossy exports and cross-study/session conflicts, and fences stale UI operations. It remains a synthetic development workbench without live backend access, authenticated roles, persistent browser storage or participant deployment. Plaintext local workspace backups are not mobile-keychain or backend recovery.

Pinned Node 22.23.3 / immutable Yarn verification passed:

- Lint and TypeScript; 42 mobile suites / 530 tests / 282 unchanged snapshots.
- All five security scripts, 24 researcher core/server/DOM/release tests and four Python Android-readiness regressions.
- iOS/Android isolated questionnaire, synthetic staging participant and production participant bundles; both localhost manifests; production module-presence/exclusion checks.
- Native workflow guard, including same-run/source identity rejection and aggregate failure cases; whitespace and conflict-marker checks.

The source-provenance command also needs a clean committed checkout and consistent pinned application/build identities. It records hashes and source identity, not signing or release approval. CI runs it on the published candidate. No generated dependencies or builds are committed. The remaining audit findings stay documented without new suppression or risk acceptance.

## Final merge and release boundaries

The active [main safeguards](https://github.com/socialdecisionslab/wellping2026/rules/25315686) require `test`, `native-validation`, resolved conversations and an eligible independent approval of the latest push. There is no current-user bypass. Auto-merge is disabled at repository level. The user has authorized PR resolution and eligible merges, but that authorization does not supply a GitHub review from another eligible reviewer or waive enforced checks.

Once the exact candidate satisfies those rules, merge #14 through GitHub. Do not weaken the rules, self-approve or advance `main` through a direct ref update. This consolidation does not deploy the app. Controlled backend/export validation, physical-phone notifications/storage/accessibility, remaining dependency decisions, retention/withdrawal/recovery policy, signing and an authorized pilot remain release work described in the [assessment](integrated-candidate-2026-10-20.md) and [runbook](../release/deployment.md).
