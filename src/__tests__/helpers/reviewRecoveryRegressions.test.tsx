/** Restart regressions reproduced against PR #14 c8eb518. Uses real persistence. */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { advanceTo, clear } from "jest-date-mock";
import RootScreen from "../../RootScreen";
import { storeTempStudyFileAsync } from "../../helpers/asyncStorage/tempStudyFile";
import HomeScreen from "../../HomeScreen";
import { StudyFileSchema } from "@wellping/study-schemas/lib/schemas/StudyFile";
import {
  storeCurrentStudyFileAsync,
  getCurrentStudyFileAsync,
} from "../../helpers/asyncStorage/studyFile";
import { secureStoreUserAsync } from "../../helpers/secureStore/user";
import {
  captureCurrentDataOwnerAsync,
  insertJournalPingAsync,
  completeJournalPingAsync,
  captureDataSnapshotAsync,
  storeJournalAnswerAsync,
} from "../../helpers/dataJournal";
import {
  enqueueFollowupPingsOnceAsync,
  peekFuturePingIfAny,
  getFuturePingsQueue,
} from "../../helpers/asyncStorage/futurePings";
import { storeNotificationTimesAsync } from "../../helpers/asyncStorage/notificationTimes";
import {
  storePingStateAsync,
  getPingStateAsync,
} from "../../helpers/asyncStorage/pingState";
import { getCurrentNotificationTimeAsync } from "../../helpers/notifications";

