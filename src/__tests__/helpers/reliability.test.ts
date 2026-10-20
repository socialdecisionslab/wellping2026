import { setUpSurveyScreenTestAsync } from "../SurveyScreen.test/helper";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SerialTasks } from "../../helpers/serialTasks";
import { withDataLock } from "../../helpers/dataLock";
import {
  acknowledgeRevisionsAsync,
  getUploadRevisionsAsync,
  markPingDirtyAsync,
} from "../../helpers/uploadRevisions";
import { getUnuploadedPingsListAsync } from "../../helpers/asyncStorage/unuploadedPingsList";
import { mockCurrentStudyInfo } from "../helper";
import { PINGS_STUDY_INFO } from "../data/pings";

beforeEach(async () => {
  await AsyncStorage.clear();
  mockCurrentStudyInfo(PINGS_STUDY_INFO);
});

test("failed saves remain queued and retry in order before navigation", async () => {
  const queue = new SerialTasks();
  const events: string[] = [];
  let fail = true;
  const first = queue.enqueue(async () => {
    if (fail) throw Error("disk");
    events.push("first");
  });
  const second = queue.enqueue(async () => {
    events.push("last answer");
  });
  await expect(first).rejects.toThrow("disk");
  await expect(second).rejects.toThrow("disk");
  expect(events).toEqual([]);
  fail = false;
  await queue.flush();
  events.push("navigate");
  expect(events).toEqual(["first", "last answer", "navigate"]);
});

test("acknowledgment for an older revision never clears a newer edit", async () => {
  await withDataLock(() => markPingDirtyAsync("p1"));
  const sent = await withDataLock(getUploadRevisionsAsync);
  await withDataLock(() => markPingDirtyAsync("p1"));
  await withDataLock(() => acknowledgeRevisionsAsync(sent, ["p1"]));
  expect(await getUnuploadedPingsListAsync()).toEqual(["p1"]);
  const latest = await getUploadRevisionsAsync();
  expect(latest.p1.revision).toBe(sent.p1.revision + 1);
  await withDataLock(() => acknowledgeRevisionsAsync(latest, ["p1"]));
  expect(await getUnuploadedPingsListAsync()).toEqual([]);
  // Reopening reads the same durable generation, not an in-memory counter.
  expect((await getUploadRevisionsAsync()).p1).toEqual(latest.p1);
});

test("concurrent dirty writes retain both ping IDs and their study versions", async () => {
  await Promise.all(
    ["a", "b", "a"].map((id) => withDataLock(() => markPingDirtyAsync(id))),
  );
  expect(await getUnuploadedPingsListAsync()).toEqual(["a", "b"]);
  const values = await getUploadRevisionsAsync();
  expect(values.a.revision).toBe(2);
  expect(values.b.revision).toBe(1);
  mockCurrentStudyInfo({ ...PINGS_STUDY_INFO, version: "new-version" });
  await withDataLock(() => markPingDirtyAsync("a"));
  expect((await getUploadRevisionsAsync()).a.studyVersion).toBe(
    values.a.studyVersion,
  );
});

test("recovery overlays durable answers when interruption leaves an older resume snapshot", async () => {
  const {
    storePingStateAsync,
  } = require("../../helpers/asyncStorage/pingState");
  const {
    secureStoreAnswerAsync,
  } = require("../../helpers/secureStore/answer");
  const { recoverSurveyAsync } = require("../../helpers/recoverSurvey");
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
  const recovered = await recoverSurveyAsync(ping.id);
  expect(recovered.currentQuestionData.questionId).toBe("q1");
  expect(recovered.answers.q1).toEqual(answer);
});

test("session teardown and queued uploads are mutually exclusive", () => {
  const activity = require("../../helpers/uploadActivity");
  activity.beginUpload();
  expect(() => activity.beginSessionTeardown()).toThrow();
  activity.finishUpload();
  activity.beginSessionTeardown();
  expect(() => activity.beginUpload()).toThrow();
  activity.finishSessionTeardown();
  expect(activity.hasPendingUploads()).toBe(false);
});
