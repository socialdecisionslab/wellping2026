#!/usr/bin/env node
// Compare a synthetic expected session with the backend's normalized analyst export.
const fs = require("node:fs");
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
const equal = (a, b) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function index(records, key) {
  if (!Array.isArray(records))
    throw Error("Export must contain pings and answers arrays.");
  const result = new Map();
  for (const record of records) {
    const id = key(record);
    if (!id || result.has(id))
      throw Error("Missing or duplicate logical record identifier.");
    result.set(id, record);
  }
  return result;
}
function reconcile(expected, exported) {
  if (
    !expected.studyId ||
    !expected.user?.username ||
    !expected.user?.loginSessionId ||
    !expected.revisions
  )
    throw Error("Expected session metadata is incomplete.");
  if (
    !equal(
      [expected.studyId, expected.user.username, expected.user.loginSessionId],
      [
        exported.studyId,
        exported.user?.username,
        exported.user?.loginSessionId,
      ],
    )
  )
    throw Error("Export belongs to a different study or session.");
  const pingsKey = (p) => (typeof p.id === "string" && p.id ? p.id : null);
  const answerKey = (a) =>
    typeof a.pingId === "string" &&
    a.pingId &&
    typeof a.questionId === "string" &&
    a.questionId
      ? JSON.stringify([a.pingId, a.questionId])
      : null;
  const counts = {};
  for (const [name, key] of [
    ["pings", pingsKey],
    ["answers", answerKey],
  ]) {
    const wanted = index(expected[name], key),
      actual = index(exported[name], key);
    if (
      wanted.size !== actual.size ||
      [...wanted].some(([id, record]) => !equal(record, actual.get(id)))
    )
      throw Error(`Export ${name} do not exactly match expected records.`);
    counts[name] = wanted.size;
  }
  const pingIds = new Set(expected.pings.map((p) => p.id));
  if (
    expected.answers.some((a) => !pingIds.has(a.pingId)) ||
    Object.keys(expected.revisions).some((id) => !pingIds.has(id))
  )
    throw Error("Expected records contain orphan answers or revisions.");
  for (const p of expected.pings) {
    if (
      !expected.revisions[p.id]?.studyVersion ||
      !Number.isSafeInteger(expected.revisions[p.id]?.revision) ||
      expected.revisions[p.id].revision < 1
    )
      throw Error("Expected study version/revision is missing.");
  }
  if (!equal(expected.revisions, exported.revisions))
    throw Error("Export study versions/revisions do not match.");
  return counts;
}
module.exports = { reconcile };
if (require.main === module) {
  try {
    const [, , expected, exported] = process.argv;
    if (!expected || !exported || process.argv.length !== 4)
      throw Error(
        "Usage: node scripts/reconcile-export.cjs expected.json exported.json",
      );
    const counts = reconcile(
      JSON.parse(fs.readFileSync(expected, "utf8")),
      JSON.parse(fs.readFileSync(exported, "utf8")),
    );
    console.log(
      `PASS: ${counts.pings} pings and ${counts.answers} answers match exactly, including study versions.`,
    );
  } catch (error) {
    // No record contents, credentials, or file contents in diagnostics.
    console.error(
      error instanceof SyntaxError
        ? "Invalid JSON input."
        : error.code
        ? "Unable to read input files."
        : error.message,
    );
    process.exitCode = 1;
  }
}
