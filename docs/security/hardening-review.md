# Security hardening review

These client changes are a development baseline, **not production-security approval**. They port the security-only changes from PR #2 (`b3bdca5`) onto the original `cd3e808` baseline plus PRs #1 and #3. The unrelated upstream Expo 49 / app 1.1.16 history in #2 is deliberately deferred. See [PR reconciliation](../pr-reconciliation.md).

## Changes

- Remove hidden debug/export controls, the survey-state inspector, and the historical debug-study login entry. Use the separate synthetic runner for development.
- Suppress arbitrary errors in diagnostics and strip console calls in production. Shared diagnostics include app/build versions, not responses or credentials. Manual upload success and failure have distinct, fixed messages. The staff-contact button opens a blank email without participant/session identifiers.
- Require HTTPS for study/backend endpoints and restrict dashboard top-level navigation to its configured origin. Reject dashboard credential placeholders/query keys; disable mixed content and file access. Legacy Beiwe/authenticated-study credential transport remains unchanged pending a backend contract; see [network boundaries](network-boundaries.md).
- Save resume snapshots in integrity-checked, chunked SecureStore records, serialize writes, verify legacy migration before removing plaintext, and preserve previous committed snapshots after interrupted writes. Production and synthetic namespaces remain separate.
- Retry failed persistence and terminal completion. Completed-ping views do not require deleted snapshots; failed recovery offers retry. Logout preserves the visible session when unsent data prevents it. Missing upload-server configuration no longer counts as success.
- Disable Android backup in Expo source configuration. This needs a new native build to take effect; no existing installation or backup is changed here.

## Reproduce validation

Follow [local development](../local-development.md), then run:

```sh
node .yarn/releases/yarn-3.1.1.cjs test:ci
node .yarn/releases/yarn-3.1.1.cjs smoke:local
```

`test:ci` includes TypeScript, the full Jest suite and four offline security checks. Those checks cover Unicode chunk limits, interrupted writes, verified migration, session isolation, serialized writes, cleanup/logout refusal, terminal recovery/retry, completed-ping display, HTTPS/origin/template rules, diagnostic canaries, removal of debug entry points, and failed-upload queue preservation. All data is synthetic and native APIs are mocked.

The backport uses the already pinned UUID dependency because Expo 44 does not provide the newer `Crypto.randomUUID` API. Jest uses real SHA-256 through Node for mocked native crypto and explicit synthetic participant sessions. Five existing snapshots changed only to replace internal error details with fixed messages; answer snapshots and normal survey rendering remain unchanged.

## Release gates

No phone/emulator, native release build, live backend, or real participant data was used for this reconciliation. The prior PR's Android assembly result belongs to its different upstream baseline and does not validate this branch.

- Verify native SecureStore persistence, interruption/restart, login/logout, notification delivery, WebView navigation/subresources, and fetch redirects with synthetic accounts on supported devices.
- Resolve credential query transport with the backend owner; do not silently break the existing authentication contract.
- Untouched or ambiguous legacy resume records remain plaintext until safe migration or completed-data cleanup. Disabling backup does not erase old backups or guarantee all device-transfer behavior.
- This does not encrypt every historical answer/database, change server authorization/Firebase rules, rotate credentials, modernize the SDK, or configure release signing.
- Demo/no-server studies with pending responses cannot log out destructively. They need an approved recovery workflow.
- Complete dependency modernization, signing/backup review and study-owner release review before distribution.
