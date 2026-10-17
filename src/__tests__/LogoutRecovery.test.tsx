import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import * as Notifications from "expo-notifications";

import RootScreen from "../RootScreen";
import {
  getCurrentStudyFileAsync,
  storeCurrentStudyFileAsync,
} from "../helpers/asyncStorage/studyFile";
import {
  acknowledgeDataSnapshotAsync,
  captureDataSnapshotAsync,
  closeDataSessionAsync,
  getVerifiedPendingLogoutAsync,
} from "../helpers/dataJournal";
import { getPingsAsync, insertPingAsync } from "../helpers/pings";
import { secureStoreAnswerAsync } from "../helpers/secureStore/answer";
import {
  secureClearUserAsync,
  secureGetUserAsync,
  secureStoreUserAsync,
} from "../helpers/secureStore/user";
import {
  enqueueSurveyAnswerSaveAsync,
  waitForPendingSurveySavesAsync,
} from "../helpers/surveyAnswerWrites";
import { logoutAsync } from "../helpers/users";

jest.mock("../HomeScreen", () => () => null);
jest.mock("../screens/LoginScreen", () => () => null);
jest.mock("../helpers/firebase", () => ({
  firebaseInitialized: () => false,
  validateAndInitializeFirebaseWithConfig: jest.fn(),
}));
jest.mock("../helpers/beiwe", () => ({}));
jest.mock("expo-notifications", () => ({
  cancelAllScheduledNotificationsAsync: jest.fn().mockResolvedValue(undefined),
}));

const study = require("../../local/debug/DEBUG_STUDY.json");
const user = { username: "synthetic", password: "test-only", loginDate: 1 };
const storage = () => (SecureStore as any).__INTERNAL_MOCK_STORAGE__;
const archivedRecords = () =>
  Object.fromEntries(
    Object.entries(storage()).filter(([key]) => /\.(p|a|owner)\b/.test(key)),
  );

function restart() {
  const root = new RootScreen({});
  root.setState = ((next: any) => {
    root.state = { ...root.state, ...next };
  }) as any;
  return root;
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  for (const key of Object.keys(storage())) delete storage()[key];
  await storeCurrentStudyFileAsync(study);
  await secureStoreUserAsync(user);
});

async function cleanExpiredObservation() {
  const ping = await insertPingAsync({
    streamName: "welcomeStream",
    startTime: new Date(Date.now() - 50000),
    notificationTime: new Date(Date.now() - 60000),
    expiresAt: new Date(Date.now() - 1000),
  });
  const answer = {
    pingId: ping.id,
    questionId: "synthetic_question",
    preferNotToAnswer: null,
    data: { value: ["synthetic archived response"] },
    date: new Date(ping.startTime.getTime() + 1000),
  };
  await secureStoreAnswerAsync(answer);
  const snapshot = await captureDataSnapshotAsync();
  await acknowledgeDataSnapshotAsync(snapshot);
  return { ping, answer, owner: snapshot.owner };
}

test.each(["before", "after", "silent"])(
  "session deletion failure (%s) preserves a restartable close receipt and archive",
  async (phase) => {
    const { owner } = await cleanExpiredObservation();
    const records = archivedRecords();
    expect(Object.keys(records).some((key) => key.includes(".p."))).toBe(true);
    expect(Object.keys(records).some((key) => key.includes(".a."))).toBe(true);
    const original = (
      SecureStore.deleteItemAsync as jest.Mock
    ).getMockImplementation()!;
    let failed = false;
    jest
      .spyOn(SecureStore, "deleteItemAsync")
      .mockImplementation(async (key, ...args) => {
        if (!failed && key === `${owner.secureNamespace}user`) {
          failed = true;
          if (phase === "after") await original(key, ...args);
          if (phase !== "silent")
            throw new Error("Synthetic user clear failure");
          return;
        }
        return original(key, ...args);
      });
    await expect(logoutAsync()).rejects.toThrow();
    expect(await getVerifiedPendingLogoutAsync()).toEqual(owner);
    expect(archivedRecords()).toEqual(records);
    const root = restart();
    await root.componentDidMount();
    expect(root.state.recoveryError).toBe(false);
    expect(root.state.isLoading).toBe(false);
    expect(root.state.userInfo).toBeNull();
    expect(await getCurrentStudyFileAsync()).toBeNull();
    expect(await getVerifiedPendingLogoutAsync()).toBeNull();
    expect(archivedRecords()).toEqual(records);
  },
);

