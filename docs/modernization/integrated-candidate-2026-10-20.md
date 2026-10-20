# App assessment and consolidated mobile candidate — October 20, 2026

WellPing is a development candidate with substantial questionnaire and data-recovery coverage. It is not ready for participant enrollment. The modernized code remains outside `main`, and client tests do not establish backend durability, phone behavior, signing, or study approval.

## Source and scope

Branch `codex/consolidate-mobile-candidate` integrates PR #6 at `b5362eb65de6817d1f960f9a4c3ec5008ad07a27` with PR #12 at `a1759cd79b91175a8bb0e524376c571d48457414`. The former includes the revised PR #13; the latter includes the #8/#9 foundation and participant-experience work. Existing branches and `main` are preserved. Researcher console/operations drafts #10/#11 remain separate.

The integration keeps the existing encrypted journal, accepted-answer save lane, v2 study envelope, originating study versions, owner/destination checks, and receipt-based upload acknowledgements. It also keeps the newer serialized Home lifecycle, session-bound background study downloads, participant sync feedback, accessibility improvements, and expired-reminder-cache correction. No response encoding or DST protocol semantics are changed by this consolidation.

Startup and foreground upload retries now run after local recovery without blocking offline use or expiration checks. Generation checks prevent detached save/network completions from starting later uploads or publishing stale status. Synthetic deferred-promise regressions cover these boundaries.

The Android failure artifact from PR #12 run `39144241432` showed the local loading screen when the previous fixed-delay script searched for a question. The script now polls for an enabled answer control, verifies a changed question/completion screen, then force-closes and compares restored progress. A timeout still fails. Failure screenshots and XML are retained. This fixes the premature readiness assumption; passing native execution must still be established on the published candidate.

## Current standing

| Area | Evidence and implication |
| --- | --- |
| Mobile runtime | Expo 57.0.30, React Native 0.86.3, React 19.2.3, pinned Node 22.23.3/Yarn 4.18.1; no runtime version change in this integration. |
| Questionnaire and persistence | Broad synthetic coverage of rapid input, interruption, retries, expiration, session isolation and stale acknowledgements. This is a strong development foundation; OS termination and real-device storage remain unverified. |
| Enrollment and backend | Release builds require explicit configuration and an approved proposed `wellping-v1` adapter. No deployed adapter or successful live end-to-end study is established by this review. |
| Native validation | Both native builds and durable transition/reopen smoke jobs feed the required `native-validation` result, using the same workflow run and exact source SHA. New commit results must be checked independently of older green runs. |
| Dependency health | The refreshed incoming lockfile substantially reduces the previous audit surface. Two high and two moderate tooling advisories remain, plus five deprecation notices. The limited high-risk development exception expires October 24 or earlier on its stated conditions; no new acceptance or suppression is made. Production source-map guards exclude all four affected modules. |
| Research operations | Export reconciliation tooling exists, but real server exports, retention/withdrawal/recovery procedures, and pilot operating evidence still need validation and ownership. |
| Integration and review | One consolidated branch replaces the need to reason about divergent mobile stacks during testing. Independent approval and required checks remain necessary before `main` can advance. |

## Local verification

All checks used the pinned Node and immutable Yarn installation, synthetic data, and no live backend:

- Lint and TypeScript passed; 40 Jest suites / 522 tests / 282 unchanged snapshots passed.
- All five security scripts passed, including the expanded Home lifecycle/upload regressions and interrupted journal-write checks.
- Four Python readiness regressions passed: loading, disabled controls, wrong app, and timeout.
- Native workflow guard passed, including 15 configuration mutations and 17 aggregate failure cases.
- Isolated questionnaire, synthetic staging participant, and unconfigured production participant graphs compiled for iOS and Android. Both local manifests/listeners and the production dependency exclusions passed.

Existing React `act` and dependency/toolchain warnings remain visible. Local JavaScript verification is not native-device or backend validation. GitHub checks must run on the published commit; their results belong in the PR, not inferred from this table.

The October 20 `corepack yarn npm audit --all --recursive --json` refresh exited 1 with the same nine entries described above. Its [full output](dependency-audit-2026-10-20.jsonl) is retained; findings were not suppressed and no dependency was changed beyond adopting the incoming foundation lockfile.

## Next work, in order

1. Review this integration and obtain green `test` and `native-validation` results on its exact published SHA. Resolve runtime failures before advancing the candidate; keep the existing PR history intact.
2. Assign the backend owner and validate enrollment, authentication, receipt matching, deduplication, delayed retries, interrupted requests and export reconciliation against a controlled staging server. The proposed adapter contract requires explicit approval.
3. Run the device matrix on physical iPhone and Android phones: offline completion, force-close/reopen, background/foreground, permission denial/revocation, reminder delivery, day rollover/timezone changes and assistive technology. Record app/build identities and results.
4. Resolve or reassess the remaining dependency advisories before the development exception expires. Approve retention, withdrawal and recovery procedures; confirm support contacts, signing/distribution ownership and the study protocol.
5. Only then prepare a signed build and a small authorized pilot with acceptance criteria for response completeness, duplicate handling, notification delivery and staff recovery. Expand after reviewing that evidence.

The immediate priority is proving one integrated mobile candidate end to end. Additional researcher-console and operational features can be reviewed separately after that baseline is stable. See the [release runbook](../release/deployment.md), [device testing](../device-testing.md), and [dependency follow-up](dependency-risk-followup-2026-10-17.md).
