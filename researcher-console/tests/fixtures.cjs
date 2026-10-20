const core = require("../core.cjs");
const fresh = () =>
  core.createStudy({
    id: "synthetic_study",
    version: "1",
    contactEmail: "staff@example.invalid",
    consentFormUrl: "https://example.invalid/consent",
  });
const history = () => ({
  format: "wellping-study-history",
  schemaVersion: 1,
  revisions: [],
});
const exportFixture = () => ({
  schemaVersion: 1,
  studyId: "synthetic_study",
  participant: { username: "synthetic", sessionId: "session1" },
  pings: [
    {
      id: "main1",
      streamName: "main",
      notificationTime: "2026-11-01T05:30:00.000Z",
      startTime: "2026-11-01T05:31:00.000Z",
      endTime: null,
      tzOffset: 240,
    },
  ],
  answers: [
    {
      pingId: "main1",
      questionId: "example",
      data: {
        value: [
          ["你好", true],
          ["second", false],
        ],
      },
      preferNotToAnswer: null,
      date: "2026-11-01T05:32:00.000Z",
    },
  ],
});
module.exports = { fresh, history, exportFixture };
