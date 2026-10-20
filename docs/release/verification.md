# Repository verification — October 19, 2026

These results describe the local working tree after deployment preparation. They are not signed release, live Beiwe, physical-device, or pilot evidence. Commit the reviewed candidate and regenerate native artifacts before recording release SHA/hash evidence.

| Check | Result |
| --- | --- |
| `corepack yarn test:ci` | TypeScript passed; 23 Jest suites, 305 tests, 282 unchanged snapshots passed; all offline security scripts passed. |
| Local JavaScript export | iOS and Android isolated questionnaire bundles compiled; participant enrollment graph excluded. |
| `node scripts/smoke-server.cjs` | Both mobile manifests and IPv4 localhost reachability passed after running outside the filesystem/network sandbox. The sandboxed attempt could not bind its port. |
| `corepack yarn smoke:release` | iOS and Android participant graphs compiled with synthetic staging settings; RootScreen and Beiwe v1 included, local runner excluded, OTA disabled. No backend contacted. |
| Workflow syntax / whitespace | Workflow YAML parses; `git diff --check` passed. GitHub-hosted native jobs were not dispatched. |

New checks cover ordered/retried saves, rapid Next, last-answer branch persistence, recovery from an older resume snapshot, retained pending revisions, upload serialization, stable receipts on retry, authentication in request bodies, missing/wrong acknowledgments, request/body deadlines, redirect response rejection, guarded release configuration, exact export comparison, active-study update deferral, and session/upload exclusion.

The suite still emits existing React asynchronous-update (`act`) warnings; these have not been suppressed. Native APIs and server responses are mocked. The client checks do not prove server authorization, deduplication/transaction durability, native redirect prevention, secure-storage behavior under OS termination, actual reminder delivery, accessibility, signing, or distribution approval.

Storage changes are deliberately conservative: incomplete indexed response records stop upload/recovery instead of acknowledging or discarding missing data. Such a device still needs the approved staff recovery process; never advise uninstalling or clearing data. Old development records without study-version metadata are tagged `legacy-unversioned`; no production-cohort migration is claimed.

Remaining prerequisites and the physical-device/pilot matrix are in [deployment](deployment.md). Server implementation and approval are governed by the [proposed contract](beiwe-contract.md).
