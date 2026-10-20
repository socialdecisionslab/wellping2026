// Source provenance only. Does not sign, build, upload, deploy, or certify release gates.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const root = path.resolve(__dirname, "..");
const hash = (data) => createHash("sha256").update(data).digest("hex");
function validateReleaseIdentity({ pkg, app, nodeVersion, nvmrc }) {
  if (nodeVersion !== pkg.engines.node || nvmrc.trim() !== nodeVersion)
    throw new Error("Pinned Node identity does not match.");
  if (!/^yarn@\d+\.\d+\.\d+$/.test(pkg.packageManager))
    throw new Error("Package manager must be exactly pinned.");
  if (
    pkg.version !== app.expo.version ||
    typeof app.expo.ios.buildNumber !== "string" ||
    !/^\d+(?:\.\d+){0,2}$/.test(app.expo.ios.buildNumber) ||
    !Number.isSafeInteger(app.expo.android.versionCode) ||
    app.expo.android.versionCode <= 0 ||
    !Number.isInteger(app.expo.android.versionCode)
  )
    throw new Error(
      "Native/application version identities are incomplete or inconsistent.",
    );
  return {
    node: nodeVersion,
    packageManager: pkg.packageManager,
    appVersion: pkg.version,
    iosBuild: app.expo.ios.buildNumber,
    androidBuild: app.expo.android.versionCode,
  };
}
function manifest() {
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  if (git("status", "--porcelain"))
    throw new Error(
      "Release provenance requires a clean checkout, including no untracked source.",
    );
  const read = (file) => fs.readFileSync(path.join(root, file));
  const identity = validateReleaseIdentity({
    pkg: JSON.parse(read("package.json")),
    app: JSON.parse(read("app.json")),
    nodeVersion: process.versions.node,
    nvmrc: read(".nvmrc").toString(),
  });
  const inputs = [
    "yarn.lock",
    "package.json",
    "app.json",
    "app.config.js",
    ".yarnrc.yml",
    "vendor/wellping-study-schemas-1.0.0.tgz",
    ...fs
      .readdirSync(path.join(root, ".github/workflows"))
      .sort()
      .map((file) => `.github/workflows/${file}`),
  ];
  return {
    format: "wellping-source-provenance",
    schemaVersion: 1,
    commit: git("rev-parse", "HEAD"),
    tree: git("rev-parse", "HEAD^{tree}"),
    ...identity,
    sha256: Object.fromEntries(inputs.map((file) => [file, hash(read(file))])),
    evidence:
      "Source provenance only. Attach exact-commit CI/native artifacts and separate device/backend release-gate evidence before approval.",
    productionReleaseApproved: false,
  };
}
if (require.main === module) {
  try {
    process.stdout.write(JSON.stringify(manifest(), null, 2) + "\n");
  } catch (_) {
    process.stderr.write(
      "Cannot produce release provenance: use the pinned toolchain and a clean, consistent checkout. No release was produced.\n",
    );
    process.exitCode = 1;
  }
}
module.exports = { validateReleaseIdentity, manifest };
