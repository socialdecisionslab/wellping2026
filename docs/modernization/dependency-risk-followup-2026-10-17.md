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
