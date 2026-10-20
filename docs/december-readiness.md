# First study: December 2026 readiness

Implementation follow-up: use the [release runbook](release/deployment.md) for current client changes, required account/configuration inputs, verification, and go/no-go criteria. Beiwe is the selected backend; a new lab-owned deployment and approval of the proposed integration contract are still required.

Target: first participant use on both iPhone and Android, starting sometime in December 2026. There is no existing deployed cohort to migrate. The repository's social-interaction questionnaire is the starting instrument, pending PI review; its development example dates, reminder schedule and bonus wording are not an approved study protocol.

## Implemented in this candidate

- Supported Expo 57 / React Native 0.86 runtime with a pinned installation and updated test tooling.
- Current native API usage for notifications, listener cleanup, app metadata and text fields.
- Isolated preview of the existing 16-question survey with separate saved progress, plus a short regression fixture.
- Type checking, survey snapshots, secure-resume regressions and two-platform JavaScript compilation.
- Separate local app identifiers and generated native project configuration.

## October: native builds and study decisions

1. GitHub-hosted native compilation is configured and has produced both builds. Complete the [device checks](device-testing.md) on physical iPhone and Android phones; record OS/model/build identifiers and results. Apple developer team access is still needed for the intended iPhone distribution route.
2. Review the existing questionnaire's wording, response choices, branching, sensitive free text, completion time and accessibility. Select study dates, daily reminder windows, expiry and compensation language.
3. Confirm lab ownership of Apple/Google developer accounts, bundle identifiers, support contact and distribution route. The original Stanford owner/store references are not a new lab release configuration.
4. Select and configure the study backend, data access, retention and export format. Replace legacy URL-carried credentials with an agreed secure enrollment mechanism. Verify uploads are idempotent and recover after interrupted connections.

## November: end-to-end rehearsal

Use a staging backend and synthetic accounts first. Verify enrollment, permissions denied and restored, background/reboot behavior, reminder timing, time-zone changes, offline answers, force-close/reopen, interrupted uploads, duplicate prevention and complete analyst exports. Check large text and screen readers on both platforms.

Then run a small authorized pilot for several days, reconcile expected prompts and responses against exported records, and fix discrepancies. Freeze the questionnaire/version and prepare participant installation and support instructions. Leave time for distribution review and another pilot after material changes.

## December: enrollment gate

Start only after both-platform device results, recoverable storage, notification behavior, authenticated uploads and exports have been verified, and the PI has approved the instrument and study configuration. A passing JavaScript suite alone is not this gate. Exact launch date, participant count, backend and distribution route remain undecided.
