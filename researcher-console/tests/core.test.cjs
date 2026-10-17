const { test } = require("node:test");
const assert = require("node:assert/strict");
const core = require("../core.cjs");
const { fresh, history, exportFixture } = require("./fixtures.cjs");
test("starter uses actual app schema and preserves source time strings", () => {
  const study = fresh();
  assert.equal(
    core.validateStudy(study).studyInfo.pingsFrequency[0]
      .earliestPingNotificationTime,
    "09:00:00",
  );
  assert.deepEqual(study.studyInfo.server, {});
});
test("graph, HTTPS and duplicate revision validation preserves originals", () => {
  const study = fresh(),
    original = JSON.stringify(study);
  let archive = core.addRevision(history(), study, "2026-10-17T12:00:00.000Z");
  assert.throws(() => core.addRevision(archive, study));
  assert.equal(JSON.stringify(study), original);
  const broken = structuredClone(study);
  broken.streams.main.example.next = "missing";
  assert.throws(() => core.validateStudy(broken));
  broken.streams.main.example.next = null;
  broken.studyInfo.studyFileURL = "http://example.invalid";
  assert.throws(() => core.validateStudy(broken));
  study.studyInfo.version = "2";
  archive = core.addRevision(archive, study);
  assert.equal(archive.revisions[0].study.studyInfo.version, "1");
  assert.equal(archive.revisions.length, 2);
});
test("history detects tampering and mixed-study versions", () => {
  const archive = core.addRevision(history(), fresh());
  const altered = structuredClone(archive);
  altered.revisions[0].study.streams.main.example.question = "changed";
  assert.throws(() => core.validateHistory(altered));
  const other = fresh();
  other.studyInfo.id = "other";
  other.studyInfo.version = "2";
  assert.throws(() => core.addRevision(archive, other));
  assert.deepEqual(
    core.validateHistory(JSON.parse(JSON.stringify(archive))),
    archive,
  );
});
test("exports preserve coding, Unicode, incomplete records, dates and offsets exactly", () => {
  const data = exportFixture();
  const result = core.summarizeExports(
    [JSON.stringify(data)],
    "synthetic_study",
  );
  assert.deepEqual(result.exports, [data]);
  assert.equal(result.totals.incomplete, 1);
  assert.equal(result.totals.completed, 0);
  assert.match(result.sessions[0].notificationDelivery, /unknown/);
  assert.match(result.sessions[0].uploadDelivery, /unknown/);
});
test("wrong study, duplicate session, duplicate answers and lossy unknown fields reject", () => {
  const data = exportFixture();
  assert.throws(() => core.summarizeExports([data], "wrong"));
  assert.throws(() => core.summarizeExports([data, data], "synthetic_study"));
  const duplicate = structuredClone(data);
  duplicate.answers.push(duplicate.answers[0]);
  assert.throws(() => core.summarizeExports([duplicate], "synthetic_study"));
  data.answers[0].privateUnrecognizedField = "must not silently discard";
  assert.throws(() => core.summarizeExports([data], "synthetic_study"));
  assert.equal(
    data.answers[0].privateUnrecognizedField,
    "must not silently discard",
  );
});
test("time-zone projection distinguishes DST repeat instants without changing source", () => {
  const data = exportFixture();
  const second = structuredClone(data.pings[0]);
  second.id = "main2";
  second.notificationTime = "2026-11-01T06:30:00.000Z";
  second.tzOffset = 300;
  data.pings.push(second);
  const before = JSON.stringify(data);
  const result = core.projectTimes(data, "America/New_York");
  assert.notEqual(result[0].notification, result[1].notification);
  assert.equal(result[0].originalTzOffset, 240);
  assert.equal(result[1].originalTzOffset, 300);
  assert.equal(JSON.stringify(data), before);
  assert.throws(() => core.projectTimes(data, "Not/AZone"));
});
test("schedule explicitly reflects participant-local rather than fixed-zone deployment", () => {
  const result = core.scheduleSummary(fresh(), "Asia/Tokyo");
  assert.match(result.semantics, /Participant-device local/);
  assert.match(result.semantics, /not a deployed fixed-zone/);
  assert.equal(result.windows[0].earliestPingNotificationTime, "09:00:00");
});

test("special-case and repeated-item destinations are validated", () => {
  const study = fresh();
  study.streams.main.example = {
    id: "example",
    type: "ChoicesWithSingleAnswer",
    question: "synthetic",
    choices: ["yes"],
    next: null,
    specialCasesStartId: [["yes", "missing"]],
  };
  assert.throws(() => core.validateStudy(study));
  study.streams.main.example = {
    id: "example",
    type: "MultipleText",
    indexName: "index",
    variableName: "item",
    question: "synthetic",
    next: null,
    max: 3,
    repeatedItemStartId: "missing",
  };
  assert.throws(() => core.validateStudy(study), /missing next\/branch/);
});

test("conditional/default-value and reusable-choice references must exist", () => {
  const study = fresh();
  study.streams.main.example = {
    id: "example",
    type: "Branch",
    question: "synthetic",
    next: null,
    condition: {
      questionId: "missing",
      questionType: "MultipleText",
      compare: "equal",
      target: 1,
    },
    branchStartId: { true: null },
  };
  assert.throws(() => core.validateStudy(study));
  study.streams.main.example = {
    id: "example",
    type: "Slider",
    question: "synthetic",
    next: null,
    slider: ["low", "high"],
    defaultValueFromQuestionId: "missing",
  };
  assert.throws(() => core.validateStudy(study));
  study.streams.main.example = {
    id: "example",
    type: "ChoicesWithSingleAnswer",
    question: "synthetic",
    next: null,
    choices: "missing",
  };
  assert.throws(() => core.validateStudy(study));
});

test("relative comparison answer keys must exist", () => {
  const study = fresh();
  study.streams.main.example = {
    id: "example",
    type: "BranchWithRelativeComparison",
    question: "synthetic",
    next: null,
    branchStartId: { missing: null },
  };
  assert.throws(() => core.validateStudy(study), /missing next\/branch/);
});
