const { reconcile } = require("../../../scripts/reconcile-export.cjs");
const expected = {
  studyId: "synthetic",
  user: { username: "synthetic", loginSessionId: "session" },
  pings: [
    {
      id: "p1",
      startTime: "2026-11-01T12:00:00Z",
      endTime: "2026-11-01T12:01:00Z",
    },
  ],
  answers: [
    {
      pingId: "p1",
      questionId: "q1",
      data: { value: "synthetic answer" },
      date: "2026-11-01T12:00:30Z",
    },
  ],
  revisions: { p1: { revision: 2, studyVersion: "pilot-1" } },
};
test("exact export matches despite object-key ordering", () => {
  expect(reconcile(expected, JSON.parse(JSON.stringify(expected)))).toEqual({
    pings: 1,
    answers: 1,
  });
});
test.each([
  { ...expected, answers: [] },
  { ...expected, answers: [...expected.answers, ...expected.answers] },
  {
    ...expected,
    answers: [{ ...expected.answers[0], data: { value: "wrong" } }],
  },
  { ...expected, revisions: { p1: { revision: 2, studyVersion: "wrong" } } },
  { ...expected, user: { ...expected.user, loginSessionId: "other" } },
])(
  "missing, duplicate, changed, or wrong-session records fail reconciliation",
  (candidate) => {
    expect(() => reconcile(expected, candidate)).toThrow();
  },
);
