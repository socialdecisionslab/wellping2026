const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { createServer } = require("../server.cjs");
const { exportFixture } = require("./fixtures.cjs");
async function withUI(fn) {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const dom = new JSDOM(
    fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8"),
    { url: origin, runScripts: "outside-only" },
  );
  const w = dom.window;
  const downloads = [];
  w.fetch = (url, options) =>
    fetch(new URL(url, origin), {
      ...options,
      headers: { ...options.headers, Origin: origin },
    });
  w.Blob = class {
    constructor(parts, options) {
      this.parts = parts;
      this.type = options.type;
    }
  };
  w.URL.createObjectURL = (blob) => {
    downloads.push(blob);
    return "blob:synthetic";
  };
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = () => {};
  w.eval(fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8"));
  const el = (id) => w.document.getElementById(id);
  const importFiles = async (id, values) => {
    Object.defineProperty(el(id), "files", {
      configurable: true,
      value: values.map((value) => ({
        text: async () =>
          typeof value === "string" ? value : JSON.stringify(value),
      })),
    });
    await el(id).onchange();
  };
  try {
    await fn({ w, el, downloads, importFiles });
  } finally {
    w.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
test("browser DOM flow creates two immutable revisions and exports/restores history safely", () =>
  withUI(async ({ w, el, downloads, importFiles }) => {
    await el("create").onclick();
    assert.match(el("editor").value, /synthetic_study/);
    await el("revision").onclick();
    const first = JSON.parse(el("editor").value);
    first.studyInfo.version = "2";
    first.streams.main.example.question = "Updated synthetic question";
    el("editor").value = JSON.stringify(first);
    await el("revision").onclick();
    assert.match(el("history-summary").textContent, /2 immutable revisions/);
    await el("download-history").onclick();
    const archive = JSON.parse(downloads.at(-1).parts[0]);
    assert.equal(archive.revisions[0].study.studyInfo.version, "1");
    assert.equal(archive.revisions[1].study.studyInfo.version, "2");
    await importFiles("history-file", [archive]);
    assert.match(el("status").textContent, /Existing revisions were preserved/);
    await el("schedule").onclick();
    assert.match(el("schedule-output").textContent, /Participant-device local/);
    assert.equal(w.localStorage.length, 0);
  }));
test("import UI prevents markup execution and CSV formula injection; invalid replacement preserves counts", () =>
  withUI(async ({ w, el, downloads, importFiles }) => {
    await el("create").onclick();
    const sample = exportFixture();
    sample.participant.username = '=HYPERLINK("https://example.invalid")';
    sample.participant.sessionId = "<img src=x onerror=alert(1)>";
    await importFiles("response-files", [sample]);
    assert.match(el("totals").textContent, /1 sessions/);
    assert.equal(w.document.querySelectorAll("img").length, 0);
    assert.match(el("sessions").textContent, /<img/);
    await el("download-summary").onclick();
    assert.match(downloads.at(-1).parts[0], /"'=HYPERLINK/);
    assert(!downloads.at(-1).parts[0].includes("你好"));
    await el("download-responses").onclick();
    const bundle = JSON.parse(downloads.at(-1).parts[0]);
    assert.deepEqual(bundle.exports, [sample]);
    await importFiles("response-files", [{ password: "synthetic_private" }]);
    assert.match(el("status").textContent, /could not be completed/);
    assert.match(el("totals").textContent, /1 sessions/);
    assert(!el("status").textContent.includes("synthetic_private"));
    await el("project").onclick();
    assert.match(el("times-output").textContent, /originalTzOffset/);
    await importFiles("response-files", [sample]);
    assert.equal(el("times-output").textContent, "No imported timestamps.");
    el("clear-responses").onclick();
    assert.equal(el("download-responses").disabled, true);
    assert.equal(el("sessions").children.length, 0);
  }));
test("fresh tab restores validated history and a failed validation leaves editor untouched", () =>
  withUI(async ({ el, importFiles }) => {
    const core = require("../core.cjs"),
      { fresh, history } = require("./fixtures.cjs");
    const archive = core.addRevision(history(), fresh());
    await importFiles("history-file", [archive]);
    assert.match(el("history-summary").textContent, /1 immutable revisions/);
    const original = el("editor").value;
    await importFiles("study-file", ["not JSON"]);
    assert.equal(el("editor").value, original);
    assert.match(el("status").textContent, /Original files were not changed/);
  }));

test("concurrent revision actions cannot overwrite an accepted revision", () =>
  withUI(async ({ w, el, downloads }) => {
    await el("create").onclick();
    const originalFetch = w.fetch;
    let release;
    w.fetch = async (url, options) => {
      if (JSON.parse(options.body).action === "revision")
        await new Promise((resolve) => {
          release = resolve;
        });
      return originalFetch(url, options);
    };
    const saving = el("revision").onclick();
    assert.equal(el("editor").disabled, true);
    await el("revision").onclick();
    assert.match(el("status").textContent, /Please wait/);
    release();
    await saving;
    assert.match(el("history-summary").textContent, /1 immutable revisions/);
    await el("download-history").onclick();
    assert.equal(JSON.parse(downloads.at(-1).parts[0]).revisions.length, 1);
  }));
test("clear fences pending imports and timestamp projections", () =>
  withUI(async ({ w, el, importFiles }) => {
    await el("create").onclick();
    const originalFetch = w.fetch;
    let release, started;
    let announced = new Promise((resolve) => {
      started = resolve;
    });
    w.fetch = async (url, options) => {
      if (JSON.parse(options.body).action === "exports") {
        started();
        await new Promise((resolve) => {
          release = resolve;
        });
      }
      return originalFetch(url, options);
    };
    const importing = importFiles("response-files", [exportFixture()]);
    await announced;
    el("clear-responses").onclick();
    release();
    await importing;
    assert.equal(el("sessions").children.length, 0);
    assert.equal(el("download-responses").disabled, true);
    w.fetch = originalFetch;
    await importFiles("response-files", [exportFixture()]);
    announced = new Promise((resolve) => {
      started = resolve;
    });
    w.fetch = async (url, options) => {
      if (JSON.parse(options.body).action === "project") {
        started();
        await new Promise((resolve) => {
          release = resolve;
        });
      }
      return originalFetch(url, options);
    };
    const projecting = el("project").onclick();
    await announced;
    el("clear-responses").onclick();
    release();
    await projecting;
    assert.equal(el("times-output").textContent, "No imported timestamps.");
  }));
