# Stage 4: participant clarity and accessible choices

Based on Stage 3 review commit `154e2fe678c04dbaa2dbf57f62892601f852d476`. Its exact-head CI checks and [Android/iOS native builds](https://github.com/socialdecisionslab/wellping2026/actions/runs/39054274297) passed. The [Android emulator check](https://github.com/socialdecisionslab/wellping2026/actions/runs/39054274271) stopped before launch because the runner lacked read/write access to /dev/kvm; host permissions were not broadened. iOS launch/reopen validation is tracked separately on PR8. This tranche does not claim to close production backend, physical-device or screen-reader validation gates.

## Implemented behavior

- Home shows an atomic, content-free count of saved and pending survey records. A successful network callback alone never makes the UI claim upload: the summary is read from the durable revision acknowledgement journal. Updates made during an older upload remain pending.
- Distinct checking, saved/pending, uploading, failed-sync, confirmed-acknowledged and no-upload-service messages. Retry is available outside survey windows and after study end, not just immediately after completing a survey. Active survey controls are not interrupted by this panel.
- A clean journal reflects historical acknowledgements, not verification of the current server. The journal does not retain acknowledgement destination; changing a study backend requires a separately verified migration/reconciliation plan. The UI deliberately does not attribute historical acknowledgements to a newly configured destination.
- Removed unconditional permission to uninstall after the study ends. Even acknowledged records do not imply staff review, payment verification, backup retention or permission to remove the app. Participant instructions retain this distinction.
- Choice controls announce radio or checkbox roles and checked/disabled state; HowLongAgo choices inherit radio semantics. Existing answer values, ordering, shuffle, scoring and survey timing are unchanged. Hidden slider scoring has not been exposed.
- Login explains private-code handling, offline storage versus upload, and reminders. The input is labelled, errors/loading have accessible roles and Android live regions, and malformed encoded login links offer retry instead of throwing. Existing age/consent procedures are unchanged. Non-survey Home screens scroll so the new status/help controls do not push actions out of reach; the embedded dashboard retains a minimum viewport.

Accessibility semantics follow the [React Native accessibility API](https://reactnative.dev/docs/0.86/accessibility). Native screen-reader behavior remains a separate verification gate.

## Validation

Local baseline run: 32 suites / 438 tests / 282 unchanged snapshots, TypeScript and lint passed. Focused tests cover pending versus acknowledged records, retry without assuming success, no-service/error/uploading states, stale async status reads, checkbox/radio semantics and disabled behavior, and malformed login links. Synthetic journal tests verify old upload acknowledgements cannot clear a newer revision's participant status. Home regression checks cover the post-study sync panel and removal of unsafe uninstall advice.

Independent review confirmed both identified issues fixed: destination-neutral historical acknowledgement wording, and malformed links tested through the installed Expo parser. Both isolated questionnaire bundles/manifests and both full production participant UI bundles compile. Production compilation never launches enrollment or contacts a backend; it is now a separate CI check because synthetic builds intentionally exclude Home/Login.

The final 32-suite / 438-test run passed sequentially. An earlier run overlapping bundle compilation had readiness timeouts; the isolated affected suite and the final full run passed without snapshot changes. Exact-commit remote CI must still be checked at publication. No live participant data or backend was used. VoiceOver/TalkBack, large-text layout, touch targets on physical phones, real notification delivery and iOS answer persistence still require the device checklist. This is a tested client UX tranche, not a clinical/research usability certification or production release approval.