jest.mock("../../helpers/dataUpload", () => ({
  uploadDataAsync: jest.fn().mockResolvedValue({}),
}));
jest.mock("../../helpers/notifications", () => ({
  setNotificationsAsync: jest.fn().mockResolvedValue(undefined),
  setupNotificationsPermissionAsync: jest.fn().mockResolvedValue(true),
  getCurrentNotificationTimeAsync: jest.fn().mockResolvedValue(null),
  clearSentNotificationsAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../components/DashboardComponent", () => "DashboardComponent");
jest.mock("../../SurveyScreen", () => "SurveyScreen");

beforeEach(async () => {
  await AsyncStorage.clear();
  for (const key of Object.keys((SecureStore as any).__INTERNAL_MOCK_STORAGE__))
    delete (SecureStore as any).__INTERNAL_MOCK_STORAGE__[key];
  jest.mocked(getCurrentNotificationTimeAsync).mockResolvedValue(null);
});
afterEach(clear);

async function setupStudy() {
  const fixture = require("../../../local/debug/DEBUG_STUDY.json");
  const question = {
    id: "q",
    type: "YesNo",
    question: "Synthetic",
    next: null,
  };
  const study = StudyFileSchema.parse({
    ...fixture,
    studyInfo: {
      ...fixture.studyInfo,
      id: "synthetic_review_study",
      version: "review-1",
      server: {},
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: "2026-12-31T00:00:00.000Z",
      pingsFrequency: [
        {
          earliestPingNotificationTime: "10:00:00",
          expireAfterTime: "01:00:00",
        },
      ],
      streamsOrder: Object.fromEntries(
        [
          "sunday",
          "monday",
          "tuesday",
          "wednesday",
          "thursday",
          "friday",
          "saturday",
        ].map((day) => [day, ["baseline"]]),
      ),
      streamsStartingQuestionIds: { baseline: "q", followup: "q" },
      streamInCaseOfError: "baseline",
      streamsForNthPings: undefined,
      streamsNotReplacedByFollowupStream: [],
    },
    streams: { baseline: { q: question }, followup: { q: question } },
    extraData: {},
  });
  await storeCurrentStudyFileAsync(study);
  return (await getCurrentStudyFileAsync())!;
}

test.each(["completed", "incomplete", "same-window"])(
  "follow-up insertion recovery: %s",
  async (scenario) => {
    const oldTime = new Date("2026-02-01T10:00:00Z");
    const newTime =
      scenario === "same-window" ? oldTime : new Date("2026-02-02T10:00:00Z");
    advanceTo(new Date(+oldTime + 60_000));
    const configuration = await setupStudy();
    const study = configuration.studyInfo;
    const streams = configuration.streams;
    await secureStoreUserAsync({
      username: "synthetic-review",
      password: "synthetic",
      loginDate: 0,
    });
    const owner = await captureCurrentDataOwnerAsync();
    await enqueueFollowupPingsOnceAsync(
      "synthetic-trigger",
      [{ streamName: "followup", afterDate: new Date(+oldTime - 60_000) }],
      owner.id,
    );
    const reservation = await peekFuturePingIfAny(owner.id);
    const oldPing = await insertJournalPingAsync({
      notificationTime: oldTime,
      startTime: new Date(),
      streamName: "followup",
      operationId: reservation!.operationId,
      expiresAt: new Date(+oldTime + 3_600_000),
      expectedOwnerId: owner.id,
    });
    // Interruption after insertion and before acknowledgeFuturePingAsync leaves
    // the queue entry. Recovery can finish the old observation after reopening.
    advanceTo(new Date(+oldTime + 120_000));
    if (scenario === "completed")
      await completeJournalPingAsync(
        oldPing.id,
        new Date(+oldTime + 120_000),
        owner.id,
      );
    expect(await getFuturePingsQueue()).toHaveLength(1);

    advanceTo(new Date(+newTime + 60_000));
    await storeNotificationTimesAsync([
      {
        notificationDate: newTime,
        expirationDate: new Date(+newTime + 3_600_000),
      },
    ]);
    const screen = new HomeScreen({
      studyInfo: study,
      streams,
      logout: async () => {},
    });
    screen.setState = ((next: any, callback?: () => void) => {
      Object.assign(
        screen.state,
        typeof next === "function" ? next(screen.state) : next,
      );
      callback?.();
    }) as any;
    screen.setState({ currentNotificationTime: newTime });
    jest.mocked(getCurrentNotificationTimeAsync).mockResolvedValue(newTime);
    await screen.beginSurveyAsync();
    await screen.checkIfPingHasExpiredAsync(0);
    if (scenario === "same-window")
      expect(screen.state.currentPing?.id).toBe(oldPing.id);
    else expect(screen.state.currentPing?.id).not.toBe(oldPing.id);
    expect(screen.state.currentPing?.notificationTime).toEqual(newTime);
    expect((await captureDataSnapshotAsync()).pings).toHaveLength(
      scenario === "same-window" ? 1 : 2,
    );
    expect(await getFuturePingsQueue()).toHaveLength(0);
  },
);

test.each([
  "before",
  "after",
  "staged",
  "wrong-owner",
  "late",
  "unknown-question",
])(
  "Home must recover durable completion when restarted %s expiry",
  async (restart) => {
    const start = new Date("2026-02-01T10:00:00Z");
    const expires = new Date("2026-02-01T11:00:00Z");
    const accepted = new Date(+expires - 2);
    advanceTo(new Date(+start + 1));
    const configuration = await setupStudy();
    const study = configuration.studyInfo;
    await secureStoreUserAsync({
      username: "synthetic-review",
      password: "synthetic",
      loginDate: 0,
    });
    const owner = await captureCurrentDataOwnerAsync();
    const ping = await insertJournalPingAsync({
      notificationTime: start,
      startTime: new Date(),
      streamName: "baseline",
      expiresAt: expires,
      expectedOwnerId: owner.id,
    });
    advanceTo(accepted);
    const answer = {
      pingId: ping.id,
      questionId: "q",
      date: accepted,
      preferNotToAnswer: null,
      data: { value: true },
    };
    await storeJournalAnswerAsync(answer, owner.id);
    await storePingStateAsync(
      ping.id,
      {
        currentQuestionData: {
          questionId: null,
          extraData: {
            __wellpingCompletionEvent: {
              version: 1,
              ownerId: restart === "wrong-owner" ? "other-owner" : owner.id,
              pingId: ping.id,
              questionId: restart === "unknown-question" ? "missing" : "q",
              requestedAt: (restart === "late"
                ? new Date(+expires + 1)
                : accepted
              ).toISOString(),
            },
          },
        },
        nextQuestionsDataStack: [],
        answers: { q: answer },
        isInTransition: false,
      },
      owner.id,
    );
    // The terminal snapshot committed, then the process stopped before the
    // separate journal endTime write. Restart after the protocol window closes.
    advanceTo(new Date(+expires + (restart === "before" ? -1 : 2)));
    jest
      .mocked(getCurrentNotificationTimeAsync)
      .mockResolvedValue(restart === "before" ? start : null);
    const screen = new HomeScreen({
      studyInfo: study,
      streams: configuration.streams,
      logout: async () => {},
    });
    screen.setState = ((next: any, callback?: () => void) => {
      Object.assign(
        screen.state,
        typeof next === "function" ? next(screen.state) : next,
      );
      callback?.();
    }) as any;
    if (["wrong-owner", "late", "unknown-question"].includes(restart)) {
      await expect(screen.initializeHomeAsync(0)).rejects.toThrow();
      expect((await captureDataSnapshotAsync()).pings[0].endTime).toBeNull();
      expect(
        (await getPingStateAsync(ping.id, owner.id)).currentQuestionData
          .questionId,
      ).toBeNull();
      return;
    }
    if (restart === "staged") {
      const replacement = {
        ...configuration,
        studyInfo: {
          ...study,
          version: "review-2",
          streamsStartingQuestionIds: {
            baseline: "replacement",
            followup: "replacement",
          },
        },
        streams: Object.fromEntries(
          ["baseline", "followup"].map((name) => [
            name,
            {
              replacement: {
                id: "replacement",
                type: "YesNo",
                question: "Replacement",
                next: null,
              },
            },
          ]),
        ),
      };
      await storeTempStudyFileAsync(JSON.stringify(replacement), owner.id);
      const root = new RootScreen({});
      root.setState = jest.fn();
      await root.loadTempStudyFileAsync();
      expect((await getCurrentStudyFileAsync())!.studyInfo.version).toBe(
        "review-2",
      );
      expect((await captureDataSnapshotAsync()).pings[0].endTime).toEqual(
        accepted,
      );
    }
    await screen.initializeHomeAsync(0);
    expect((await captureDataSnapshotAsync()).pings[0].endTime).toEqual(
      accepted,
    );
    expect(
      (await getPingStateAsync(ping.id, owner.id)).currentQuestionData
        .questionId,
    ).toBeNull();
    const recorded = (await captureDataSnapshotAsync()).pings[0];
    const canRecoverCompletion =
      recorded.endTime !== null ||
      (screen.state.currentPing?.id === ping.id &&
        screen.state.storedPingStateAsync?.currentQuestionData.questionId ===
          null);
    expect(canRecoverCompletion).toBe(true);
    expect(screen.state.expiredIncomplete).not.toBe(true);
  },
);
