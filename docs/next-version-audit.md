# Next-version reliability audit

Follow-up: the [reproducible local workflow](./local-development.md) resolves the installation blocker recorded below with a pinned schema artifact and project-local CLI. The baseline results here remain the historical evidence from the first audit.

## Executive summary

Incremental modernization is practical. Keep the TypeScript survey engine, study formats, and backend adapters; first establish a reproducible build and strengthen recovery around them. A rewrite would risk changing established response coding, branching, and timing before those contracts are adequately tested.

This change prevents a rejected study update from deleting the last valid local study configuration. It preserves access to the participant's locally stored responses after restarting from the existing error screen. It does not silently continue a survey after an update error or change study content. Six regression tests cover invalid input, offline data access, corrected-update retry, backend configuration rejection, and partial-write cleanup.

In a separate diagnostic dependency installation, TypeScript and all 249 tests / 282 snapshots pass. Four new tests fail against the original implementation. The exact locked installation remains blocked by a schema archive checksum mismatch; this is not a clean-build claim. A running native preview was unavailable. No participant records or research backend services were accessed.

## Scope and provenance

- Inspected on 2026-10-16, starting from clean `main` at `cd3e808ad8405ca65bfe47876cceb705e735d9a6`; branch: `codex/research-reliability-audit`.
- The requested GitHub URL resolves to `socialdecisionslab/wellping2026` according to repository metadata. Searches of both names returned no open PRs. No applicable `AGENTS.md` was found in the checkout or ancestor directories.
- Examined README, manifests/lockfile, App, screens, helpers, question components, configuration, local fixture, developer docs, and CI. Findings below describe code, not deployed behavior. Backend implementation, database rules, historical production data, signing credentials, and actual device delivery were not inspected.
- Verified versions: Expo **44.0.0** (manifest `^44.0.0`), React Native **0.64.3**, React **17.0.1**, TypeScript **4.3.5**, Jest **26.6.3**, jest-expo **44.0.1**, Yarn **3.1.1**. `@wellping/study-schemas` is locked to Git commit `61063224e77f97cc97808c40cb5ad314c3a5104f` in a separate repository. There is no Node version pin. CI installs and tests on `ubuntu-latest` without selecting Node.

## Architecture and participant journey

| Stage | Implemented behavior and evidence |
| --- | --- |
| Launch | `App.tsx` loads schema globals, then `RootScreen`. `RootScreen.componentDidMount` checks cached study data, consumes a staged update, reads the local user, and starts a background study download. Download failures retain the cached study; staged validation failures show `StudyFileErrorScreen`. |
| Join study | `LoginScreen.handleUrl` prefills recognized login links; `loginFnAsync` splits username/password/optional URL and uses `LoginSchema`. Missing fields produce an error. It asks the existing age question, downloads the study, authenticates, and opens the external consent URL. This code does not establish that consent was read or recorded by a service. |
| Configuration | `helpers/studyFile.downloadStudyFileAsync` handles the exact local fixture URL without fetching, otherwise checks configured URL prefixes and fetches JSON/YAML with username and password hash in query parameters. `parseAndStoreStudyFileAsync` uses the external Zod schema and optional Firebase initialization. Three AsyncStorage keys hold study info, streams, and extra data. Schema strictness follows `__DEV__` in `helpers/global.ts`; tests use strict mode. |
| Prompt and availability | `HomeScreen.componentDidMount` requests permission and calls `notifications.setNotificationsAsync`. That function cancels old scheduled notifications and generates a limited rolling horizon using a username/date/time seed. `getCurrentNotificationTimeAsync` compares the local clock with inclusive availability boundaries. Home checks every 30 seconds and on resume/notification response. These are local notifications, not a remote push service. |
| Answer and branch | `SurveyScreen` selects question components for choices/yes-no, sliders, text, and relative time. `getNewNextQuestionsDataStack` handles branches, wrappers, placeholders, and follow-ups. `alwaysEnableNextButton`, PNA, and fallback paths control omission behavior. `insertAnswerAsync` validates response encoding through the external schema. |
| Persist and resume | `secureStore/answer.ts` writes an answer then its AsyncStorage index; pings use a similar split. Answers are keyed by ping/question, so editing one locally overwrites that answer. `SurveyScreen.onNextSelect` stores a resume snapshot; Home restores the latest ping only within the matching active notification window. A snapshot also contains answers in **unencrypted AsyncStorage**, although individual answers and credentials use SecureStore. |
| Complete and upload | A final question sets the ping's end time and calls Home's completion handler. `HomeScreen._uploadUnuploadedDataAndRemoveFromThemIfSuccessfulAsync` snapshots pending data, uploads, and removes queued ping IDs on success. Retry opportunities are survey start/completion and manual upload; no connectivity-triggered/background outbox worker was found. Full local data remains available for manual upload. |
| External ownership | Firebase auth/realtime database and Beiwe `/register_user` / `/ssnl_upload` live outside this repository. The schema library defines study/answer contracts. `DashboardComponent` is an existing participant-facing WebView with URL placeholders, including optional tokens; it is not a researcher dashboard implemented here. Backend deduplication and access controls cannot be inferred from the adapters. |

