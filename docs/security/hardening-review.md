# Security hardening review

This is a review patch, **not a production-security approval**. It is based on upstream commit b986352 (Well Ping 1.1.16). The fork's main branch is older, so the PR also includes upstream history. Do not merge or deploy without reviewing that baseline difference.

## Changes

- Remove hidden Home/Notifications debug menus, response/credential viewing and exports, app reset controls, and the separate debug survey entry point. Ordinary notification history remains read-only.
- Remove raw application console logging and arbitrary error/debug sharing. Diagnostics share only app/build versions. A production Babel transform strips console calls and their arguments, and ESLint disallows application console calls.
- Validate HTTPS destinations, restrict dashboard top-level navigation to its configured origin, reject credential template substitutions/query keys, disable mixed content and local file access. Preserve legacy Beiwe/authenticated-study request compatibility rather than silently changing the server protocol. See [network-boundaries.md](network-boundaries.md).
- Save new survey resume snapshots in integrity-checked, namespaced, chunked Expo SecureStore storage, with serialized writes and verified migration. Retry failed persistence instead of advancing silently. Recover terminal snapshots idempotently after interruption.
- Disable Android backup in Expo configuration. Refuse logout while responses are pending upload or a survey is incomplete. Only clear data after successful preconditions; missing upload-server configuration no longer counts as a successful upload.
- Completed ping views no longer require deleted resume snapshots. Failed recovery provides an explicit retry rather than an infinite spinner.

## Regression checks

Run from the repository root with dependencies installed:

```
node tests/security/secure-resume.cjs
node scripts/security/check-network-boundaries.cjs
node scripts/test-security-diagnostics.cjs
```

These execute transpiled application helpers/components using isolated in-memory/native mocks and synthetic fixtures. They cover chunk limits and Unicode, interrupted writes, migration failures, session isolation, serialized writes, cleanup/logout refusal, terminal completion restart/retry, HTTPS/origin/template boundaries, diagnostic canaries, removal of debug entry points, and missing-server queue preservation. They do not replace physical-device integration tests.

## Validation and release gates

- All three targeted regression suites pass.
- The full TypeScript check still has ten pre-existing test/HowLongAgoQuestion prop errors. The existing Jest suite fails in its Expo/vector-icons transformer (`@jest/create-cache-key-function`, undefined options/config). Neither is represented as passing.
- Android release assembly is validated separately using the existing local Android project and cached toolchain. Generated native files, APKs, local SDK paths, and pre-existing Yarn/build workarounds are not part of this security source patch.
- No Android emulator or physical device is attached in this environment. Real-device login, offline crash recovery, logout, notifications, and debug-access smoke tests remain required using synthetic accounts. No live participant data was used.
- Beiwe and authenticated study-file URLs still use legacy credential query parameters. A verified backend migration is a release blocker; the user accepted leaving this documented rather than breaking compatibility. Native fetch redirect behavior and dashboard subresource behavior need device/server verification.
- Legacy plaintext resume entries are migrated only on safe, matching-session resume. Untouched or ambiguous legacy entries remain plaintext until migration or completed-data cleanup. Do not claim that every existing installation has already been fully migrated. Disabling backup does not remove existing backups and is not a universal device-transfer guarantee.
- This patch does not encrypt every historical answer/database, change server authorization or Firebase rules, modernize dependencies, rotate credentials, configure production signing, or deploy an app/backend.
- Logout may now be refused for demo/no-server studies with unsent responses. There is deliberately no destructive override. Resolve/export through an approved study workflow before retrying.

Before release, resolve the backend transport and legacy-data migration gates, run physical-device tests and full CI, review signing/backup behavior, and obtain study-owner approval.
