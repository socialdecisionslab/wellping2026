# Architecture

WellPing is an Expo/React Native research survey application. The current candidate uses Expo 57, React Native 0.86, Node 22 and Yarn 4; older migration reports are historical, not installation instructions.

## Participant lifecycle

`RootScreen` reconciles recovery receipts and enrollment before opening a saved participant session. Login downloads and validates a study configuration. Background study refresh stages a candidate for later validation rather than replacing a running survey immediately.

`HomeScreen` initializes notification permissions and scheduling, displays synchronization status, and checks survey expiration on foreground, timer and notification events. Survey entry verifies participant ownership. `SurveyScreen` serializes answer writes and persists resume state before navigation. Completion persists the completion event and ping end time before clearing resume state.

Home initialization and refresh share one serialized promise lane. Notification delivery, notification responses and foreground events request a trailing check when work is already running rather than being dropped. Listeners are installed before initialization reads; the periodic timer and ready state are enabled only after initialization and queued checks finish. Recovery uses an explicit start operation, not a manual call to a React lifecycle method.

Resume retries also use that lane, capturing the ping being retried. Pending expiration checks run first; a retry for a cleared or replaced ping is skipped. After a resume read, existing expiration rules and journal activity are rechecked before publishing, with generation and ping-identity guards on the state update. Expiration clears obsolete resume errors and in-memory snapshots while preserving durable responses. This avoids resurrecting an expired survey or stranding the participant on a retry screen with no current ping.

Each Home lifecycle has a generation. Unmount, failure or restart invalidates older callbacks and asynchronous continuations; an old completion cannot restore UI state or remove newer subscriptions. Replacement work on the same instance waits for preceding work to settle. Accepted answer writes are drained, not cancelled or discarded. Already-started native/storage/network operations cannot be physically cancelled by this guard; it prevents subsequent Home-side effects and stale publication, not cancellation inside external APIs. Cross-participant storage writes remain protected by the journal ownership boundary.

## Persistence and ownership

The data journal is the authority for participant-owned response state. Its owner includes installation, study, username and login session. Write-ahead transactions, SecureStore chunks and manifests, and AsyncStorage metadata support recovery. Secure resume preserves interrupted work; legacy records without verified ownership are quarantined rather than assigned to the next participant.

Asynchronous work must retain its initiating owner across network waits. Owner-sensitive commits use the existing journal lock so logout or enrollment cannot change ownership between verification and persistence. Do not hold that lock during network requests or nest locking APIs.

Logout blocks active or unsynced work. Retained records are not automatically deleted after upload, logout, study completion or recovery failure. These interim rules apply to synthetic development data, not indefinite retention of real participant data.

## Scheduling and upload

Notification helpers derive reminders from validated study schedules and retain a scheduling cache. Same-day restarts and exhausted caches have regression coverage; actual notification delivery still requires native verification.

Uploads capture owner, destination and record revisions before networking. Acknowledgement occurs only after all required destinations succeed and applies to matching revisions. Firebase uses stable record keys; backend-specific Beiwe behavior remains unchanged. Client retries are not proof of exactly-once delivery. Historical acknowledgement is not current backend verification.

## Boundaries

See [network boundaries](security/network-boundaries.md) for legacy query credentials and redirect restrictions. Native smoke tests, physical devices, backend compatibility, signing and real-data governance are separate release gates. Researcher-console and operational-safeguard work in draft PRs #10 and #11 is not part of this branch.
