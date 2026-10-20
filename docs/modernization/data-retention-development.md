# Development baseline: data preservation and retention

Status: proposed operational policy requiring maintainer approval. The implementation preserves records; this document does not authorize participant-data deletion or assert that native storage/backend validation has passed.

## Current behavior

- Accepted answer writes drain before logout. A failed save, dirty revision, or active observation blocks teardown. Expired incomplete observations remain incomplete and must synchronize before logout can close their session.
- Logout closes an owner-bound journal and clears credentials and known temporary scheduling metadata. Encrypted research records remain in a closed archive. An interrupted teardown resumes using a verified receipt rather than treating missing credentials as a new empty session.
- Ownership includes study, installation, participant and login session. Reads and accepted writes are fenced to that owner. A new participant starts an isolated journal; knowing an older ping/question ID does not authorize access to it. Ambiguous legacy records are quarantined, not assigned to a new participant.
- Upload attempts are serialized separately from storage. Capture binds records to an owner, destination and revisions. Failure leaves records pending; later retry must acknowledge those exact revisions. A newer answer remains dirty after an older upload succeeds. Every configured destination must succeed before acknowledgement.
- An acknowledgement is not deletion permission or fresh verification of the current backend. Historical acknowledgement metadata does not establish backup, staff review, compensation eligibility or successful migration to a replacement destination.

## Proposed deletion and recovery rules

1. No automatic purge on logout, study end, successful upload, enrollment failure or recovery failure. Do not advise uninstalling as a recovery procedure.
2. Retain unsubmitted/unsynced observations and ambiguous legacy evidence. If recovery cannot verify ownership, block access and preserve bytes for authorized staff recovery. Do not infer ownership from timestamps or a newly entered login code.
3. Before any future purge facility is enabled, a maintainer must approve the retention duration, authorized operator, owner verification procedure, required export/backup verification, withdrawal handling, and audit evidence. No duration is selected by this implementation.
4. Purge must target one verified owner and preserve other participants' records. A clean local queue alone is insufficient. Validate interrupted deletion and recovery, and distinguish intentional deletion from missing/corrupt data.
5. Keep automatic retries bounded in any future background-sync work. Current retries are explicit application attempts, not a guaranteed background delivery service. Validate timeout/cancellation, partial acceptance, lost acknowledgements and backend deduplication before participant deployment.

The code still exposes low-level record-removal helpers for explicit cleanup/tests. These are not an approved retention service and do not enforce a research retention period. A production deletion workflow and staff recovery interface are not implemented. Do not route participant-facing cleanup through these helpers without the policy and owner-scoped tests above.

## Evidence and limits

The new LogoutRecovery regressions exercise rejected logout with an unsynced edit, startup recovery, interrupted teardown, retained archive bytes, and a subsequent participant's inability to read or overwrite the prior owner's answer. Existing journal tests simulate failures around durable mutations and module restart. These are synthetic JavaScript/storage-adapter tests, not actual process kills or physical SecureStore evidence.

The development baseline can retain outstanding physical-device and backend integration gates. Participant deployment cannot treat those gates as passed. Maintainer approval of the exact retention/recovery/deletion rules remains required.
