# December study release runbook

See [repository verification](verification.md) for completed checks and their limits.

## Status and dependencies

This checkout implements client save ordering, resume reconciliation, revision-aware uploads, atomic study records, a proposed Beiwe v1 client, release configuration guards, exact-commit local smoke workflows, and an export comparison tool. It does not provision a Beiwe server, establish Apple/Google/Expo ownership, sign a physical iPhone build, approve the study, or establish device/pilot evidence.

Blocked inputs: lab-approved hosting and Beiwe repository/maintainer; institution-owned Apple/Google/Expo accounts; lab-controlled identifiers/endpoints/support address; PI-approved study protocol and consent process. Use staging with synthetic accounts first. There is no existing cohort to migrate. Keep the questionnaire's response encodings and branching unchanged.

## Configuration and builds

Use Node from `.nvmrc`, Corepack Yarn, and the checked-in lockfile:

```sh
corepack yarn install --immutable
corepack yarn test:ci
corepack yarn smoke:local
corepack yarn smoke:release
```

`smoke:release` only compiles the participant graph with `.invalid` synthetic endpoints; its fixture approval flag does not approve a real backend.

`development` and `preview` in `eas.json` remain synthetic local-only builds. `staging` is a signed physical-device internal build; `production` is a store-distribution build. Configure the following non-secret variables in the corresponding EAS environment (`preview` for staging, `production` for production), or the local build environment:

| Variable | Value supplied by owner |
| --- | --- |
| `WELLPING_RELEASE_ENV` | Profile sets `staging` or `production` |
| `WELLPING_BACKEND_PROTOCOL` | Profile sets `wellping-v1` |
| `WELLPING_BACKEND_CONTRACT_APPROVED` | `1` only after maintainer approval and staging contract verification |
| `WELLPING_STUDY_URL` | Exact HTTPS authenticated study endpoint, without query/fragment |
| `WELLPING_BEIWE_URL` | HTTPS base URL hosting the approved v1 adapter |
| `WELLPING_SUPPORT_EMAIL` | Lab support address, also required in study JSON |
| `WELLPING_EXPO_OWNER`, `WELLPING_EXPO_SLUG` | Lab-owned Expo account and project slug |
| `WELLPING_EAS_PROJECT_ID` | That EAS project's UUID |
| `WELLPING_IOS_BUNDLE_ID`, `WELLPING_ANDROID_PACKAGE` | Lab-owned base app identifiers; staging appends `.staging` |

Use separate EAS project configuration/identifiers as required by the lab's account setup. Staging and production endpoints must be separate deployments. Never set `WELLPING_LOCAL_ONLY=1` in either release environment. Missing fields, legacy app identifiers, unapproved contracts, insecure URLs, and mixed local/release modes fail configuration. These checks cannot prove domain/account ownership; the owner must verify it.

Both release profiles disable OTA updates and historical deep links. The pilot uses typed enrollment codes; adding a new institution-owned universal-link domain requires a separate verified setup. Native signing/provisioning is supplied through the lab's EAS/Apple/Google account, not committed files. Build the reviewed commit using the installed EAS CLI (`eas build --profile staging --platform all`), then production only after the release gate. EAS CLI/account provisioning is an external setup step; no build or submission has been issued here.

Automatic workflow-run triggering becomes active when these workflow definitions are on the default branch; manual dispatch remains available. The local native smoke workflows now consume a successful native build for the exact tested SHA. A manual run requires the corresponding native run ID and matching selected commit. This remains evidence for synthetic local builds, not the staging/production app. Save each signed release build's SHA and artifact hash separately and test that artifact.

## Validation and pilot evidence

Record each check with date, tester, build SHA/artifact hash, environment, phone model/OS, synthetic account, expected result, actual result, and evidence location.

1. Enrollment: correct/invalid/revoked accounts, offline enrollment, malformed codes, authorized consent process, cross-study access denied.
2. Storage: rapid Next/PNA/skip, delayed/failed storage, force-stop between save and navigation, restart/OS reboot, completed survey reopen, pending-data logout refusal, separate participants.
3. Networking: airplane-mode completion, timeout, interrupted upload, server commits but response is lost, repeated retries, edit during upload, no duplicate records, exact export reconciliation.
4. Reminders: actual delivery while backgrounded, reboot, denied/restored permission, timezone travel/DST, study boundaries, expired windows. PI must specify expected wall-clock/travel behavior before judging the result; this change preserves existing timing rules.
5. Interface: complete all questionnaire paths, keyboard dismissal, small screens, large text, VoiceOver/TalkBack. Keep sensitive response data out of screenshots/logs.
6. Server: authorization/revocation, no URL/body credential logs, redirect handling, backups and verified restore, restricted exports, retention and incident access procedures.

Run the authorized multi-day November pilot on both physical platforms. Reconcile each synthetic/pilot session's expected prompts and answers against exports daily. Do not treat a successful HTTP status or matching count as proof of completeness. Fix discrepancies and rerun affected checks; repeat the pilot after material changes. Freeze questionnaire version, build SHA, and server version before December enrollment.

## Go/no-go, support, and incident handling

Release gate: both-platform physical-device evidence, passing automated checks, approved backend contract, secure enrollment, exact export reconciliation, successful restore exercise, PI-approved instrument/consent/schedule/retention, and working installation/support instructions. The lab release owner records approval and the intended participant distribution route. App Store/Google Play submission and review remain external actions.

Assign named owners before pilot: PI/protocol, backend/backup, mobile/release signing, participant support, incident response. Record contact details in the lab's controlled operations system.

Participant instructions: install the lab-provided signed app, enter the assigned code, follow the approved consent process, enable reminders, complete surveys, and check upload status. “Saved on device. Upload pending.” means reopen with connectivity or tap Retry upload. Contact study staff if it persists. Do not uninstall or clear app data to solve upload/recovery problems.

On a data-loss/security/notification incident: pause new enrollment at the server, preserve device responses and receipt/export evidence, notify the incident owner through the lab's established process, and investigate using safe diagnostics. Keep authenticated uploads available for existing participants unless the incident requires disabling them. Do not revoke accounts or wipe local data as a routine rollback. Ship a compatible corrected build after verification; do not downgrade across storage/protocol changes without testing recovery. Resume enrollment only after owner review and reconciliation.
