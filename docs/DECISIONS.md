# Engineering decisions

- Preserve existing research response formats, schedule semantics and backend contracts. Incremental fixes are preferred to a rewrite or client-only authentication migration.
- Keep the current Expo 57/React Native 0.86 baseline; do not repeat older Expo 44/49 migrations or bulk-upgrade dependencies without compatibility evidence.
- Reuse journal owner verification and serialization for participant-sensitive writes instead of adding a parallel persistence framework.
- Block logout during active surveys or unsynced responses. Offline logout with secure archival and restoration is deferred.
- Preserve unfinished, unsynced and ownership-ambiguous records; ambiguous ownership denies access. Upload success is not deletion authority. These are synthetic-development safeguards, not authorization for indefinite real-data retention.
- Completed-answer review remains out of scope. PR #5 reconciliation is documented in [PR reconciliation](pr-reconciliation.md); do not restore its older UI automatically.
- The [dependency exception](modernization/dependency-risk-followup-2026-10-17.md) for braces and node-forge is development-only and expires October 24, 2026, or earlier if exposure changes or a fix becomes available. No additional unresolved risk is automatically accepted.
- `main` requires independent review, stale-approval dismissal, latest-push approval, resolved conversations and up-to-date passing `test`/`native-validation`. No merge or deployment is authorized. A PR author cannot supply their own independent approval.
