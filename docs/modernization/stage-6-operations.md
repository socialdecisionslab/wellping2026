# Stage 6: operational safeguards and release gates

Base: Stage5 PR10 commit `384e20e7c60986a1a3d817ec7633d7773b9cd3bc`. This tranche does not grant production-release approval.

## Implemented safeguards

- Local researcher workspace backup includes the validated current draft, immutable questionnaire history, original response exports and viewing timezone. SHA-256 covers the complete payload, including history timestamps/order. Restore validates checksum, schemas, graph references, study identity, duplicate sessions and original response fields before replacing any in-memory workspace. Restore requires an empty tab; Clear invalidates a pending restore. A generated archive must fit the server's restore-request size limit. Backups are plaintext and checksums are not signatures, authentication, encryption or protection against an attacker who recomputes them. Original files are never overwritten.
- Default-disabled, bounded, memory-only diagnostics count only two enumerated failure categories. No error messages, stack traces, answers, IDs, timestamps, installation identity, storage or transmission. Developers may explicitly call `configureLocalDiagnostics(true)` in an authorized local test; `false` clears counters. This is not a crash-reporting service or native crash collection. Existing user-initiated app-detail sharing still excludes arbitrary diagnostic/error text.
- A render error boundary presents generic, non-destructive recovery guidance without the thrown content. It drains accepted response writes and retries detached failures; on failure it keeps the app open and offers a safe save retry. Reopen guidance is shown only after that lane succeeds. It does not clear storage, reset enrollment, auto-remount surveys or promise screen/resume recovery. Asynchronous and native failures are outside React render-boundary coverage. React Native may independently forward caught errors to platform exception reporting; this boundary does not sanitize or disable framework/native logs. Tests establish only fallback/counter redaction, not end-to-end platform log redaction.
- `yarn release:manifest` produces deterministic source provenance from a clean checkout: exact commit/tree, pinned Node/Yarn identity, application/native version identifiers, and hashes of dependency/schema/config/workflow inputs. It fails on dirty source or inconsistent identities and explicitly marks production approval false. It does not sign or upload anything and is not proof of bit-for-bit reproducible native binaries.

## Release procedure

1. Release maintainer selects an exact reviewed commit from the stack. Do not infer approval from a draft PR, passing CI or this document. Record who approved the study protocol and release separately in the institution's authorized system.
2. Clean checkout; install exact Node from `.nvmrc`; run pinned `corepack yarn install --immutable`. Run typecheck, lint, full `test:ci`, `test:researcher`, isolated smoke builds and production-UI bundle checks. Save exact-head CI URLs. Do not reuse native evidence if relevant native inputs changed.
3. Generate source provenance. Match native artifacts to that exact commit and record artifact SHA-256, signing identity, package/bundle identifiers and build numbers. Existing cloud builds are development/simulator evidence, not app-store distribution approval. Production signing, version increments, submission, OTA and deployment require separate release authority.
4. Complete physical Android/iOS tests: answer persistence across process death, secure-store capacity/failure, interrupted uploads, notifications/background scheduling, DST/travel, accessibility and the actual participant UI. An iOS launch/reopen smoke is not answer-persistence proof. Android emulator access remains blocked where KVM is unavailable.
5. Backend owner verifies credential transport, participant authorization, server idempotency, all-destination receipts, retention and restoration. Never test against real participants without explicit approval and a protocol. Query-string credentials and unaudited backend rules remain production blockers.
6. Release only after explicit gate signoff. Rollback must preserve journal/schema compatibility: do not downgrade a device with newer records until migration/restore compatibility is proven with synthetic data. Stop collection rather than deleting, resetting or uninstalling to hide an error.

## Backup and recovery drill

Use synthetic data only until institutional storage/access/retention is approved. Create two questionnaire revisions, import complete and incomplete synthetic session exports, download a workspace backup, close the tab, and restore in a new tab. Compare every original response code, Unicode/text value, timestamp/offset, version and history item. A modified checksum, wrong-study export, duplicate session or unknown export field must fail without partial replacement. Keep separate protected copies of original exports; browser memory is not durable storage. A successful console restore does NOT restore the encrypted mobile journal, native keychain or backend database. Mobile/backend backup policy remains an open gate; do not enable OS cloud backup as a workaround.

For an incident, preserve the device and source exports, stop destructive troubleshooting, note only a generic failure category and exact build identity, and contact the designated technical and study owners. Do not paste responses, passwords, URLs carrying credentials, logs or participant identifiers into public issues. Any approved sensitive-data recovery/export must use the institution's authorized access and transfer process. Do not delete retained legacy records until migration identity and retention authority are verified.

## Ownership to assign before deployment

These are required roles, not claims that a person has accepted responsibility:
- Study/protocol owner: questionnaire versions, consent, participant communications, data coding and scheduling signoff.
- Mobile/release maintainer: pinned toolchain/dependency review, platform updates, exact-artifact evidence, signing and rollback compatibility.
- Backend/security owner: authentication/authorization, credential contract, idempotency, encrypted backups and tested restoration.
- Data steward: access grants, approved export destinations, retention/deletion policy and incident response.

At each dependency/platform change rerun the relevant checks; review advisories and supported platform requirements before each release. Known high-severity upstream findings are documented in Stage3, not silently waived. No recurring external monitoring, credentials, paid service or telemetry endpoint was created.

## Validation status

Pinned immutable install, typecheck and lint passed. Full mobile regression passed 33 suites, 442 tests and 282 unchanged snapshots; all five security scripts passed, including 430 interrupted-write/restart cases. All 24 local workbench/backup/release tests passed, including near-limit restore, invalid types, tampering and atomic restoration. Both isolated and production iOS/Android JavaScript bundles compiled; production source maps include the new recovery boundary and diagnostic module. Dirty source provenance was correctly rejected; clean exact-commit provenance and remote CI are publication checks. Independent review findings were resolved and rereviewed. All unperformed physical-device, backend, signing, visual/accessibility and institutional-policy gates remain open.
