# Dependency risk follow-up

Audited source: `57ab7b00fcf1a4b6cd614f0fc5806792b65a8826`, using its unchanged package.json/yarn.lock on October 17, 2026. Command: `corepack yarn npm audit --recursive --json`. Initial sandbox DNS failure was retried with approved registry access. The successful registry response exits 1 because findings remain, not because the audit is clean. Raw output is in `dependency-audit-followup-2026-10-17.jsonl`.

The refreshed audit still reports nine package entries (including deprecations), with two high findings. Registry latest versions remain braces 3.0.3 and node-forge 1.4.0; both matching GitHub-reviewed advisories list no patched version. No compatible published fix was identified. Dependencies and lockfile were not changed; no overrides or advisory suppressions were added.

| Dependency | Exposure traced in this checkout | Unresolved risk |
| --- | --- | --- |
| braces 3.0.3 | micromatch 4.0.8, used by Jest and Metro file matching | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm): deeply nested input patterns can exhaust the Node stack. Treat hostile pattern/config input as a build-tool availability risk. |
| node-forge 1.4.0 | Expo CLI and @expo/code-signing-certificates 0.0.6 | [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv): malformed RSA PKCS#1 v1.5 verification input may permit signature forgery under the described key conditions. Tooling/certificate trust exposure requires review; this is not proven harmless merely because it is outside app code. |

The production bundle check now rejects either dependency appearing in Android/iOS JavaScript source-map graphs. A passing export demonstrates absence from those generated JS graphs only, not absence from every native binary, Expo service or external tool. No live backend, signing service, certificate forgery or exploit test is performed.

Interim mitigations: retain isolated secret-free synthetic builds, do not feed untrusted certificates or user-selected glob patterns into these tools, do not launch participant production services, and keep mandatory review. These reduce exposure but do not fix the libraries or automatically accept the risks. Existing PR code already executes in CI; application-level tests do not prove all tooling inputs safe.

**Integration remains blocked on explicit risk disposition.** Recommended follow-up: monitor compatible upstream patches and dependency removal options; do not fork cryptographic verification or force a major toolchain replacement merely to clear this audit. Ask the maintainer either to defer integration pending fixes or explicitly accept documented residual risk for the synthetic development baseline only. No acceptance is presumed. A separate assessment is required before participant deployment.
