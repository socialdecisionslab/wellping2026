# Working on WellPing

- Read `docs/AUTONOMOUS_PROGRESS.md` and `docs/ROADMAP.md` before continuing.
- Screens live in `src/`; persistence, scheduling and upload helpers in `src/helpers/`; synthetic regression tests in `src/__tests__/` and `tests/security/`.
- Use the pinned Node version in `.nvmrc` and Corepack Yarn from `package.json`. Install with `corepack yarn install --immutable`.
- Validate with `corepack yarn lint`, `corepack yarn test:ci`, `node scripts/smoke-local.cjs`, and `node scripts/check-production-bundles.cjs`.
- Preserve existing TypeScript and class-component conventions. Prefer small changes without dependencies or new persistent state.
- Use synthetic data only. Never log credentials or responses, change scientific response formats, discard retained data, or alter backend authentication contracts without authorization.
- Bind asynchronous participant work to its initiating owner. Use existing journal serialization; do not nest journal-locking APIs.
- Logout must block active or unsynced responses. Ambiguous ownership fails closed. Successful upload does not authorize deletion.
- JavaScript tests and bundles do not prove native-device or backend compatibility.
- Keep verified changes in small commits on a dedicated branch. Do not merge, deploy, force-push, or commit generated dependencies.
- The development-only dependency exception expires October 24, 2026, or earlier on exposure changes or available fixes; see the security follow-up linked in `docs/DECISIONS.md`.
