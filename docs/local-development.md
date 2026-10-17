# Reproducible local development

This is a reproducible **legacy Expo 44 development baseline**, not a production release upgrade. Node 16 and Expo CLI 5 are old toolchains retained here to avoid changing survey behavior during setup repair. Use synthetic data only, keep the server on localhost, and modernize Expo/React Native in a separate change before a new release.

## Install and verify

Requirements: Node **16.20.2** (`.nvmrc`), Git, and registry access for the first install. Yarn **3.1.1** is checked into the repository; no global Yarn, Expo CLI, EAS CLI, login, signing credentials, or research backend is needed. With nvm already installed:

```sh
nvm install
nvm use
node scripts/check-environment.cjs
node .yarn/releases/yarn-3.1.1.cjs install --immutable
node .yarn/releases/yarn-3.1.1.cjs test:ci
node .yarn/releases/yarn-3.1.1.cjs smoke:local
```

Yarn metadata and caches stay inside ignored `.yarn/` directories by default. Use these commands instead of `npm install` or a global Expo CLI. The checked-in Yarn can also be called as `yarn` when your package-manager shim honors `packageManager` in `package.json`.

`test:ci` runs the TypeScript check and Jest serially with Watchman disabled. `smoke:local` starts a temporary local server on port 19800, checks its isolated manifest, compiles iOS and Android JavaScript bundles, and shuts down that server and its child processes. It does not run an emulator or publish a build. Set `WELLPING_SMOKE_PORT` to another free port if necessary.

The schema is now a checked-in artifact built from the original locked Git commit; see [artifact provenance](../vendor/README.md). Do **not** set `YARN_CHECKSUM_BEHAVIOR=update` or disable immutable installs. `.yarnrc.yml` disables dependency lifecycle scripts: this JS workflow does not need sqlite3 compilation, native filesystem-watch builds, or install-time downloads. Native build requirements must be reviewed separately when modernizing the app.

## Run the synthetic survey

```sh
node .yarn/releases/yarn-3.1.1.cjs start:local
```

The server prints its local address, normally `exp://127.0.0.1:19000`. Keep the terminal running; Ctrl+C stops it. This portable runner uses Metro's CI/no-watch mode, so **restart the server after editing files**. It needs no Watchman. CLI state is stored in ignored `.expo/local-cli`, and telemetry/account checks are disabled.

The screen says **“Well Ping — synthetic local test”**. It exercises the app's actual survey renderer and persistence with two artificial questions. Answer, finish, reopen, or start another test survey. Completion explicitly says the data stayed on the test device. Reload after reaching the second question to check resume behavior. The initial question is also saved before the screen mounts.

The local entry does not render enrollment, consent links, dashboards, scheduling, or upload flows. Its fixture has no backend, external images, or dashboard, and its unused schema-required URLs point to `example.invalid`. Application `fetch` calls are rejected. AsyncStorage study/index/installation keys and SecureStore keys have separate local prefixes; the test harness verifies that synthetic sentinels in normal-app keys remain unchanged. App slug and native identifiers differ from production, OTA updates are disabled, and production deep-link registrations are removed in this mode.

`yarn start`, `yarn ios`, and `yarn android` retain the normal app entry. They are **not** the isolated synthetic workflow. An ordinary development build can still use a real backend if given real configuration. Do not use participant login codes or a participant's device for local testing.

## Viewing on a native client

This application is native iOS/Android; the localhost URL is not a browser-based survey. You need a client compatible with **Expo SDK 44**:

- With a compatible iOS simulator installed, start the local runner with `--ios`. This machine currently has only Xcode Command Line Tools, so a simulator could not be launched here.
- With an Android emulator and compatible client installed, use `--android`. For a dedicated Android test device connected through USB, localhost access requires forwarding the Expo ports with Android tooling (normally 19000 and 19001), then opening the printed `exp://` URL.
- Current Expo Go does not generally support this old SDK. Consult [Expo's version-specific clients](https://expo.dev/go) and [upgrade guidance](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/). Availability varies by platform; do not assume a current iPhone can run SDK 44. If no compatible client is available, complete an incremental SDK migration or an explicitly authorized isolated development build before device testing.

Bundling and mocked renderer tests are useful checks, but do not establish SecureStore durability on a real device, notification delivery, or native compatibility. The synthetic runner intentionally does not test actual delivery or backend uploads. No native screenshots are available from this setup.

## What was verified

On macOS arm64, using the pinned runtime:

- A fresh copy with **empty dependency/global caches** passed `install --immutable` with standard checksum enforcement; the lockfile SHA-256 was unchanged.
- TypeScript, **254 tests in 15 suites**, and **282 snapshots** passed; local-runner tests cover completion, saved responses after reopening, unfinished-survey resume, separate storage, and no fetch/notification scheduling.
- Both platform manifests identify `local/index.js`, local mode, and disabled updates. iOS and Android JavaScript bundles compiled successfully.
- Existing app dependency resolutions were compared against the starting lockfile and remained unchanged. The larger lockfile diff is predominantly the project-local legacy Expo CLI and its dependencies, plus the schema source replacement.

CI now selects the pinned Node version, enforces the lockfile, runs the tests, and runs the same bundle smoke check. Hosted CI and device validation should be checked on the PR; the local results above do not claim a native release build.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| `QO.isDate is not a function` or newer-Node CLI warning | Run `node scripts/check-environment.cjs`; select `.nvmrc`'s Node version. Do not upgrade dependencies merely to bypass this error. |
| Missing node_modules state file | Run the immutable install from the project root using the pinned Node and checked-in Yarn. |
| Unwritable package-manager cache in an isolated environment | Set `YARN_GLOBAL_FOLDER` to a writable temporary directory. For an independent cold-cache check, also set `YARN_CACHE_FOLDER` to an empty temporary directory. |
| `EMFILE: too many open files, watch` | Use `start:local`, which disables Metro watchers. Do not run the legacy global CLI directly. |
| Server cannot bind a port | Allow localhost binding in the development sandbox and choose a free `--port`. The smoke command uses `WELLPING_SMOKE_PORT`. |
| Offline manifest icon/schema warning | The legacy CLI may report an unavailable cached Expo schema/icon refresh. This is separate from the app bundle; confirm the manifest entry/flags and bundle checks succeed. |

Next priorities remain durable answer/navigation ordering and idempotent uploads, followed by an incremental SDK migration. Do not merge or release solely because JavaScript tests and bundling succeed.
