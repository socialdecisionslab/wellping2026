# Stage 5: local researcher workbench tranche

Base: tested PR9 commit `96d48a9f1964f4772134c6a0961d8a44da3f2842`. Its exact-head [push CI](https://github.com/socialdecisionslab/wellping2026/actions/runs/39055315308) and [PR CI](https://github.com/socialdecisionslab/wellping2026/actions/runs/39055326947) passed. PR7 was externally merged into PR6 as `e2c9f1e`; its tree exactly matched tested Stage2. PR8 was retargeted to updated PR6 without rebasing or altering source. Main was not changed by this work.

The implemented workbench is described in [its README](../../researcher-console/README.md). It delivers real local study creation/editing, version snapshots/export/restore, schedule review, timezone projection, response-import completion views and lossless JSON/safer CSV exports. It deliberately does not impersonate a production backend or provide cosmetic roles without authorization enforcement.

Review found and fixed concurrent version-loss and stale-import/Clear races, stale projected timestamps after replacement, and missing graph-reference checks. Browser inputs are locked during accepted asynchronous operations; Clear invalidates pending response results. Tests exercise deferred requests rather than only immediate callbacks. The app's own export parser is reused, with additional detection of fields it would strip.

Core/server/DOM validation: 18 synthetic tests, including immutable revisions, content tamper detection, wrong-study/duplicate/lossy export rejection, original response-code preservation, DST repeated instants, origin/Host/form rejection, bounded oversized requests, no response-content errors, markup and CSV injection fixtures, concurrent-save fencing, and Clear during import/projection. Pinned-toolchain immutable install, typecheck and lint passed. Full mobile regression passed 32 suites, 438 tests and 282 unchanged snapshots, followed by all five security checks including 430 interrupted-write/restart scenarios. Exact-head remote CI remains a separate publication check. No real study backend, participant data, account, role grant or persistent credential was accessed or created.

## Remaining Stage5 release gates

- Actual backend identity, authenticated role enforcement and participant/study authorization, with negative access tests.
- Verified delivery/error telemetry and trustworthy compliance denominator; local imported records cannot establish either.
- Approved production data storage, retention, researcher exports and audit/access policy.
- Protocol-owner validation of dynamic graph behavior, scheduling across DST/travel and deployment/version migration.
- Actual browser visual/keyboard/screen-reader review. Chromium was blocked before rendering by a socket capability error; no bypass was attempted.

This is a tested local development tranche, not completion of the production researcher-dashboard stage. Independent Stage6 operational work may proceed while these gates remain explicit.
