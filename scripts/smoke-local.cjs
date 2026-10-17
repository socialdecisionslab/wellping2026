require("./check-environment.cjs");
const assert = require("assert");
const http = require("http");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const port = Number(process.env.WELLPING_SMOKE_PORT || 19800);
const origin = `http://127.0.0.1:${port}`;
let log = "";
let exited = false;
const child = spawn(
  process.execPath,
  [
    path.join(__dirname, "start-local.cjs"),
    "--port",
    String(port),
    "--max-workers",
    "2",
  ],
  {
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  },
);
for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", (data) => {
    log = (log + data).slice(-12000);
  });
}
child.on("exit", () => {
  exited = true;
});
child.on("error", (error) => {
  log += error.message;
  exited = true;
});

function request(url, headers = {}) {
  const parsed = new URL(url);
  assert.strictEqual(
    parsed.hostname,
    "127.0.0.1",
    "Smoke checks must stay on loopback",
  );
  return new Promise((resolve, reject) => {
    const req = http.get(parsed, { headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () =>
        res.statusCode === 200
          ? resolve(body)
          : reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 500)}`)),
      );
      res.on("error", reject);
    });
    req.setTimeout(90000, () =>
      req.destroy(new Error("Local bundle request timed out")),
    );
    req.on("error", reject);
  });
}

async function main() {
  const deadline = Date.now() + 90000;
  while (!log.includes("Your native app is running")) {
    if (exited || Date.now() > deadline)
      throw new Error("Local server did not start");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  for (const platform of ["ios", "android"]) {
    const manifest = JSON.parse(
      await request(origin, {
        "Exponent-Platform": platform,
        Accept: "application/json",
      }),
    );
    assert.strictEqual(manifest.entryPoint, "./local/index.js");
    assert.strictEqual(manifest.extra.wellpingLocalOnly, true);
    assert.strictEqual(manifest.updates.enabled, false);
    assert.strictEqual(manifest.slug, "wellping-local");
    const bundle = await request(manifest.bundleUrl);
    assert(bundle.includes("synthetic local test"));
    assert(
      !bundle.includes("src/RootScreen.tsx"),
      "Production enrollment must not be in the local bundle",
    );
    console.log(
      `${platform}: isolated manifest and JavaScript bundle OK (${Buffer.byteLength(
        bundle,
      )} bytes).`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error.message + "\n" + log);
    process.exitCode = 1;
  })
  .finally(() => {
    if (!child.pid) return;
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    } else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  });
