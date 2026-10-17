import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

import {
  getCurrentStudyFileAsync,
  storeCurrentStudyFileAsync,
} from "../../helpers/asyncStorage/studyFile";
import { getInstallationIDAsync } from "../../helpers/debug";
import {
  completePendingEnrollmentAsync,
  isVerifiedPendingEnrollmentAsync,
  preparePendingEnrollmentAsync,
} from "../../helpers/failedEnrollment";
import { secureStoreUserAsync } from "../../helpers/secureStore/user";
import { parseAndStoreStudyFileAsync } from "../../helpers/studyFile";

jest.mock("../../helpers/firebase", () => ({
  validateAndInitializeFirebaseWithConfig: jest.fn(),
}));

const study = require("../../../local/debug/DEBUG_STUDY.json");
const markerKey = "pendingEnrollment.v1";
const studyKey = "currentStudyFile.v2";
const studyPrefix = `@WELLPING:Study_${study.studyInfo.id}/`;
const user = {
  username: "synthetic-user",
  password: "synthetic-secret",
  loginDate: 10,
};

const asyncImplementations = Object.fromEntries(
  Object.entries(AsyncStorage)
    .filter(([, method]) => jest.isMockFunction(method))
    .map(([name, method]) => [
      name,
      (method as jest.Mock).getMockImplementation(),
    ]),
);
const secureImplementations = Object.fromEntries(
  Object.entries(SecureStore)
    .filter(([, method]) => jest.isMockFunction(method))
    .map(([name, method]) => [
      name,
      (method as jest.Mock).getMockImplementation(),
    ]),
);
beforeEach(async () => {
  jest.clearAllMocks();
  for (const [name, implementation] of Object.entries(asyncImplementations))
    (AsyncStorage as any)[name].mockReset().mockImplementation(implementation);
  for (const [name, implementation] of Object.entries(secureImplementations))
    (SecureStore as any)[name].mockReset().mockImplementation(implementation);
  await AsyncStorage.clear();
  (SecureStore as any).__INTERNAL_MOCK_STORAGE__ = {};
});

async function prepareAndStore() {
  await preparePendingEnrollmentAsync(study);
  await storeCurrentStudyFileAsync(study);
}

