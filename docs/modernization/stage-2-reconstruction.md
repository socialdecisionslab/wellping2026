# Stage 2: data reliability reconstruction on PR6

Status: implementation checkpoint, not production-ready. Final validation results are recorded when the review commit is published.

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
- Logout refuses pending/in-progress observations and retains encrypted owner-isolated records rather than partially deleting them. This is retention, not a claim that records have been erased. A later account does not inherit those observations.
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
