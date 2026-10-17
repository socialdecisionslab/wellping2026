# Stage 2: data reliability reconstruction on PR6

Status: locally validated Stage 2 client implementation; backend and native-device release gates remain incomplete. Not production-ready.

## Baseline and scope

This work starts from PR6 commit b76b14e1c945c3587204cd77e6e2bc12913129d1, not the older Expo49 security branch or stacked PR5. The earlier uncommitted Stage2 workspace was unavailable; these changes were reconstructed against PR6. Original questionnaire schema and response coding remain in place.

The unchanged baseline typechecked. Its first full Jest run passed 256 of 257 tests with a choice-completion timeout; the same isolated suite then passed 46 tests and 52 snapshots. All four baseline security scripts passed. This is not a claim of a clean first baseline run.

## Implemented boundaries

- Research records use an owner-bound encrypted journal, recoverable write-ahead operations, chunked secure values, and revision-aware upload acknowledgement. Writes capture their arguments and session scope before asynchronous work.
- Survey navigation waits for durable answers and resume snapshots. Failed operations retain retry context; stale callbacks cannot advance a later question. Restored controls preserve saved answer meaning and randomized presentation order.
- Ambiguous legacy resume bytes are quarantined and verified before plaintext cleanup. No timestamp-based ownership inference is used. Corrupt or missing indexed data fails closed with recovery UI, not a fresh empty survey.
- Study updates replace a single validated aggregate. Failed writes keep the previous valid configuration. A tombstone prevents interrupted legacy cleanup from resurrecting old configuration.
- Firebase retries use stable logical identifiers and atomic multipath writes preserving remote-only records. Both backends bind dispatch to the captured account and destination. Every configured destination must succeed before local acknowledgement.
- Follow-up pairs and their idempotency decisions are stored atomically. A queued follow-up is reserved until durable ping insertion succeeds, then acknowledged. Its insertion token survives retries.
- Logout unmounts survey inputs, drains accepted writes, and refuses unsynchronized or still-active observations. Known expired incomplete observations retain their original incomplete status and can be synchronized before logout. A durable closed-session receipt recovers interrupted credential/configuration teardown; encrypted owner-isolated archives remain intact. Verified closed archives permit a later isolated enrollment, while unknown legacy or unresolved quarantine still blocks. This is retention, not erasure.
- A versioned synthetic-tested JSON export preserves dates, timezone offsets, response order, PNA, and interrupted observations without credentials. This is a new explicit interchange format, not verified compatibility with historical parser tools.

## Remaining release gates

1. Beiwe and authenticated study-download credential transport remains the existing query-parameter contract. A backend-supported replacement must be verified before changing it. No live backend was accessed.
2. Backend guarantees are not globally exactly-once. Multiple clients editing the same logical Firebase record remain last-write-wins; old clients may still create legacy duplicates. Beiwe deduplication requires a verified server contract.
3. Legacy unowned response records and nonempty earlier follow-up queues require staff-assisted ownership recovery. Their original bytes are preserved and must not be silently assigned or discarded. A production recovery workflow is not supplied by this patch.
4. Retained historical owner archives need an approved retention/export/deletion policy and an authorized recovery workflow. Logout is no longer an erasure operation.
5. Native SecureStore, notification permissions/delivery, OS termination, and participant distribution require device validation. Synthetic mocks are not evidence of physical iOS/Android behavior.
6. Firebase now requires an explicit HTTPS databaseURL matching the actual initialized app; configurations relying on implicit inference must be reviewed.
7. Dependency ESLint configuration currently requires an absent eslint-plugin-import. Focused checks do not substitute for a working aggregate lint gate.

No merge, deployment, production participant data access, credential rotation, or new persistent access is part of this stage.

## Durable checkpoint evidence

- Draft review: https://github.com/socialdecisionslab/wellping2026/pull/7, stacked on PR6; not a merge request for main.
- Initial incomplete checkpoint: 83e875522a37f7ae574d93e48e7ae0e3d9e9b49c; tree 0994e08946bd780c134741f178942e4fbdb43c8e; remote tree and parent independently fetched and verified.
- Working-tree aggregate on October 17: 26 Jest suites, 374 tests, 282 original snapshots passed. Further edits after this run require a new aggregate run.
- Exact initial-checkpoint CI run [39051460162](https://github.com/socialdecisionslab/wellping2026/actions/runs/39051460162) passed installation and typecheck, then failed two new survey readiness assertions (379/381 tests and all 282 snapshots passed). Security and bundle steps did not execute. Tests now await durable readiness/terminal completion instead of incidental flush timing; the final tree still needs its own complete CI result. This checkpoint is not a green-release claim.
- Final October 17 local validation after lifecycle and owner-fence fixes: `yarn test:ci` exited 0, TypeScript passed, 30 Jest suites / 427 tests / 282 unchanged snapshots passed, and all five security entry scripts passed. The journal script covers 430 before/after mutation restart cases plus silent-write, malformed-state, ownership and concurrency cases.
- `yarn smoke:local` exited 0: isolated iOS and Android bundles compiled and both local development manifests/listeners passed. These are JavaScript bundle checks, not new native builds or physical-device evidence.
- The follow-up commit and its exact remote CI result must be checked in PR7. Passing local checks does not close the backend/device gates above. Continue independent modernization work without claiming those gates complete.
