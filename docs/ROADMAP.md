# Reliability roadmap

Each row records rationale, modules, risk, prerequisite, acceptance and verification. No item authorizes merging or deployment.

| Priority / ID | Work and rationale | Modules / risk | Prerequisite | Acceptance and verification | Status |
| --- | --- | --- | --- | --- | --- |
| P0 OWNER-REFRESH | Prevent delayed downloads crossing participant sessions | RootScreen, tempStudyFile / medium | Existing journal lock | Stale participant, session, study and closed owners rejected; current owner stages normally; focused and full tests | Complete; 451 tests and security checks pass |
| P0 RETENTION | Prevent deletion without policy | Journal, logout / high | Human real-data governance | Preserve interim safeguards; approve retention, withdrawal, backup and audit rules before deployment | Human gate |
| P0 BACKEND | Resolve legacy query credential exposure without breaking servers | Study download, Beiwe / high | Compatible server contract | Verified server authentication and retry semantics; integration tests | Backend coordination required |
| P1 HOME-ERROR | Handle rejected foreground/timer checks visibly | HomeScreen / medium | Inspect event lifecycle | Controlled recovery, no unhandled rejection; callback regression tests | Next investigation |
| P1 SCHEDULING | Verify restart and rollover reliability without altering protocols | notifications / medium | Existing cache regressions | Review DST/timezone and interrupted scheduling coverage; only fix demonstrated defects | Investigate |
| P1 NATIVE | Establish native behavior rather than infer from bundles | CI, platform runtime / high | Exact-head CI and devices | Mandatory native smoke plus physical notification/storage tests | CI pending; devices unavailable |
| P2 DEPS | Remediate tooling vulnerabilities when compatible fixes exist | Lockfile, tooling / medium | Upstream fix or approved exception | Fresh audit, tests, bundles and native builds; no suppressed findings | Time-limited exception |
| P2 TOOLS | Avoid duplicating useful unmerged work | Draft PRs #10/#11 / medium | Separate code review | Review console/operational safeguards independently before adoption | Deferred |
| P3 RECOVERY-UX | Explain recoverable failures without discarding responses | HomeScreen / medium | HOME-ERROR | Visible retry with preserved data; synthetic interaction tests | Planned with HOME-ERROR |
| P4 DOCS | Make baseline reproducible and resumable | docs, AGENTS / low | Measured baseline | Accurate commands, architecture, safety gates and progress | Complete; maintain with each unit |
| P4 REVIEW | Preserve human integration safeguards | GitHub / high | Eligible independent reviewer | Exact-candidate approval and explicit merge authorization | Human gate |
