const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  validateReleaseIdentity,
} = require("../../scripts/release-manifest.cjs");
const fixture = () => ({
  pkg: {
    engines: { node: "22.23.3" },
    packageManager: "yarn@4.18.1",
    version: "1.1.3",
  },
  app: {
    expo: {
      version: "1.1.3",
      ios: { buildNumber: "33" },
      android: { versionCode: 33 },
    },
  },
  nodeVersion: "22.23.3",
  nvmrc: "22.23.3\n",
});
test("release identity rejects toolchain drift and inconsistent native versions", () => {
  assert.equal(validateReleaseIdentity(fixture()).androidBuild, 33);
  for (const mutate of [
    (f) => {
      f.app.expo.ios.buildNumber = {};
    },
    (f) => {
      f.app.expo.android.versionCode = -1;
    },
    (f) => {
      f.nodeVersion = "24.0.0";
    },
    (f) => {
      f.pkg.packageManager = "yarn@latest";
    },
    (f) => {
      f.app.expo.version = "2.0.0";
    },
    (f) => {
      f.app.expo.android.versionCode = "33";
    },
    (f) => {
      f.nvmrc = "20.0.0";
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => validateReleaseIdentity(f));
  }
});