test.each(["before", "after", "silent"])(
  "configuration clear failure (%s) resumes with no credentials and never reopens archive",
  async (phase) => {
    const { owner } = await cleanExpiredObservation();
    const records = archivedRecords();
    const original = (
      AsyncStorage.setItem as jest.Mock
    ).getMockImplementation()!;
    let failed = false;
    jest
      .spyOn(AsyncStorage, "setItem")
      .mockImplementation(async (key, value) => {
        if (
          !failed &&
          key.endsWith("currentStudyFile.v2") &&
          JSON.parse(value).study === null
        ) {
          failed = true;
          if (phase === "after") await original(key, value);
          if (phase !== "silent")
            throw new Error("Synthetic configuration clear failure");
          return;
        }
        return original(key, value);
      });
    await expect(logoutAsync()).rejects.toThrow();
    expect(storage()[`${owner.secureNamespace}user`]).toBeUndefined();
    expect(await getVerifiedPendingLogoutAsync()).toEqual(owner);
    expect(archivedRecords()).toEqual(records);
    const root = restart();
    await root.componentDidMount();
    expect(root.state.recoveryError).toBe(false);
    expect(await getCurrentStudyFileAsync()).toBeNull();
    expect(await getVerifiedPendingLogoutAsync()).toBeNull();
    expect(archivedRecords()).toEqual(records);
  },
);

test("receipt deletion failure restarts even after configuration is already absent", async () => {
  const { owner } = await cleanExpiredObservation();
  const records = archivedRecords();
  await closeDataSessionAsync();
  const receiptKey = Object.keys(storage()).find((key) =>
    key.endsWith("dataJournal.v1.logout"),
  )!;
  expect(receiptKey).toBeTruthy();
  const original = (
    SecureStore.deleteItemAsync as jest.Mock
  ).getMockImplementation()!;
  let failed = false;
  jest
    .spyOn(SecureStore, "deleteItemAsync")
    .mockImplementation(async (key, ...args) => {
      if (!failed && key === receiptKey) {
        failed = true;
        throw new Error("Synthetic receipt clear failure");
      }
      return original(key, ...args);
    });
  await expect(logoutAsync(owner)).rejects.toThrow();
  expect(await getCurrentStudyFileAsync()).toBeNull();
  expect(await getVerifiedPendingLogoutAsync()).toEqual(owner);
  const root = restart();
  await root.componentDidMount();
  expect(root.state.recoveryError).toBe(false);
  expect(await getVerifiedPendingLogoutAsync()).toBeNull();
  expect(archivedRecords()).toEqual(records);
});

test("missing credentials without a verified receipt remain recovery-only", async () => {
  await cleanExpiredObservation();
  const records = archivedRecords();
  const savedStudy = await getCurrentStudyFileAsync();
  await secureClearUserAsync();
  const root = restart();
  await root.componentDidMount();
  expect(root.state.recoveryError).toBe(true);
  expect(
    Notifications.cancelAllScheduledNotificationsAsync,
  ).not.toHaveBeenCalled();
  expect(await getCurrentStudyFileAsync()).toEqual(savedStudy);
  expect(archivedRecords()).toEqual(records);
});

test("accepted detached answer must drain before logout checks dirty state", async () => {
  const { ping, answer, owner } = await cleanExpiredObservation();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const save = enqueueSurveyAnswerSaveAsync(owner.id, ping.id, async () => {
    await blocked;
    await secureStoreAnswerAsync(
      { ...answer, data: { value: ["accepted edit"] } },
      owner.id,
    );
  });
  const attempt = logoutAsync();
  const rejected = expect(attempt).rejects.toThrow(/unsent/);
  await Promise.resolve();
  expect(
    Notifications.cancelAllScheduledNotificationsAsync,
  ).not.toHaveBeenCalled();
  release();
  await save;
  await rejected;
  expect(await secureGetUserAsync()).toEqual(user);
  expect(await getVerifiedPendingLogoutAsync()).toBeNull();
  expect(
    (await captureDataSnapshotAsync({ unuploadedOnly: true })).answers[0].data,
  ).toEqual({ value: ["accepted edit"] });
});

