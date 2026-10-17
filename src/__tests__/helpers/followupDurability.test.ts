import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { storeCurrentStudyFileAsync } from "../../helpers/asyncStorage/studyFile";
import { secureStoreUserAsync } from "../../helpers/secureStore/user";
import {
  enqueueFollowupPingsOnceAsync,
  getFuturePingsQueue,
  peekFuturePingIfAny,
  acknowledgeFuturePingAsync,
} from "../../helpers/asyncStorage/futurePings";
import { insertPingAsync, getPingsAsync } from "../../helpers/pings";
const study = require("../../../local/debug/DEBUG_STUDY.json");
const pair = [3, 7].map((day) => ({
  afterDate: new Date(`2020-01-0${day}T09:00:00Z`),
  streamName: "welcomeStream",
}));
beforeEach(async () => {
  await AsyncStorage.clear();
  for (const key of Object.keys((SecureStore as any).__INTERNAL_MOCK_STORAGE__))
    delete (SecureStore as any).__INTERNAL_MOCK_STORAGE__[key];
  await storeCurrentStudyFileAsync(study);
  await secureStoreUserAsync({
    username: "synthetic",
    password: "test-only",
    loginDate: 1,
  });
});
test("lost write acknowledgement retries one atomic followup pair", async () => {
  const original = (AsyncStorage.setItem as jest.Mock).getMockImplementation()!;
  jest
    .spyOn(AsyncStorage, "setItem")
    .mockImplementationOnce(async (...args) => {
      await original(...args);
      throw new Error("Lost acknowledgement");
    });
  await expect(
    enqueueFollowupPingsOnceAsync("operation", pair),
  ).rejects.toThrow();
  await enqueueFollowupPingsOnceAsync("operation", pair);
  expect(await getFuturePingsQueue()).toEqual(pair);
});
test("nonempty queue records a no-op decision so retry cannot reschedule", async () => {
  await enqueueFollowupPingsOnceAsync("first", pair);
  await enqueueFollowupPingsOnceAsync("second", pair);
  for (let i = 0; i < 2; i++)
    await acknowledgeFuturePingAsync(
      (await peekFuturePingIfAny())!.operationId,
    );
  await enqueueFollowupPingsOnceAsync("second", pair);
  expect(await getFuturePingsQueue()).toEqual([]);
});
test("crash after durable followup creation before queue ack does not duplicate ping", async () => {
  await enqueueFollowupPingsOnceAsync("first", pair);
  const reserved = (await peekFuturePingIfAny())!;
  const args = {
    notificationTime: reserved.afterDate,
    startTime: new Date(),
    streamName: reserved.streamName,
    operationId: reserved.operationId,
  };
  const first = await insertPingAsync(args);
  expect((await peekFuturePingIfAny())!.operationId).toBe(reserved.operationId);
  const retry = await insertPingAsync({
    ...args,
    startTime: new Date(Date.now() + 1000),
  });
  expect(retry).toEqual(first);
  await acknowledgeFuturePingAsync(reserved.operationId);
  expect(await getPingsAsync()).toHaveLength(1);
  expect(await getFuturePingsQueue()).toEqual([pair[1]]);
});

test("malformed schedule dates fail closed without changing saved bytes", async () => {
  await enqueueFollowupPingsOnceAsync("first", pair);
  const key = (await AsyncStorage.getAllKeys()).find((key) =>
    key.includes("FuturePingQueue.v2."),
  )!;
  const malformed = JSON.stringify({
    version: 2,
    completed: [],
    queue: [{ afterDate: null, streamName: "welcomeStream" }],
  });
  await AsyncStorage.setItem(key, malformed);
  await expect(peekFuturePingIfAny()).rejects.toThrow();
  expect(await AsyncStorage.getItem(key)).toBe(malformed);
  await expect(
    enqueueFollowupPingsOnceAsync("bad", [
      { afterDate: new Date(NaN), streamName: "welcomeStream" },
    ]),
  ).rejects.toThrow();
});

test("followup validation cannot move immutable inputs into a later session", async () => {
  const studyHelpers = require("../../helpers/studyFile");
  const originalGetStreams = studyHelpers.getStreamsAsync;
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  jest
    .spyOn(studyHelpers, "getStreamsAsync")
    .mockImplementationOnce(async () => {
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return originalGetStreams();
    });
  const input = pair.map((ping) => ({
    ...ping,
    afterDate: new Date(ping.afterDate),
  }));
  const scheduling = enqueueFollowupPingsOnceAsync("from-a", input);
  await started;
  const switching = secureStoreUserAsync({
    username: "other",
    password: "test-only",
    loginDate: 2,
  });
  input[0].afterDate.setFullYear(2099);
  release();
  await scheduling;
  await switching;
  expect(await getFuturePingsQueue()).toEqual([]);
  await secureStoreUserAsync({
    username: "synthetic",
    password: "test-only",
    loginDate: 1,
  });
  expect(await getFuturePingsQueue()).toEqual(pair);
});

test("stale Home reservation and acknowledgement cannot consume a later owner's queue", async () => {
  const { captureCurrentDataOwnerAsync } = require("../../helpers/dataJournal");
  const originalOwner = await captureCurrentDataOwnerAsync();
  await enqueueFollowupPingsOnceAsync("first", pair);
  const reserved = (await peekFuturePingIfAny(originalOwner.id))!;
  await secureStoreUserAsync({
    username: "other",
    password: "test-only",
    loginDate: 2,
  });
  await enqueueFollowupPingsOnceAsync("first", pair);
  await expect(peekFuturePingIfAny(originalOwner.id)).rejects.toMatchObject({
    code: "OWNER_CHANGED",
  });
  await expect(
    acknowledgeFuturePingAsync(reserved.operationId, originalOwner.id),
  ).rejects.toMatchObject({ code: "OWNER_CHANGED" });
  expect(await getFuturePingsQueue()).toEqual(pair);
});
