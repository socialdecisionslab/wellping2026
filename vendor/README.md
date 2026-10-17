# Auditable schema dependency

`wellping-study-schemas-1.0.0.tgz` is a reproducible-install artifact of the existing schema, not a schema version upgrade.

- Source: https://github.com/wellping/study-schemas
- Exact app-lockfile source commit: `4aba769f3fa05bb8d16ce70b9b4937e4749d37ae`.
- Compiler: TypeScript 4.5.4, pinned by the schema source lockfile.
- Build dependencies: Zod 3.11.6, date-fns 2.27.0, @types/node 14.18.2.
- Build: `tsc --project tsconfig.json --skipLibCheck` under Node 18.20.8.
- Packaging: `npm pack --ignore-scripts`; upstream source, generated declarations/JavaScript, README, tsconfig and `PROVENANCE.json` included. Package install/build scripts and devDependencies removed so consumers cannot rebuild it at installation. Runtime metadata/dependencies are preserved. npm excludes yarn.lock from the archive; the source lockfile remains available at the exact upstream commit above.
- SHA-256: `8bb80e26c51cbb43d070799b3736820b917b804c00e150fd0aa2796d22d4e9db`.

All 11 generated JavaScript files were compared byte-for-byte with the already installed package for this exact commit and match. Five declaration files differ in property ordering. The old historical Git-pack archive is unavailable, so this comparison does not explain every byte of the historical checksum mismatch. App typecheck and tests must pass against this artifact.

The original dependency rebuilt itself while Git was packed. Its fetched archive no longer matched the upstream lockfile checksum. Vendoring reviewed source plus generated output avoids silently accepting mutable install-time builds. Yarn integrity checking remains enabled.

PR #3 uses a different, older schema commit (`6106322`) for the Expo 44 branch. That archive must not replace this Expo 49 baseline archive.

Before changing this package, review source diffs, rebuild with explicit versions, run the schema/app compatibility tests, and update the archive, provenance and lock together. `PROVENANCE.json` records generated-file hashes for inspection. Do not refresh checksums to bypass a mismatch without investigating its cause.
