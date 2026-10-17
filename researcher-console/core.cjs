const { createHash } = require("node:crypto");
global.__WELLPING_SHOULD_USE_STRICT_SCHEMA__ = true;
const {
  StudyFileSchema,
} = require("@wellping/study-schemas/lib/schemas/StudyFile");
const {
  parseResearchExport,
  serializeResearchExport,
} = require("../.research-console-build/researchExport.cjs");
const {
  getHttpsOrigin,
  assertSafeDashboardTemplate,
} = require("../.research-console-build/networkSafety.cjs");
const days = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];
const clone = (value) => JSON.parse(JSON.stringify(value));
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const digest = (value) =>
  createHash("sha256").update(canonical(value)).digest("hex");
function fail(message) {
  throw new Error(message);
}
function validateStudy(input) {
  let parsed;
  try {
    parsed = StudyFileSchema.parse(input);
  } catch (_) {
    fail(
      "Study does not match the app schema. Original input was not changed.",
    );
  }
  const raw = clone(input);
  const info = parsed.studyInfo;
  getHttpsOrigin(info.studyFileURL);
  getHttpsOrigin(info.consentFormUrl);
  if (info.server.beiwe) getHttpsOrigin(info.server.beiwe.serverUrl);
  if (info.dashboardURL) assertSafeDashboardTemplate(info.dashboardURL);
  if (!info.version || !info.version.trim())
    fail("Each questionnaire revision needs a nonempty version.");
  for (const [stream, questions] of Object.entries(parsed.streams)) {
    if (
      !own(info.streamsStartingQuestionIds, stream) ||
      !own(questions, info.streamsStartingQuestionIds[stream])
    )
      fail("Each stream needs a valid starting question.");
    for (const [id, question] of Object.entries(questions)) {
      if (question.id !== id) fail("Question keys must match their IDs.");
      for (const next of [
        question.next,
        question.innerNext,
        question.repeatedItemStartId,
        question.maxMinus,
        question.defaultValueFromQuestionId,
        question.condition?.questionId,
        ...(question.specialCasesStartId || []).map((pair) => pair[1]),
        ...Object.values(question.branchStartId || {}),
        ...(question.type === "BranchWithRelativeComparison"
          ? Object.keys(question.branchStartId || {})
          : []),
        ...Object.values(question.fallbackNext || {}),
      ]) {
        if (next !== undefined && next !== null && !own(questions, next))
          fail("A question references a missing next/branch question.");
      }
      for (const choices of [
        question.choices,
        question.dropdownChoices?.choices,
      ]) {
        if (
          typeof choices === "string" &&
          !own(parsed.extraData.reusableChoices || {}, choices)
        )
          fail("A question references missing reusable choices.");
      }
      for (const followup of Object.values(question.addFollowupStream || {}))
        if (!own(parsed.streams, followup))
          fail("A follow-up references a missing stream.");
    }
  }
  for (const name of [
    ...Object.values(info.streamsOrder).flat(),
    ...Object.values(info.streamsForNthPings || {}),
    info.streamInCaseOfError,
    ...Object.keys(info.streamsStartingQuestionIds),
  ])
    if (!own(parsed.streams, name))
      fail("Schedule references a missing stream.");
  return raw; // Preserve exact source fields and coding, never return transformed seconds.
}
function createStudy({ id, version = "1", contactEmail, consentFormUrl }) {
  return validateStudy({
    studyInfo: {
      id,
      version,
      studyFileURL: "https://example.invalid/study.json",
      consentFormUrl,
      contactEmail,
      server: {},
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: "2030-01-01T00:00:00.000Z",
      weekStartsOn: 1,
      pingsFrequency: [
        {
          earliestPingNotificationTime: "09:00:00",
          latestPingNotificationTime: "10:00:00",
          expireAfterTime: "02:00:00",
        },
      ],
      streamsStartingQuestionIds: { main: "example" },
      streamsOrder: Object.fromEntries(days.map((day) => [day, ["main"]])),
      streamInCaseOfError: "main",
      streamsNotReplacedByFollowupStream: [],
      notificationContent: {
        default: { title: "Study reminder", body: "A survey is available." },
      },
    },
    streams: {
      main: {
        example: {
          id: "example",
          type: "YesNo",
          question: "Example question. Replace before use.",
          next: null,
        },
      },
    },
    extraData: {},
  });
}
function validateHistory(history) {
  if (
    !history ||
    history.format !== "wellping-study-history" ||
    history.schemaVersion !== 1 ||
    !Array.isArray(history.revisions) ||
    history.revisions.length > 100
  )
    fail("Invalid study history archive.");
  const versions = new Set();
  let studyId;
  for (const revision of history.revisions) {
    const study = validateStudy(revision.study);
    if (
      !Number.isFinite(Date.parse(revision.createdAt)) ||
      revision.sha256 !== digest(study)
    )
      fail("History integrity check failed. Source archive preserved.");
    if (studyId !== undefined && studyId !== study.studyInfo.id)
      fail("History contains more than one study.");
    studyId = study.studyInfo.id;
    if (versions.has(study.studyInfo.version))
      fail("Study versions must be unique and immutable.");
    versions.add(study.studyInfo.version);
  }
  return clone(history);
}
function addRevision(history, candidate, createdAt = new Date().toISOString()) {
  const result = validateHistory(history);
  const study = validateStudy(candidate);
  result.revisions.push({ createdAt, sha256: digest(study), study });
  return validateHistory(result);
}
function requireSameKeys(source, validated) {
  if (source && typeof source === "object") {
    if (
      !validated ||
      typeof validated !== "object" ||
      canonical(Object.keys(source).sort()) !==
        canonical(Object.keys(validated).sort())
    )
      fail("Unsupported export fields would be lost. Source preserved.");
    for (const key of Object.keys(source))
      requireSameKeys(source[key], validated[key]);
  }
}
function summarizeExports(rawFiles, expectedStudyId) {
  if (!Array.isArray(rawFiles) || rawFiles.length > 100)
    fail("Import up to 100 session exports at a time.");
  const identities = new Set();
  const sessions = [];
  const exports = [];
  for (const raw of rawFiles) {
    const source = typeof raw === "string" ? JSON.parse(raw) : clone(raw);
    const parsed = parseResearchExport(JSON.stringify(source));
    requireSameKeys(source, JSON.parse(serializeResearchExport(parsed)));
    if (parsed.studyId !== expectedStudyId)
      fail("Export belongs to a different study.");
    const identity = JSON.stringify([
      parsed.participant.username,
      parsed.participant.sessionId,
    ]);
    if (identities.has(identity))
      fail(
        "Duplicate participant session. Clear imported files before loading a replacement.",
      );
    identities.add(identity);
    sessions.push({
      participant: parsed.participant.username,
      sessionId: parsed.participant.sessionId,
      total: parsed.pings.length,
      completed: parsed.pings.filter((p) => p.endTime !== null).length,
      incomplete: parsed.pings.filter((p) => p.endTime === null).length,
      answers: parsed.answers.length,
      notificationDelivery: "unknown: not present in response export",
      uploadDelivery: "unknown: import is not a backend receipt",
    });
    exports.push(source);
  }
  return {
    studyId: expectedStudyId,
    sessions,
    exports,
    totals: {
      sessions: sessions.length,
      completed: sessions.reduce((n, s) => n + s.completed, 0),
      incomplete: sessions.reduce((n, s) => n + s.incomplete, 0),
      answers: sessions.reduce((n, s) => n + s.answers, 0),
    },
  };
}
// Viewer projection only: timestamps already in exports are absolute instants.
// Study schedules remain participant-device local; this does not rewrite them.
function projectTimes(raw, timeZone) {
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      dateStyle: "medium",
      timeStyle: "long",
    });
    formatter.format(new Date());
  } catch (_) {
    fail("Choose a valid IANA time zone.");
  }
  const data = parseResearchExport(
    typeof raw === "string" ? raw : JSON.stringify(raw),
  );
  return data.pings.map((ping) => ({
    id: ping.id,
    notification: formatter.format(ping.notificationTime),
    started: formatter.format(ping.startTime),
    completed: ping.endTime ? formatter.format(ping.endTime) : null,
    originalTzOffset: ping.tzOffset,
  }));
}
function scheduleSummary(study, timeZone) {
  const raw = validateStudy(study);
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(new Date());
  } catch (_) {
    fail("Choose a valid IANA time zone.");
  }
  return {
    timeZone,
    semantics:
      "Participant-device local scheduling. Selected zone is a review label, not a deployed fixed-zone schedule. Start/end date strings are interpreted as local wall time by the mobile app, despite their Z suffix. Random windows, DST and travel require device verification.",
    windows: raw.studyInfo.pingsFrequency,
    days: raw.studyInfo.streamsOrder,
    studyStartsAt: raw.studyInfo.startDate,
    studyEndsAt: raw.studyInfo.endDate,
  };
}
module.exports = {
  validateStudy,
  createStudy,
  validateHistory,
  addRevision,
  summarizeExports,
  projectTimes,
  scheduleSummary,
  digest,
};
