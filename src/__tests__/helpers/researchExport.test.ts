import {
  parseResearchExport,
  serializeResearchExport,
  ResearchExport,
} from "../../helpers/researchExport";
const date = new Date("2026-10-01T09:30:00.000Z");
const fixture: ResearchExport = {
  schemaVersion: 1,
  studyId: "synthetic",
  participant: { username: "synthetic", sessionId: "synthetic-session" },
  pings: [
    {
      id: "daily1",
      streamName: "daily",
      notificationTime: date,
      startTime: date,
      endTime: null,
      tzOffset: -330,
    },
  ],
  answers: [
    {
      pingId: "daily1",
      questionId: "mood",
      preferNotToAnswer: null,
      data: { value: ["你好 🌿", "line\nbreak"] },
      date,
    },
  ],
};
test("export round-trips Unicode, interrupted records, answer order and dates", () => {
  expect(parseResearchExport(serializeResearchExport(fixture))).toEqual(
    fixture,
  );
});
test("answerless and prefer-not-to-answer observations are retained", () => {
  expect(
    parseResearchExport(serializeResearchExport({ ...fixture, answers: [] }))
      .pings,
  ).toHaveLength(1);
  const pna = {
    ...fixture,
    answers: [
      { ...fixture.answers[0], data: null, preferNotToAnswer: true as const },
    ],
  };
  expect(parseResearchExport(serializeResearchExport(pna))).toEqual(pna);
});
test("duplicate identities and orphan answers fail without exposing responses", () => {
  expect(() =>
    serializeResearchExport({
      ...fixture,
      pings: [...fixture.pings, ...fixture.pings],
    }),
  ).toThrow("invalid or incomplete");
  expect(() =>
    serializeResearchExport({
      ...fixture,
      answers: [...fixture.answers, ...fixture.answers],
    }),
  ).toThrow("invalid or incomplete");
  expect(() => serializeResearchExport({ ...fixture, pings: [] })).toThrow(
    "invalid or incomplete",
  );
});
test("credentials and unsupported versions are rejected", () => {
  expect(() =>
    parseResearchExport(JSON.stringify({ ...fixture, schemaVersion: 2 })),
  ).toThrow();
  expect(() =>
    parseResearchExport(
      JSON.stringify({
        ...fixture,
        participant: { ...fixture.participant, password: "synthetic-secret" },
      }),
    ),
  ).toThrow("invalid or incomplete");
  expect(() => parseResearchExport("{broken")).toThrow("invalid or incomplete");
});
