# Local research workbench

This is a working, **single-operator, loopback-only development workbench**, not a public or production multi-user dashboard. Use synthetic data for evaluation. It does not connect to Firebase, Beiwe, study URLs or telemetry services, and never enrolls participants, deploys a questionnaire, creates accounts or changes backend permissions.

## Run

Use the repository's pinned Node version and immutable dependencies:

```
yarn install --immutable
yarn researcher:local
```

Open `http://127.0.0.1:4317` on that same machine. The server intentionally rejects alternate Host/Origin values. Do not bind it to a public interface, reverse-proxy it, or expose it through a sharing tunnel. Other processes/users already able to access loopback are not authenticated: this is not a security boundary suitable for production research records.

## Working functions

- Create a schema-valid no-server draft template, or import a study JSON file.
- Edit the full questionnaire/schedule JSON, validate it with the same vendored schema as the app plus conservative graph-reference/HTTPS checks, and download it. Dynamic protocols still require protocol and mobile validation; this tool does not prove graph termination or scientific validity.
- Save uniquely versioned questionnaire snapshots in memory. Earlier revisions are not overwritten. Export/restore a history archive; checksums cover questionnaire content, not timestamp/order authenticity or authorship. Download before closing the tab. To restore a different archive without losing an existing in-memory history, use a new tab.
- Review participant-device-local schedule windows, with the app's local-wall-time start/end semantics made explicit. Choosing an IANA zone does not change deployed scheduling. Project absolute timestamps from response exports into a viewing zone, retaining their original offset fields and distinguishing DST repeat instants.
- Import version1 session exports produced by the app's `researchExport` contract. The original recognized fields, response values, ordered choices, Unicode, dates, offsets, PNA and incomplete records are retained. Unknown fields that would be stripped by validation are rejected rather than silently discarded. Original files are never overwritten.
- Inspect completion counts from the imported records, export validated JSON bundles, or download a formula-neutralized completion CSV. CSV contains identifiers/counts only, not answer content. JSON is the research interchange format; historical downstream-parser compatibility is not asserted.
- Failed replacements leave prior records intact. Concurrent operations cannot overwrite accepted revisions; Clear fences pending imports/projections. No automatic browser/local-disk persistence or remote analytics.

## Deliberately unavailable

There is no production user directory, enforced administrator/analyst role, authenticated researcher session, notification-delivery feed, server upload receipt or global compliance denominator. Delivery states are explicitly **unknown**, not inferred from missing answers or successful file import. Supplying a role dropdown or made-up delivery counts would create false assurance. These features require the actual backend contract, identity/authorization design, approved data access and retention policy.

The template uses `example.invalid` and an empty upload server configuration. It is not ready for participant use. Existing backend credential-transport, migration and retention gates remain open. Never put account passwords, service-account keys or other private credentials into a study file.

## Tests and limits

`yarn test:researcher` builds the app's existing export/network validators and runs Node core/server tests plus synthetic DOM interaction tests. CI runs this alongside the mobile suite. The direct jsdom dev dependency pins the already-installed Jest fixture version without changing the dependency graph; it is not used in production/mobile code or the served browser page.

The cloud Chromium visual attempt failed before rendering due to an unavailable process-singleton socket capability. No sandbox/security setting was bypassed. DOM tests are not a substitute for real-browser visual, keyboard and accessibility review. Production deployment and real participant data use remain unapproved and out of scope.

## Workspace backup

The workspace backup includes the validated draft, revision history, imported response exports and viewing timezone. Restore in an empty new tab; validation completes before any state is replaced. Clear cancels an outstanding restore. Downloads are plaintext: use approved protected storage, and retain original exports separately. Checksums detect accidental changes but do not authenticate authors or encrypt data. The console refuses to create a backup too large for its restore request limit. This is not a mobile journal or backend restore. See the Stage6 operations runbook for synthetic recovery drills and deployment gates.
