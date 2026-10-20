# Release gates

## Development integration

- [ ] Fresh lint, TypeScript, unit, security and bundle checks on the integration candidate.
- [ ] Exact-head `test` and `native-validation` pass, including mandatory Android/iOS smoke; infrastructure failures remain blockers.
- [ ] Dependency audit refreshed; exception still applicable, unexpired and explicitly approved.
- [ ] Independent reviewer approves latest changes and resolves conversations.
- [ ] Protected `main` requires up-to-date PRs, approvals and required checks with no routine bypass.
- [ ] Explicit human merge authorization; draft status alone is not approval.

## Participant deployment — not authorized

- [ ] Physical Android/iOS devices: restart persistence, notification delivery/permissions, WebView and lifecycle transitions.
- [ ] Backend integration: ownership, destination identity, retries and duplicate/acknowledgement semantics.
- [ ] Compatible server plan for legacy query-string authentication.
- [ ] Approved retention periods, deletion authority, withdrawal procedure, verified backups and audit requirements.
- [ ] Policy for minimizing securely uploaded local copies without deleting unverified or unsynced records.
- [ ] Separate security assessment, signing/release credentials and explicit deployment approval.

Do not treat synthetic development checks or a tooling-risk exception as participant-release evidence.
