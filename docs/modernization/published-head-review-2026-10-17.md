# Published-head integration checkpoint

Candidate: `57ab7b00fcf1a4b6cd614f0fc5806792b65a8826`.
Compared with main: `3242243a5e242987b822de902d442e4434f4773b`.
Observed October 17, 2026. This supersedes the earlier checkpoint's uncommitted status, not its remaining human gates.

## Exact-head CI evidence

| Gate | Push run | PR run |
| --- | --- | --- |
| General CI | [Passed](https://github.com/socialdecisionslab/wellping2026/actions/runs/39059589298) | [Passed](https://github.com/socialdecisionslab/wellping2026/actions/runs/39059592317) |
| Android native build | Passed | Passed |
| iOS simulator build | Passed | Passed |
| Android smoke | Failed: infrastructure | Failed: infrastructure |
| iOS smoke | Still running at checkpoint | Still running at checkpoint |
| Native aggregate | Not yet reported | Not yet reported |

Native runs: [push](https://github.com/socialdecisionslab/wellping2026/actions/runs/39059589297), [PR](https://github.com/socialdecisionslab/wellping2026/actions/runs/39059592373). Both runs identify the candidate SHA. Native jobs explicitly check out that SHA; general PR CI uses GitHub's merge checkout rather than the native head-only checkout.

Android PR job `117476899773` successfully checked out the candidate, downloaded its same-run artifact, and passed `build-identity.sh verify preview`. It then failed because `/dev/kvm` was not readable/writable. The app was not launched. The equivalent push job failed at the same preflight. This establishes trigger/artifact plumbing, not Android runtime correctness. No runner permissions were changed or failure waived. Final aggregate reporting is still unverified on GitHub; its dependency failure behavior was tested locally in the preceding step.

## Combined-diff inspection

The comparison contains 131 changed files, including the lockfile and large journal/test additions. This was a focused integration and data-lifecycle inspection, not independent exhaustive security sign-off.

- Current main and PR #8's head are ancestors of the candidate. PR #6's merge commit is not an ancestor, but its complete tree `baf3057d87911bd66bdcc4302ce6d82e4fce5fb8` exactly matches ancestor `9a576ac`. Its code is included; its merge topology differs. Do not duplicate its changes by blindly cherry-picking the stack.
- GitHub reported #6, #8 and #9 mergeable against their respective bases, all still draft. A read-only three-way comparison of #6 with the candidate showed no conflict markers. This is not approval of a future integration SHA: base changes or a different merge strategy require fresh validation.
- Inspected upload capture, acknowledgement, logout, journal removal and their callers. Upload acknowledgement is fenced by owner, destination and captured revision; dirty/active records block logout; closed archives remain preserved. Existing synthetic tests cover lost acknowledgements, delayed session changes and owner isolation. No new reproducible data-loss defect was established in this inspection.
- Logout preservation currently means refusing logout while dirty/active answers remain, not allowing offline logout followed by automatic cross-session recovery. Maintainers must explicitly accept this behavior. A participant-facing archive restoration or staff recovery service is not implemented.
- Low-level record deletion and `clearAllPingsAndAnswersAsync` remain available without retention-policy approval checks. No production caller of that cleanup entry point was found. They must not be exposed as a participant purge facility without owner fencing, approved retention rules and interruption tests.
- The checked-in dependency audit reports two unresolved high findings (`braces`, `node-forge`). This inspection did not refresh registry advisories or establish exploitability; these require separate dependency review rather than treating passing synthetic security scripts as a clean dependency audit.
- Native smoke uses synthetic local mode. iOS smoke only checks launch/reopen/rendering, not survey-answer persistence. Neither native workflow validates backend authorization, actual reminder delivery or participant enrollment against a live service.

## Human checkpoint

Stop before integration. Select an approved accelerated Android runner configuration; review its permission/security implications rather than silently bypassing the failed preflight. Finish iOS smoke and observe the aggregate result before calling exact-head native validation complete.

Main protection, independent review, retention/recovery approval and dependency-risk disposition remain outstanding. An administrator must verify that required reviews and observed check contexts actually block merging. A new integration branch is optional for review topology, not necessary merely to combine code already present here. If created later, validate its exact SHA against the latest main.

No branch, PR status, remote content, merge or deployment was changed during this inspection. This report is a local, uncommitted follow-up. Physical-device and backend validation remain explicitly unverified. Participant deployment remains unauthorized.
