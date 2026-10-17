// Compile only. Never install/launch production enrollment or contact a backend.
require("./check-environment.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const output = fs.mkdtempSync(
  path.join(os.tmpdir(), "wellping-production-compile-"),
);
try {
  const result = spawnSync(
    process.execPath,
    [
      require.resolve("expo/bin/cli"),
      "export",
      "--platform",
      "all",
      "--output-dir",
      output,
      "--source-maps",
      "--no-bytecode",
      "--max-workers",
      "2",
    ],
    {
      env: {
        ...process.env,
        WELLPING_LOCAL_ONLY: "0",
        CI: "1",
        EXPO_OFFLINE: "1",
        EXPO_NO_TELEMETRY: "1",
        EXPO_NO_DOTENV: "1",
      },
      stdio: "inherit",
    },
  );
  assert.equal(
    result.status,
    0,
    "Production UI must compile for both mobile platforms",
  );
  for (const platform of ["ios", "android"]) {
    const directory = path.join(output, "_expo", "static", "js", platform);
    const sources = fs
      .readdirSync(directory)
      .filter((name) => name.endsWith(".map"))
      .flatMap(
        (name) =>
          JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"))
            .sources,
      );
    for (const source of [
      "src/RootScreen.tsx",
      "src/HomeScreen.tsx",
      "src/screens/LoginScreen.tsx",
      "src/components/SyncStatus.tsx",
    ])
      assert(
        sources.some((name) => name.endsWith(source)),
        `${platform}: missing ${source}`,
      );
    assert(
      !sources.some((name) => name.endsWith("local/LocalApp.tsx")),
      "Production graph must not substitute the synthetic entry",
    );
    for (const dependency of ["braces", "node-forge"])
      assert(
        !sources.some((name) => name.replace(/\\/g, "/").includes(`/node_modules/${dependency}/`)),
        `${platform}: ${dependency} must not enter the shipped JavaScript graph`,
      );
    console.log(
      `${platform}: production participant UI compiled; no application launch or backend calls.`,
    );
  }
} finally {
  fs.rmSync(output, { recursive: true, force: true });
}