Identifiers include study ID in local storage keys, installation ID in SecureStore keys, and username/installation/login date in the upload session ID. Ping IDs derive from stream/count, with notification/start/end timestamps and starting timezone offset (`pings.insertPingAsync`). Local keys are not participant-scoped; normal logout clears records. There is no atomic logout/enrollment transaction. The upload envelope does not explicitly carry the study version (`dataUploadType.ts`), and accepted staged files can change the study ID. Those compatibility questions require external contract review.

## Five highest-impact findings

Rank reflects participant/data impact, not implementation order. Confidence is in the code path; field incidence is unknown.

| Rank | Evidence, impact, and confidence | Feasible fix and acceptance criterion |
| --- | --- | --- |
| 1 | **Answer/navigation persistence is not serialized.** `SurveyScreen.render` launches `addAnswerToAnswersListAsync` without awaiting it; navigation can use the previous answer, and `onNextSelect` fires `storePingStateAsync` without awaiting it before completion. Answer data/index writes are also separate. Slow storage, repeat taps, or process interruption can leave stale branching/resume state. High confidence in missing ordering; device failure incidence unverified. | Serialize answer saving and navigation, capture question identity, and make progress durable before completion. Acceptance: delayed/rejected writes, rapid taps, and restart at each boundary retain the final answer and advance once, with a recoverable save error. Preserve all coding/branch rules. |
| 2 | **Firebase retry is not idempotent.** `firebaseUploadDataForUserAsync` generates fresh push keys for each incremental attempt and performs separate ping/answer/user writes. If a later write fails after an earlier one succeeded, retry can duplicate records. Home can overlap uploads; its async helper does not await the upload chain. High confidence in client behavior; downstream deduplication unknown. | Coordinate one upload at a time and agree stable record keys/acknowledgments with backend owners, including existing-record migration. Acceptance: a mock/emulator accepts part or all of a request then loses the acknowledgment; retries produce exactly one logical record and preserve pending new edits. |
| 3 | **Rejected study updates destroy the active configuration — fixed here.** Previously `parseAndStoreStudyFileAsync` cleared all study keys even when JSON/schema validation failed before any writes. `RootScreen.loadTempStudyFileAsync` consumes a background download on next launch; another restart then finds no study. Responses are not directly deleted by that validation call, but their namespace becomes inaccessible through normal APIs. High confidence, reproduced in tests. | Preserve storage on pre-write rejection. Acceptance met: malformed JSON, missing/invalid configuration, and backend validation rejection retain the saved study; synthetic offline answers/user/queue remain readable; corrected updates work. First invalid enrollment stays invalid. Partial-write cleanup remains unchanged. |
| 4 | **Authentication errors can disclose credentials.** In `beiwe.makePostRequestAsync`, verbose errors serialize the request. Registration includes plaintext `new_password`; URL construction adds password hash and participant IDs to that object. `LoginScreen` displays the error; debug sharing can include error text. Resume snapshots also store responses outside SecureStore. High confidence in code, no real credentials inspected. | Replace raw request/response diagnostics with safe status categories and review snapshot storage. Acceptance: synthetic secret sentinels never appear in displayed/logged/shared errors; storage inventory and any migration are reviewed without changing retention policy. |
| 5 | **The development baseline is not reproducible as documented.** Node is unpinned; Yarn 3.1.1 breaks with this environment's Node 24; the schema Git archive no longer matches the lock checksum under Node 16 either. README assumes global Expo CLI; CI omits toolchain setup. High confidence, reproduced. | Establish a lab-controlled immutable schema artifact and explicit toolchain/CLI versions in a separate change. Acceptance: a fresh machine and CI install with immutable checks enabled, type-check/test, and launch a synthetic preview using documented commands. No checksum bypass in normal CI. |

## Additional journey checks and limits

