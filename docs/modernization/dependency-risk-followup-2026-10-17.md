# Dependency risk follow-up

Audited source: `57ab7b00fcf1a4b6cd614f0fc5806792b65a8826`, using its unchanged package.json/yarn.lock on October 17, 2026. Command: `corepack yarn npm audit --recursive --json`. Initial sandbox DNS failure was retried with approved registry access. The successful registry response exits 1 because findings remain, not because the audit is clean. Raw output is in `dependency-audit-followup-2026-10-17.jsonl`.

The refreshed audit still reports nine package entries (including deprecations), with two high findings. Registry latest versions remain braces 3.0.3 and node-forge 1.4.0; both matching GitHub-reviewed advisories list no patched version. No compatible published fix was identified. Dependencies and lockfile were not changed; no overrides or advisory suppressions were added.

| Dependency | Exposure traced in this checkout | Unresolved risk |
| --- | --- | --- |
| braces 3.0.3 | micromatch 4.0.8, used by Jest and Metro file matching | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm): deeply nested input patterns can exhaust the Node stack. Treat hostile pattern/config input as a build-tool availability risk. |
| node-forge 1.4.0 | Expo CLI and @expo/code-signing-certificates 0.0.6 | [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv): malformed RSA PKCS#1 v1.5 verification input may permit signature forgery under the described key conditions. Tooling/certificate trust exposure requires review; this is not proven harmless merely because it is outside app code. |

The production bundle check now rejects either dependency appearing in Android/iOS JavaScript source-map graphs. A passing export demonstrates absence from those generated JS graphs only, not absence from every native binary, Expo service or external tool. No live backend, signing service, certificate forgery or exploit test is performed.

Interim mitigations: retain isolated secret-free synthetic builds, do not feed untrusted certificates or user-selected glob patterns into these tools, do not launch participant production services, and keep mandatory review. These reduce exposure but do not fix the libraries or automatically accept the risks. Existing PR code already executes in CI; application-level tests do not prove all tooling inputs safe.

## Approved temporary exception — October 17, 2026

The maintainer explicitly approved the proposed development-only exception for the two findings above. The vulnerabilities remain unresolved; this approval is not a clean audit or authorization to merge.

- Applies to synthetic development only: no participant data, deployment, signing credentials or production secrets.
- Do not process untrusted certificates or externally supplied glob patterns with the affected tooling.
- Mandatory CI and independent review remain enforced. Do not suppress advisories or disable security checks.
- Re-audit before integration and after dependency changes.
- Expires October 24, 2026, or earlier if exposure changes or a compatible fix becomes available. No automatic renewal is authorized.
- Merging requires separate explicit authorization. Participant deployment requires a separate security assessment and approval.

Monitor compatible upstream patches and dependency removal options; do not fork cryptographic verification or force an incompatible toolchain change merely to clear the audit. This exception does not extend to additional findings or broader tooling exposure.

## Autonomous candidate recheck

On October 17, 2026, `corepack yarn npm audit --all --recursive --json` was rerun at `bf4734e6373167348806a3cd40d3702f1340966b`. It exited 1 and reported the same nine package entries: two high advisories, two moderate advisories and five deprecations. The package manifest and lockfile remain unchanged. This is not a clean audit.

The existing moderate advisories also require follow-up; the approval above does not accept them:

- `sprintf-js` 1.0.3 via `argparse` 1.0.10: [unbounded precision denial of service](https://github.com/advisories/GHSA-hp3w-g68c-fv3c). Inspected argparse uses format templates for usage/help/error text. The js-yaml CLI supplies fixed help strings; application study loading uses js-yaml's `safeLoad`, not its CLI. No app use of arbitrary sprintf templates was found. Registry latest sprintf-js is 1.1.3, still within the reported affected range. Replacing the YAML parser solely to remove CLI tooling could change accepted research configurations and needs compatibility evidence.
- `uuid` 7.0.3 via `xcode` 3.0.1: [buffer bounds validation](https://github.com/advisories/GHSA-w5hq-g745-h8pq), affecting specified UUID APIs with caller-provided buffers. The inspected xcode library has one UUID call: `uuid.v4()` without a supplied buffer, unlike the advisory's described use. Application persistence uses the separate `react-native-uuid` package. Registry latest xcode remains 3.0.1 with uuid `^7.0.3`; uuid latest is 14.0.3, so overriding across major versions is not an independently compatible remediation.

The production module guard now checks braces, node-forge, sprintf-js and uuid. This is a build-time exposure safeguard, not a dependency fix. Its absence claim applies only after a passing graph check and only to those JavaScript graphs, not native artifacts or every tool invocation. Human integration review should consider the full audit, not merely the two approved high findings. No additional risk exception is granted by these code-path observations.
