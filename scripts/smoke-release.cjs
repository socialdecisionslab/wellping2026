// Compile the participant app graph with synthetic, non-routable release config.
// This does not build/sign a native app, contact Beiwe, or approve a real contract.
require("./check-environment.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const output = fs.mkdtempSync(
  path.join(os.tmpdir(), "wellping-release-bundles-"),
);
Object.assign(process.env, {
  WELLPING_LOCAL_ONLY: "0",
  WELLPING_RELEASE_ENV: "staging",
  WELLPING_BACKEND_PROTOCOL: "wellping-v1",
  WELLPING_BACKEND_CONTRACT_APPROVED: "1",
  WELLPING_STUDY_URL: "https://study.invalid/config",
  WELLPING_BEIWE_URL: "https://beiwe.invalid",
  WELLPING_SUPPORT_EMAIL: "support@study.invalid",
  WELLPING_EAS_PROJECT_ID: "00000000-0000-4000-8000-000000000000",
  WELLPING_EXPO_OWNER: "synthetic-lab",
  WELLPING_EXPO_SLUG: "synthetic-study",
  WELLPING_IOS_BUNDLE_ID: "edu.synthetic.wellping",
  WELLPING_ANDROID_PACKAGE: "edu.synthetic.wellping",
  CI: "1",
  EXPO_OFFLINE: "1",
  EXPO_NO_TELEMETRY: "1",
});
try {
  const { exp } = require("expo/config").getConfig(process.cwd());
  assert.equal(exp.updates.enabled, false);
  assert.equal(exp.extra.wellpingRelease.protocol, "wellping-v1");
  assert.equal(exp.ios.bundleIdentifier, "edu.synthetic.wellping.staging");
  assert.equal(exp.android.package, "edu.synthetic.wellping.staging");
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
    { env: process.env, stdio: "inherit" },
  );
  assert.equal(result.status, 0, "Participant bundles must compile");
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
    assert(sources.some((name) => name.endsWith("src/RootScreen.tsx")));
    assert(sources.some((name) => name.endsWith("src/helpers/beiweV1.ts")));
    assert(!sources.some((name) => name.endsWith("local/LocalApp.tsx")));
    console.log(
      `${platform}: participant graph compiled with synthetic staging configuration.`,
    );
  }
} finally {
  fs.rmSync(output, { recursive: true, force: true });
}
