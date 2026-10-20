require("./check-environment.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "wellping-bundles-"));
const env = {
  ...process.env,
  WELLPING_LOCAL_ONLY: "1",
  CI: "1",
  EXPO_OFFLINE: "1",
  EXPO_NO_TELEMETRY: "1",
};
try {
  const { getConfig } = require("expo/config");
  process.env.WELLPING_LOCAL_ONLY = "1";
  const { exp } = getConfig(process.cwd());
  assert.equal(exp.extra.wellpingLocalOnly, true);
  assert.equal(exp.updates.enabled, false);
  assert.equal(exp.ios.bundleIdentifier, "app.wellping.local");
  assert.equal(exp.android.package, "app.wellping.local");
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
    { env, stdio: "inherit" },
  );
  assert.equal(result.status, 0, "Both mobile bundles must compile");
  for (const platform of ["ios", "android"]) {
    const directory = path.join(output, "_expo", "static", "js", platform);
    const maps = fs
      .readdirSync(directory)
      .filter((name) => name.endsWith(".map"));
    assert(maps.length > 0, `${platform}: missing source map`);
    const sources = maps.flatMap(
      (name) =>
        JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")).sources,
    );
    assert(
      sources.some((name) => name.endsWith("local/LocalApp.tsx")),
      `${platform}: local entry missing`,
    );
    assert(
      !sources.some((name) => name.endsWith("src/RootScreen.tsx")),
      `${platform}: production entry leaked`,
    );
    console.log(
      `${platform}: compiled isolated questionnaire bundle; production enrollment excluded.`,
    );
  }
} finally {
  fs.rmSync(output, { recursive: true, force: true });
}
