# Pinned study schema artifact

`wellping-study-schemas-1.0.0.tgz` replaces the install-time Git build of the **same** schema source. It is a local `file:` dependency, not a new schema version.

- Source: https://github.com/wellping/study-schemas
- Commit: `61063224e77f97cc97808c40cb5ad314c3a5104f` (the previous app lockfile's commit).
- Compiler: TypeScript **4.5.4**, from the source repository's lockfile.
- Build: `tsc --project tsconfig.json --skipLibCheck`, with Zod **3.11.6** types, under Node **16.20.2**.
- Packaging: npm **8.19.4**, `npm pack --ignore-scripts`. Upstream `src`, `lib`, `tsconfig.json`, `yarn.lock`, and READMEs are included. Package metadata retains name, version, author, repository, and runtime dependencies; install/build scripts and devDependencies are omitted because consumers use the compiled files. `files` includes the source and provenance for inspection.
- SHA-256: `b03a87ee567097d033491bee7f14fe14d8c5362a7ca20c072401dbb76fcb69a5`.

The upstream Git package runs a prepare/build step when packed. The newly fetched archive did not match the historical lock checksum. A build from the exact Git source with the pinned compiler produced JavaScript byte-identical to the diagnostic archive used in the first audit. Declaration output showed property-order differences. The original historical archive was unavailable, so this does not establish why every historical byte changed. Installing a reviewed, committed artifact removes the install-time build from the dependency chain; normal Yarn checksum validation remains enabled.

To inspect the package without executing anything:

```sh
shasum -a 256 vendor/wellping-study-schemas-1.0.0.tgz
tar -tzf vendor/wellping-study-schemas-1.0.0.tgz
tar -xOf vendor/wellping-study-schemas-1.0.0.tgz package/PROVENANCE.json
```

`PROVENANCE.json` records SHA-256 hashes of all generated JavaScript files. `src/` was copied unchanged from the commit above; it includes upstream tests. No study question, schema validation rule, or response encoding was edited.

For a future schema update, review the upstream source diff, compile with its explicitly pinned compiler/dependencies, run schema and app compatibility tests, and replace the tarball/provenance/lockfile together in a dedicated PR. Do not merely accept a new checksum for a live Git build. A lab-owned immutable package registry can replace this small checked-in archive later without changing the app's schema imports.
