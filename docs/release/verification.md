# Repository verification — PR #13 integration

The table below records the original October 19 deployment-preparation checks before target-branch integration. See [PR #13](https://github.com/socialdecisionslab/wellping2026/pull/13) for the final integrated commit and its exact CI results. They are not signed release, live Beiwe, physical-device, or pilot evidence. Commit the reviewed candidate and regenerate native artifacts before recording release SHA/hash evidence.

| Check | Result |
| --- | --- |
| `corepack yarn test:ci` | TypeScript passed; 23 Jest suites, 305 tests, 282 unchanged snapshots passed; all offline security scripts passed. |
| Local JavaScript export | iOS and Android isolated questionnaire bundles compiled; participant enrollment graph excluded. |
| `node scripts/smoke-server.cjs` | Both mobile manifests and IPv4 localhost reachability passed after running outside the filesystem/network sandbox. The sandboxed attempt could not bind its port. |
| `corepack yarn smoke:release` | iOS and Android participant graphs compiled with synthetic staging settings; RootScreen and Beiwe v1 included, local runner excluded, OTA disabled. No backend contacted. |
| Workflow syntax / whitespace | Workflow YAML parses; `git diff --check` passed. GitHub-hosted native jobs were not dispatched. |

New checks cover ordered/retried saves, rapid Next, last-answer branch persistence, recovery from an older resume snapshot, retained pending revisions, upload serialization, stable receipts on retry, authentication in request bodies, missing/wrong acknowledgments, request/body deadlines, redirect response rejection, guarded release configuration, exact export comparison, active-study update deferral, and session/upload exclusion.

The suite still emits existing React asynchronous-update (`act`) warnings; these have not been suppressed. Native APIs and server responses are mocked. The client checks do not prove server authorization, deduplication/transaction durability, native redirect prevention, secure-storage behavior under OS termination, actual reminder delivery, accessibility, signing, or distribution approval.

Storage changes are deliberately conservative: incomplete indexed response records stop upload/recovery instead of acknowledging or discarding missing data. Such a device still needs the approved staff recovery process; never advise uninstalling or clearing data. Old development journal records without study-version metadata remain readable with a null version; Beiwe v1 upload refuses them for staff recovery instead of inventing provenance; no production-cohort migration is claimed.

Remaining prerequisites and the physical-device/pilot matrix are in [deployment](deployment.md). Server implementation and approval are governed by the [proposed contract](beiwe-contract.md).

## Integrated implementation

The target branch's owner-bound journal, shared accepted-answer lane, resume reconciliation, lifecycle retries, and v2 study envelope are retained. SurveyScreen now uses that target implementation unchanged: durable answers do not wait on React callbacks, and validation corrections enter the save lane before navigation is gated. Redundant PR locks, queues, revision stores, and recovery wrappers have been removed.

Regression coverage includes delayed slider values 10 then 90 followed by unmount, real saved forced-choice corrections, target-written study envelopes and tombstones, failed reads without evidence loss, older upload acknowledgments after new edits, and session/destination changes during hashing or network responses for both Beiwe transports. Staged updates wait for accepted saves and every active observation; expired records retain their originating journal version. Unknown historic versions are not guessed. Receipt validation is exercised through the real v1 adapter and journal, including retry after invalid acknowledgments.

The integration preserves the existing questionnaire, response encodings, and all original snapshots. Type checks, the full combined suite, security scripts, and both bundle modes must pass again on the final PR commit. These checks do not authorize participant deployment. The retained encrypted archives require the approved retention/recovery policy, and downgrading to older journal readers requires compatibility validation.
