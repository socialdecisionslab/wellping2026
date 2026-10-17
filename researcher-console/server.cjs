// Local development tool only. No persistent data, authentication, or backend calls.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const core = require("./core.cjs");
const assets = new Map([
  ["/", ["index.html", "text/html"]],
  ["/app.js", ["app.js", "text/javascript"]],
  ["/style.css", ["style.css", "text/css"]],
]);
function createServer() {
  const server = http.createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    );
    const reply = (status, value) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(value));
    };
    // Reject DNS rebinding and cross-origin form/fetch requests, including Origin:null.
    if (
      req.headers.host !== origin.slice(7) ||
      (req.headers.origin && req.headers.origin !== origin)
    )
      return reply(403, {
        error: "Only this local console origin is permitted.",
      });
    if (req.method === "GET" && assets.has(req.url)) {
      const [file, type] = assets.get(req.url);
      res.setHeader("Content-Type", `${type}; charset=utf-8`);
      res.end(fs.readFileSync(path.join(__dirname, "public", file)));
      return;
    }
    if (
      req.method !== "POST" ||
      req.url !== "/api" ||
      req.headers["content-type"] !== "application/json" ||
      req.headers["x-wellping-console"] !== "1" ||
      req.headers.origin !== origin
    )
      return reply(403, { error: "Invalid local console request." });
    try {
      let bytes = 0;
      const chunks = [];
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 2 * 1024 * 1024) {
          reply(413, {
            error: "Import exceeds the 2 MiB local request limit.",
          });
          return;
        }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      let result;
      switch (body.action) {
        case "backup":
          result = core.createBackup(body.payload);
          break;
        case "restore":
          result = core.restoreBackup(body.archive);
          break;
        case "create":
          result = core.createStudy(body.input);
          break;
        case "validate":
          result = core.validateStudy(body.study);
          break;
        case "revision":
          result = core.addRevision(body.history, body.study);
          break;
        case "history":
          result = core.validateHistory(body.history);
          break;
        case "exports":
          result = core.summarizeExports(body.exports, body.studyId);
          break;
        case "schedule":
          result = core.scheduleSummary(body.study, body.timeZone);
          break;
        case "project":
          result = core.projectTimes(body.export, body.timeZone);
          break;
        default:
          return reply(400, { error: "Unsupported operation." });
      }
      reply(200, { result });
    } catch (_) {
      // Never return arbitrary parser errors, study content, responses or credentials.
      reply(400, {
        error:
          "Validation failed. Check the study schema, unique revision/session IDs, graph links and selected study. Original files were not changed.",
      });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return server;
}
if (require.main === module) {
  const port = Number(process.env.WELLPING_CONSOLE_PORT || 4317);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Choose a local port between1024 and65535.");
  createServer().listen(port, "127.0.0.1", () =>
    console.log(
      `Local synthetic-data console: http://127.0.0.1:${port}. No backend connection or persistent storage.`,
    ),
  );
}
module.exports = { createServer };
