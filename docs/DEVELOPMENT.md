# Development

Follow [local development](local-development.md) for setup and synthetic runners. Use `.nvmrc`, Corepack and the `packageManager` field; old Yarn 3 and Expo 44 commands in historical reports are not current instructions.

Run `corepack yarn install --immutable`, then `corepack yarn lint` and `corepack yarn test:ci`. See [testing](TESTING.md) for bundles and localhost manifests. Do not fix peer warnings by forcing incompatible overrides or disabling checks.

Keep work in an isolated branch, preserve other checkouts' edits, and commit independently verified changes. Never use real participant credentials or responses in development. Backend access, signing credentials and participant deployment are not needed for local synthetic checks.

Review [architecture](architecture.md), [roadmap](ROADMAP.md) and [progress](AUTONOMOUS_PROGRESS.md) before extending persistence or recovery behavior.
