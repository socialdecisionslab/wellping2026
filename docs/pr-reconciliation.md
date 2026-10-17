# Reconciliation of the initial pull requests

## Decision

Keep the repository's original app baseline and combine its tested recovery/setup improvements with the security-only work. PR #2 also brought 45 upstream commits, including Expo 49, a different interface, and survey-navigation changes. Those changes are not required to settle the three fixes and would broaden the research compatibility review. Its original branch remains available for a separate, incremental modernization effort.

| Pull request | Disposition |
| --- | --- |
| #1 — preserve cached study after rejected updates | Retain the fix and all recovery tests. |
| #3 — reproducible installation and synthetic runner | Retain pinned tools, schema artifact, isolation and CI. |
| #2 — client security | Supersede with a reviewed backport on the tested baseline; defer its unrelated upstream history. |

The replacement security change is based on #3 and is intended to merge after #1 and #3. No deployment or publication is part of this work.

## Integration choices

- Preserve #1's last-valid-study behavior while replacing detailed errors with safe messages.
- Keep Node 16.20.2, Expo 44 and the original schema source artifact; no new dependencies or lockfile changes are required by the security backport.
- Adapt secure resume storage to the existing UUID API and keep synthetic keys separate. Add explicit synthetic sessions and SHA-256 mocks to existing renderer tests.
- Retain the original question/navigation UI and scheduling rules. Account/Notifications screens introduced only by the newer upstream version are not added. Hidden debug/export controls and the old debug login route are removed.
- Preserve recovery retry/completed-ping handling and correct the success/error distinction for manual uploads. Add isolated component checks for recovery and logout failure.
- Run TypeScript, all 254 Jest tests / 282 snapshots, four security scripts, and both native-platform JavaScript bundle checks. Only five error-message snapshots change; normal survey/answer snapshots remain intact.

## Remaining limits

See [security release gates](security/hardening-review.md) and the [development guide](local-development.md). JavaScript checks do not demonstrate a native release, actual notification delivery, backend compatibility, or complete migration of old device data. Upstream modernization remains separate work.