- **Enrollment errors:** empty/malformed codes are rejected; HTTP 403 has a login-code message. Deep-link `decodeURIComponent` has no local error guard. An unavailable download is handled, but revoked credentials/offline authentication were not exercised against real services. No request timeout is defined in the fetch adapters.
- **Scheduling:** study boundary dates pass through `ignoreTimeObjectTimezone`; notification times use local midnight plus seconds, while tests force UTC. DST, timezone travel, changed permissions, and stale cached schedules need explicit expected-behavior decisions/tests. Scheduling successfully is not proof of notification delivery. No timing/randomization changes were made.
- **Completion and retry:** failed uploads keep pending IDs, but the completion view says the participant is done after the attempt finishes; synchronization uses terse debug symbols. Counts returned by a server can trigger manual full-upload repair, but do not establish exact-record equality. A full Firebase upload replaces the session root, which merits concurrency review.
- **Study compatibility:** this fix only covers failures before writing. Three-key storage is still non-transactional; a failed write retains the old cleanup behavior. Valid but incompatible study changes, changed study IDs, and Firebase instance changes are not solved. The existing error screen/restart instruction is unchanged.
- **Usability:** Next/PNA buttons have accessibility labels; small gray descriptions, opacity-only transitions, large-text layout, and focus order require a native accessibility pass. No screenshots are provided because no preview ran and no interface layout was changed.
- **Local isolation:** the exact debug study URL resolves through bundled `require`, and `server: {}` prevents backend login/upload. However, the bundled consent link and dashboard are external; the dashboard URL includes synthetic participant/session metadata. `__DEV__` alone does not disable live backends. Use storage/network mocks or a disposable fixture with local content; never paste real enrollment codes into a debug session. Native notification testing should use a dedicated test device.

## Verification and reproduction

The workspace began empty. The requested repository was cloned, the clean starting revision recorded, and the working branch created before edits. No deployment, store submission, participant notification, or merge was performed.

### Exact baseline

Use the checked-in Yarn executable (`node .yarn/releases/yarn-3.1.1.cjs`), not an arbitrary system Yarn. Attempts/results:

1. Initial sandbox install hit an unwritable global cache; setting `YARN_GLOBAL_FOLDER=/tmp/wellping-yarn-global` avoided that. Restricted DNS then blocked fetching, so dependency downloads were retried with network permission.
2. Node **24.19.0** + `install --immutable`: Yarn's compatibility patches fail with `QO.isDate is not a function`; schema checksum mismatch also reported.
3. Isolated Node **16.20.2**, downloaded from nodejs.org and checked against its published SHA-256 list: `install --immutable` still fails with **YN0018** for the locked schema Git archive. This occurs with dependency build scripts both disabled and enabled. Node 16 is a historical diagnostic tool, not a recommendation for the next production toolchain.
4. `yarn test` and `yarn start --offline --localhost` in the original checkout cannot run because installation has not produced the node_modules state file. Thus there is no passing exact-lock baseline.

### Diagnostic verification (separate from the exact baseline)

A disposable copy at `/tmp/wellping-validation` used Node 16.20.2, the checked-in Yarn, and disabled dependency build scripts. For this copy only, `YARN_CHECKSUM_BEHAVIOR=update` allowed inspection of the newly packed schema archive. The **only** lockfile difference was that dependency's checksum; package resolutions and the Git commit remained unchanged. Repository `package.json`, `yarn.lock`, and Yarn configuration were not modified.

The schema archive contains compiled `lib` files. Its exact locked Git source and `prepare: yarn run build` were inspected separately. Compiling that source with the app's TypeScript succeeded; output differs in compiler-generated JS/declarations. This does not prove equivalence to the unavailable historical archive, and the checksum mismatch remains unresolved.

To repeat the diagnostic checks in a disposable copy (not a production install):

```sh
# Select Node 16.20.2 only for this historical diagnostic environment.
export YARN_GLOBAL_FOLDER=/tmp/wellping-yarn-global
# Run this installation ONLY inside the disposable copy; inspect lockfile diff.
YARN_ENABLE_SCRIPTS=false YARN_CHECKSUM_BEHAVIOR=update \
  node .yarn/releases/yarn-3.1.1.cjs install
node .yarn/releases/yarn-3.1.1.cjs test --runInBand --watchman=false
node .yarn/releases/yarn-3.1.1.cjs jest \
  src/__tests__/helpers/studyFileRecovery.test.ts \
  --runInBand --coverage=false --watchman=false
```

| Check | Result |
| --- | --- |
| Original implementation with new tests | 4 new recovery tests fail; 2 new boundary tests pass. All 243 existing tests and 282 snapshots pass in the diagnostic setup. |
| Changed implementation | TypeScript passes; 13 suites, 249 tests, 282 snapshots pass. Focused recovery suite: 6/6. |
| Formatting/diff | Prettier checks for changed TypeScript and `git diff --check` pass. |
| Launch in diagnostic copy | `yarn start --offline --localhost` requests a global Expo CLI installation; no server or preview starts. No global installation was performed. |
| Native tooling | Only Xcode Command Line Tools selected; `xcrun simctl` unavailable. No physical device testing. |

Tests use synthetic bundled study content and mocked AsyncStorage/SecureStore; Firebase initialization is mocked. They reread persisted data through restart-facing APIs, but do not simulate OS process termination or establish native durability. Disabled sqlite3/native lifecycle builds were not needed by these tests. See [prioritized follow-up work](./next-version-backlog.md).
