import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
beforeEach(async () => {
  await AsyncStorage.clear();
  for (const key of Object.keys((SecureStore as any).__INTERNAL_MOCK_STORAGE__))
    delete (SecureStore as any).__INTERNAL_MOCK_STORAGE__[key];
});
import { setUpSurveyScreenTestAsync } from "../SurveyScreen.test/helper";
import {
  captureDataSnapshotAsync,
  acknowledgeDataSnapshotAsync,
  closeDataSessionAsync,
} from "../../helpers/dataJournal";
import {
  enqueueSurveyAnswerSaveAsync,
  waitForPendingSurveySavesAsync,
} from "../../helpers/surveyAnswerWrites";
import { getUnuploadedPingsListAsync } from "../../helpers/asyncStorage/unuploadedPingsList";
import { secureStoreAnswerAsync } from "../../helpers/secureStore/answer";
import { secureStorePingAsync } from "../../helpers/secureStore/ping";
import {
  storePingStateAsync,
  getPingStateAsync,
} from "../../helpers/asyncStorage/pingState";
import { mockCurrentStudyInfo } from "../helper";
import { STUDY_INFO } from "../SurveyScreen.test/helper";

test("failed saves remain queued and retry in order before navigation", async () => {
  const events: string[] = [];
  let fail = true;
  const first = enqueueSurveyAnswerSaveAsync("owner", "ping", async () => {
    if (fail) throw Error("disk");
    events.push("first");
  });
  const second = enqueueSurveyAnswerSaveAsync("owner", "ping", async () => {
    events.push("last answer");
  });
  await expect(first).rejects.toThrow("disk");
  await expect(second).rejects.toThrow("disk");
  expect(events).toEqual([]);
  fail = false;
  await waitForPendingSurveySavesAsync();
  events.push("navigate");
  expect(events).toEqual(["first", "last answer", "navigate"]);
});

test("acknowledgment for an older revision never clears a newer edit", async () => {
  const ping = await setUpSurveyScreenTestAsync();
  const sent = await captureDataSnapshotAsync();
  await secureStoreAnswerAsync({
    pingId: ping.id,
    questionId: "q1",
    date: new Date(),
    preferNotToAnswer: null,
    data: { value: true },
  });
  await acknowledgeDataSnapshotAsync(sent);
  expect(await getUnuploadedPingsListAsync()).toEqual([ping.id]);
  const latest = await captureDataSnapshotAsync();
  expect(latest.revisions[ping.id]).toBe(sent.revisions[ping.id] + 1);
  await acknowledgeDataSnapshotAsync(latest);
  expect(await getUnuploadedPingsListAsync()).toEqual([]);
  expect((await captureDataSnapshotAsync()).revisions).toEqual(
    latest.revisions,
  );
});

test("concurrent writes retain both ping IDs and their originating study versions", async () => {
  const ping = await setUpSurveyScreenTestAsync();
  const other = { ...ping, id: "second_ping" };
  await Promise.all([
    secureStorePingAsync(other),
    secureStoreAnswerAsync({
      pingId: ping.id,
      questionId: "q1",
      date: new Date(),
      preferNotToAnswer: null,
      data: { value: true },
    }),
  ]);
  const before = await captureDataSnapshotAsync();
  expect(await getUnuploadedPingsListAsync()).toEqual([ping.id, other.id]);
  mockCurrentStudyInfo({ ...STUDY_INFO, version: "new-version" });
  await secureStoreAnswerAsync({
    pingId: ping.id,
    questionId: "q1",
    date: new Date(),
    preferNotToAnswer: null,
    data: { value: false },
  });
  const after = await captureDataSnapshotAsync();
  expect(after.studyVersions).toEqual(before.studyVersions);
  expect(after.revisions[ping.id]).toBe(before.revisions[ping.id] + 1);
});

test("recovery overlays durable answers when interruption leaves an older resume snapshot", async () => {
  const ping = await setUpSurveyScreenTestAsync();
  await storePingStateAsync(ping.id, {
    currentQuestionData: { questionId: "q1", extraData: {} },
    nextQuestionsDataStack: [],
    answers: {},
    isInTransition: false,
  });
  const answer = {
    pingId: ping.id,
    questionId: "q1",
    date: new Date(),
    preferNotToAnswer: null,
    data: { value: true },
  };
  await secureStoreAnswerAsync(answer);
  const recovered = await getPingStateAsync(ping.id);
  expect(recovered.currentQuestionData.questionId).toBe("q1");
  expect(recovered.answers.q1).toEqual(answer);
});

test("session teardown cannot discard records awaiting upload acknowledgement", async () => {
  const ping = await setUpSurveyScreenTestAsync();
  await secureStorePingAsync({ ...ping, endTime: new Date() });
  const snapshot = await captureDataSnapshotAsync();
  await expect(closeDataSessionAsync()).rejects.toMatchObject({
    code: "PENDING_RESEARCH_DATA",
  });
  await acknowledgeDataSnapshotAsync(snapshot);
  await closeDataSessionAsync();
  await expect(
    secureStoreAnswerAsync({
      pingId: ping.id,
      questionId: "q1",
      date: new Date(),
      preferNotToAnswer: null,
      data: { value: true },
    }),
  ).rejects.toMatchObject({ code: "SESSION_CLOSED" });
});

test("target journal records without version metadata remain readable without inventing a version", async () => {
  const ping = await setUpSurveyScreenTestAsync();
  const { getDataOwnerAsync } = require("../../helpers/dataJournal");
  const {
    readChunkedValue,
    writeChunkedValue,
  } = require("../../helpers/secureStore/chunkedValue");
  const owner = await getDataOwnerAsync();
  const key = `${owner.secureNamespace}dataJournal.v1.${owner.id}.index`;
  const index = JSON.parse(await readChunkedValue(key));
  delete index.studyVersions;
  await writeChunkedValue(key, JSON.stringify(index));
  const snapshot = await captureDataSnapshotAsync();
  expect(snapshot.studyVersions[ping.id]).toBeNull();
  expect(snapshot.pings).toEqual([ping]);
  expect(snapshot.revisions[ping.id]).toBe(index.revisions[ping.id]);
});
