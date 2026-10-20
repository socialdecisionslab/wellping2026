const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("../server.cjs");
async function withServer(fn) {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
test("local server serves restrictive CSP and refuses foreign origin/host/form requests", () =>
  withServer(async (origin) => {
    const page = await fetch(origin);
    assert.equal(page.status, 200);
    assert.match(
      page.headers.get("content-security-policy"),
      /frame-ancestors 'none'/,
    );
    assert.equal(page.headers.get("cache-control"), "no-store");
    for (const headers of [
      { Origin: "https://example.invalid" },
      { Origin: "null" },
    ])
      assert.equal((await fetch(origin, { headers })).status, 403);
    const wrongHost = await new Promise((resolve, reject) => {
      const req = require("node:http").get(
        origin,
        { headers: { host: "attacker.invalid" } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
    });
    assert.equal(wrongHost, 403);
    assert.equal(
      (await fetch(origin + "/api", { method: "POST", body: "action=create" }))
        .status,
      403,
    );
    assert.equal((await fetch(origin + "/../../package.json")).status, 403);
  }));
test("valid JSON operation works locally; bad input returns no source/error detail", () =>
  withServer(async (origin) => {
    const headers = {
      Origin: origin,
      "Content-Type": "application/json",
      "X-Wellping-Console": "1",
    };
    const response = await fetch(origin + "/api", {
      method: "POST",
      headers,
      body: JSON.stringify({
        action: "create",
        input: {
          id: "synthetic",
          contactEmail: "staff@example.invalid",
          consentFormUrl: "https://example.invalid/consent",
        },
      }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).result.studyInfo.id, "synthetic");
    const bad = await fetch(origin + "/api", {
      method: "POST",
      headers,
      body: JSON.stringify({
        action: "validate",
        study: { password: "SYNTHETIC_PRIVATE" },
      }),
    });
    assert.equal(bad.status, 400);
    assert(!JSON.stringify(await bad.json()).includes("SYNTHETIC_PRIVATE"));
  }));

test("oversized local imports are bounded and server remains usable", () =>
  withServer(async (origin) => {
    const response = await fetch(origin + "/api", {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "X-Wellping-Console": "1",
      },
      body: JSON.stringify({
        action: "validate",
        study: "x".repeat(2 * 1024 * 1024),
      }),
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 413);
    assert.equal((await fetch(origin)).status, 200);
  }));