test("retained save failure blocks all teardown until it becomes durable", async () => {
  const { ping, owner } = await cleanExpiredObservation();
  let failing = true;
  await expect(
    enqueueSurveyAnswerSaveAsync(owner.id, ping.id, async () => {
      if (failing) throw new Error("Synthetic retained save failure");
    }),
  ).rejects.toThrow();
  await expect(logoutAsync()).rejects.toThrow(/retained save/);
  expect(
    Notifications.cancelAllScheduledNotificationsAsync,
  ).not.toHaveBeenCalled();
  expect(await secureGetUserAsync()).toEqual(user);
  expect(await getVerifiedPendingLogoutAsync()).toBeNull();
  failing = false;
  await waitForPendingSurveySavesAsync();
  await logoutAsync();
});

test("new user is written only after any old logout receipt is retired", async () => {
  const { owner } = await cleanExpiredObservation();
  await closeDataSessionAsync();
  await secureClearUserAsync(owner);
  const next = { ...user, loginDate: 2 };
  await secureStoreUserAsync(next);
  expect(await secureGetUserAsync()).toEqual(next);
  expect(await getVerifiedPendingLogoutAsync()).toBeNull();
  expect(await getPingsAsync()).toEqual([]);
});

test("restart recovers a closed WAL interrupted before pointer publication", async () => {
  const { owner } = await cleanExpiredObservation();
  const records = archivedRecords();
  const original = (
    SecureStore.setItemAsync as jest.Mock
  ).getMockImplementation()!;
  let failed = false;
  jest
    .spyOn(SecureStore, "setItemAsync")
    .mockImplementation(async (key, ...args) => {
      if (!failed && key.endsWith("dataJournal.v1.logout")) {
        failed = true;
        throw new Error("Synthetic receipt publication interruption");
      }
      return original(key, ...args);
    });
  await expect(logoutAsync()).rejects.toThrow(/publication interruption/);
  expect(failed).toBe(true);
  expect(
    Notifications.cancelAllScheduledNotificationsAsync,
  ).not.toHaveBeenCalled();
  expect(await secureGetUserAsync()).toEqual(user);
  expect(
    Object.keys(storage()).some((key) => key.endsWith("dataJournal.v1.logout")),
  ).toBe(false);
  const root = restart();
  await root.componentDidMount();
  expect(root.state.recoveryError).toBe(false);
  expect(root.state.userInfo).toBeNull();
  expect(await getCurrentStudyFileAsync()).toBeNull();
  expect(await getVerifiedPendingLogoutAsync()).toBeNull();
  expect(storage()[`${owner.secureNamespace}user`]).toBeUndefined();
  expect(archivedRecords()).toEqual(records);
});

test("notification cancellation failure leaves a closed archive for safe retry", async () => {
  const { owner, answer } = await cleanExpiredObservation();
  const records = archivedRecords();
  (
    Notifications.cancelAllScheduledNotificationsAsync as jest.Mock
  ).mockRejectedValueOnce(new Error("Synthetic OS cancellation failure"));
  await expect(logoutAsync()).rejects.toThrow(/cancellation failure/);
  expect(await getVerifiedPendingLogoutAsync()).toEqual(owner);
  expect(await secureGetUserAsync()).toEqual(user);
  await expect(secureStoreAnswerAsync(answer, owner.id)).rejects.toMatchObject({
    code: "SESSION_CLOSED",
  });
  expect(archivedRecords()).toEqual(records);
  const root = restart();
  await root.componentDidMount();
  expect(root.state.recoveryError).toBe(false);
  expect(archivedRecords()).toEqual(records);
});

test("logout cleans only known temporary scheduling metadata, retaining research evidence", async () => {
  const { owner } = await cleanExpiredObservation();
  const prefix = `@WELLPING:Study_${owner.studyId}/`;
  await AsyncStorage.setItem(
    `${prefix}NotificationTime`,
    "synthetic scheduling metadata",
  );
  await AsyncStorage.setItem(
    `${prefix}tempStudyFile`,
    "synthetic pending configuration",
  );
  await AsyncStorage.setItem(
    `${prefix}unknownRecoveryEvidence`,
    "synthetic evidence must remain",
  );
  const records = archivedRecords();
  await logoutAsync();
  expect(await AsyncStorage.getItem(`${prefix}NotificationTime`)).toBeNull();
  expect(await AsyncStorage.getItem(`${prefix}tempStudyFile`)).toBeNull();
  expect(await AsyncStorage.getItem(`${prefix}unknownRecoveryEvidence`)).toBe(
    "synthetic evidence must remain",
  );
  expect(archivedRecords()).toEqual(records);
});