test("explicit fresh configuration writes its credential-free receipt first", async () => {
  const set = jest.spyOn(AsyncStorage, "setItem");
  expect(
    await parseAndStoreStudyFileAsync(JSON.stringify(study), {
      freshEnrollment: true,
    }),
  ).toBeNull();
  const keys = set.mock.calls.map(([key]) => key);
  expect(keys.indexOf(markerKey)).toBeLessThan(keys.indexOf(studyKey));
  const raw = (await AsyncStorage.getItem(markerKey))!;
  expect(JSON.parse(raw)).toEqual({
    version: 1,
    studyFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(raw).not.toContain(study.studyInfo.id);
  expect(raw).not.toContain(user.username);
  expect(raw).not.toContain(user.password);
  expect(
    await isVerifiedPendingEnrollmentAsync((await getCurrentStudyFileAsync())!),
  ).toBe(true);
});

test("a failed authentication can retry after restarting with the same saved configuration", async () => {
  await prepareAndStore();
  const before = await AsyncStorage.getItem(markerKey);
  const restartedStudy = (await getCurrentStudyFileAsync())!;
  expect(await isVerifiedPendingEnrollmentAsync(restartedStudy)).toBe(true);
  await preparePendingEnrollmentAsync(restartedStudy);
  expect(await AsyncStorage.getItem(markerKey)).toBe(before);
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
});

test("a crash before config storage leaves a harmless receipt and allows retry", async () => {
  await preparePendingEnrollmentAsync(study);
  expect(await getCurrentStudyFileAsync()).toBeNull();
  expect(await isVerifiedPendingEnrollmentAsync(study)).toBe(false);
  await prepareAndStore();
  expect(await isVerifiedPendingEnrollmentAsync(study)).toBe(true);
});

test("failed receipt persistence never saves the fresh configuration", async () => {
  const original = asyncImplementations.setItem!;
  jest.spyOn(AsyncStorage, "setItem").mockImplementation(async (key, value) => {
    if (key === markerKey) throw new Error("Synthetic storage failure");
    return original(key, value);
  });
  expect(
    await parseAndStoreStudyFileAsync(JSON.stringify(study), {
      freshEnrollment: true,
    }),
  ).not.toBeNull();
  expect(await getCurrentStudyFileAsync()).toBeNull();
});

test("failed config persistence leaves a receipt usable for the next attempt", async () => {
  const original = asyncImplementations.setItem!;
  const fault = jest
    .spyOn(AsyncStorage, "setItem")
    .mockImplementation(async (key, value) => {
      if (key === studyKey) throw new Error("Synthetic storage failure");
      return original(key, value);
    });
  expect(
    await parseAndStoreStudyFileAsync(JSON.stringify(study), {
      freshEnrollment: true,
    }),
  ).not.toBeNull();
  expect(await AsyncStorage.getItem(markerKey)).not.toBeNull();
  expect(await getCurrentStudyFileAsync()).toBeNull();
  fault.mockImplementation(original);
  await prepareAndStore();
  expect(await isVerifiedPendingEnrollmentAsync(study)).toBe(true);
});

test("an ordinary saved study without a receipt remains recovery-only", async () => {
  await storeCurrentStudyFileAsync(study);
  expect(await isVerifiedPendingEnrollmentAsync(study)).toBe(false);
  await expect(preparePendingEnrollmentAsync(study)).rejects.toThrow(
    /recovery/,
  );
  expect(await AsyncStorage.getItem(markerKey)).toBeNull();
  expect(await getCurrentStudyFileAsync()).not.toBeNull();
});

test.each([
  "pingsList",
  "unuploadedPingsList",
  "answersList/private-ping",
  "dataJournal.v1.owners",
  "PingsState:private-ping",
  "futurePings",
  "tempStudyFile",
])(
  "historical %s is not adopted or erased even with a matching receipt",
  async (suffix) => {
    await prepareAndStore();
    const historical = `${studyPrefix}${suffix}`;
    await AsyncStorage.setItem(historical, "synthetic historical bytes");
    expect(await isVerifiedPendingEnrollmentAsync(study)).toBe(false);
    await expect(preparePendingEnrollmentAsync(study)).rejects.toThrow(
      /recovery/,
    );
    expect(await AsyncStorage.getItem(historical)).toBe(
      "synthetic historical bytes",
    );
    expect(await AsyncStorage.getItem(markerKey)).not.toBeNull();
  },
);

test("existing research metadata blocks creating a fresh receipt", async () => {
  const historical = `${studyPrefix}dataJournal.v1.owners`;
  await AsyncStorage.setItem(historical, "{corrupt");
  await expect(preparePendingEnrollmentAsync(study)).rejects.toThrow(
    /recovery/,
  );
  expect(await AsyncStorage.getItem(markerKey)).toBeNull();
  expect(await AsyncStorage.getItem(historical)).toBe("{corrupt");
});

test("existing secure credentials block receipt creation without exposing or deleting them", async () => {
  const key = `WELLPING-${await getInstallationIDAsync()}-Study_${
    study.studyInfo.id
  }.user`;
  await SecureStore.setItemAsync(key, JSON.stringify(user));
  await expect(preparePendingEnrollmentAsync(study)).rejects.toThrow(
    /recovery/,
  );
  expect(await AsyncStorage.getItem(markerKey)).toBeNull();
  expect(await SecureStore.getItemAsync(key)).toBe(JSON.stringify(user));
});

test.each(["{broken", "{}", '{"version":1,"studyFingerprint":"bad"}'])(
  "malformed receipts cannot bypass recovery: %s",
  async (raw) => {
    await storeCurrentStudyFileAsync(study);
    await AsyncStorage.setItem(markerKey, raw);
    expect(await isVerifiedPendingEnrollmentAsync(study)).toBe(false);
    await expect(preparePendingEnrollmentAsync(study)).rejects.toThrow(
      /recovery/,
    );
    expect(await AsyncStorage.getItem(markerKey)).toBe(raw);
  },
);

test("a changed saved configuration cannot reuse a receipt", async () => {
  await prepareAndStore();
  const changed = {
    ...study,
    studyInfo: { ...study.studyInfo, version: "changed" },
  };
  await storeCurrentStudyFileAsync(changed);
  expect(await isVerifiedPendingEnrollmentAsync(changed)).toBe(false);
  expect(await isVerifiedPendingEnrollmentAsync(study)).toBe(false);
  await expect(preparePendingEnrollmentAsync(changed)).rejects.toThrow(
    /recovery/,
  );
});

test("receipt verification fails closed on unavailable metadata or secure storage", async () => {
  await prepareAndStore();
  jest
    .spyOn(AsyncStorage, "getAllKeys")
    .mockRejectedValueOnce(new Error("disk locked"));
  await expect(isVerifiedPendingEnrollmentAsync(study)).rejects.toThrow();
  jest
    .spyOn(SecureStore, "getItemAsync")
    .mockRejectedValueOnce(new Error("device locked"));
  await expect(isVerifiedPendingEnrollmentAsync(study)).rejects.toThrow();
  expect(await AsyncStorage.getItem(markerKey)).not.toBeNull();
});

test("completion requires a persisted user and clears only the receipt", async () => {
  await prepareAndStore();
  await expect(completePendingEnrollmentAsync()).rejects.toThrow(/recovery/);
  expect(await AsyncStorage.getItem(markerKey)).not.toBeNull();
  await secureStoreUserAsync(user);
  expect(await isVerifiedPendingEnrollmentAsync(study)).toBe(false);
  await completePendingEnrollmentAsync();
  expect(await AsyncStorage.getItem(markerKey)).toBeNull();
  expect(await getCurrentStudyFileAsync()).not.toBeNull();
  await expect(completePendingEnrollmentAsync()).resolves.toBeUndefined();
});

test("an interrupted completion retains the receipt for restart cleanup", async () => {
  await prepareAndStore();
  await secureStoreUserAsync(user);
  jest
    .spyOn(AsyncStorage, "removeItem")
    .mockRejectedValueOnce(new Error("disk busy"));
  await expect(completePendingEnrollmentAsync()).rejects.toThrow();
  expect(await AsyncStorage.getItem(markerKey)).not.toBeNull();
  await completePendingEnrollmentAsync();
  expect(await AsyncStorage.getItem(markerKey)).toBeNull();
});
