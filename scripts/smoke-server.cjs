const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const port = process.env.WELLPING_SMOKE_PORT || "19801";
const child = spawn(
  process.execPath,
  [
    path.join(__dirname, "start-local.cjs"),
    "--port",
    port,
    "--max-workers",
    "2",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let logs = "";
let exited = false;
child.stdout.on("data", (data) => {
  logs = (logs + data).slice(-8000);
});
child.stderr.on("data", (data) => {
  logs = (logs + data).slice(-8000);
});
child.on("exit", () => {
  exited = true;
});
child.on("error", (error) => {
  logs += error.message;
  exited = true;
});
const origin = `http://127.0.0.1:${port}`;
async function manifest(platform) {
  const response = await fetch(origin, {
    headers: { accept: "application/json", "expo-platform": platform },
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200);
  return response.json();
}
(async () => {
  const deadline = Date.now() + 90000;
  for (;;) {
    try {
      await manifest("ios");
      break;
    } catch (error) {
      if (exited || Date.now() > deadline)
        throw new Error(`Local server failed: ${error.message}\n${logs}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  for (const platform of ["ios", "android"]) {
    const value = await manifest(platform);
    const config = value.extra.expoClient;
    assert.equal(config.extra.wellpingLocalOnly, true);
    assert.equal(config.updates.enabled, false);
    assert.equal(config.ios.bundleIdentifier, "app.wellping.local");
    assert.equal(config.android.package, "app.wellping.local");
    assert.equal(new URL(value.launchAsset.url).origin, origin);
    console.log(
      `${platform}: local development manifest and reachable IPv4 listener OK.`,
    );
  }
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    child.kill("SIGTERM");
  });
