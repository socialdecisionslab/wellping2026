import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

import {
  clearCurrentStudyFileAsync,
  getCurrentStudyFileAsync,
  storeCurrentStudyFileAsync,
} from "../../helpers/asyncStorage/studyFile";
import { getInstallationIDAsync } from "../../helpers/debug";
import {
  completePendingEnrollmentAsync,
  isVerifiedPendingEnrollmentAsync,
  preparePendingEnrollmentAsync,
} from "../../helpers/failedEnrollment";
import {
  secureClearUserAsync,
  secureStoreUserAsync,
} from "../../helpers/secureStore/user";
import {
  acknowledgeDataSnapshotAsync,
  captureDataSnapshotAsync,
  closeDataSessionAsync,
  completeDataLogoutAsync,
  completeJournalPingAsync,
  getDataOwnerAsync,
  insertJournalPingAsync,
} from "../../helpers/dataJournal";
import { quarantineLegacyResumeAsync } from "../../helpers/secureStore/legacyResumeQuarantine";
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
    if (suffix === "dataJournal.v1.owners") {
      await expect(isVerifiedPendingEnrollmentAsync(study)).rejects.toThrow(
        /recovery/,
      );
    } else {
      expect(await isVerifiedPendingEnrollmentAsync(study)).toBe(false);
    }
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

async function createClosedArchive() {
  await storeCurrentStudyFileAsync(study);
  await secureStoreUserAsync(user);
  const ping = await insertJournalPingAsync({
    notificationTime: new Date("2026-01-01T09:00:00Z"),
    startTime: new Date("2026-01-01T09:01:00Z"),
    streamName: "welcomeStream",
  });
  await completeJournalPingAsync(ping.id, new Date("2026-01-01T09:02:00Z"));
  await acknowledgeDataSnapshotAsync(await captureDataSnapshotAsync());
  const owner = await closeDataSessionAsync();
  await secureClearUserAsync();
  await clearCurrentStudyFileAsync();
  await completeDataLogoutAsync(owner);
  return owner;
}

test("verified closed archives permit a fresh same-study enrollment without adopting or changing old records", async () => {
  const oldOwner = await createClosedArchive();
  const archivedBytes = { ...(SecureStore as any).__INTERNAL_MOCK_STORAGE__ };
  await prepareAndStore();
  expect(
    await isVerifiedPendingEnrollmentAsync((await getCurrentStudyFileAsync())!),
  ).toBe(true);
  await preparePendingEnrollmentAsync(study);
  await secureStoreUserAsync({
    ...user,
    username: "synthetic-new-user",
    loginDate: 20,
  });
  await completePendingEnrollmentAsync();
  const newOwner = await getDataOwnerAsync();
  expect(newOwner.id).not.toBe(oldOwner.id);
  expect((await captureDataSnapshotAsync()).pings).toEqual([]);
  for (const [key, bytes] of Object.entries(archivedBytes))
    expect(await SecureStore.getItemAsync(key)).toBe(bytes);
  expect(await AsyncStorage.getItem(markerKey)).toBeNull();
});

test("an open owner archive never qualifies for fresh enrollment after credentials disappear", async () => {
  await storeCurrentStudyFileAsync(study);
  await secureStoreUserAsync(user);
  const owner = await getDataOwnerAsync();
  await secureClearUserAsync();
  await clearCurrentStudyFileAsync();
  await expect(preparePendingEnrollmentAsync(study)).rejects.toThrow();
  expect(await AsyncStorage.getItem(markerKey)).toBeNull();
  expect(
    await AsyncStorage.getItem(`${studyPrefix}dataJournal.v1.owners`),
  ).toContain(owner.id);
});

test("a closed archive does not excuse unknown legacy records", async () => {
  await createClosedArchive();
  const unknown = `${studyPrefix}pingsList`;
  await AsyncStorage.setItem(unknown, "synthetic unknown history");
  await expect(preparePendingEnrollmentAsync(study)).rejects.toThrow();
  expect(await AsyncStorage.getItem(markerKey)).toBeNull();
  expect(await AsyncStorage.getItem(unknown)).toBe("synthetic unknown history");
});

test("owner-linked archived follow-up metadata does not prevent fresh enrollment", async () => {
  const oldOwner = await createClosedArchive();
  const key = `${studyPrefix}FuturePingQueue.v2.${oldOwner.id}`;
  const queue = JSON.stringify({
    version: 2,
    queue: [
      { streamName: "welcomeStream", afterDate: "2026-01-02T09:00:00.000Z" },
    ],
    completed: ["synthetic-operation"],
  });
  await AsyncStorage.setItem(key, queue);
  await prepareAndStore();
  expect(await isVerifiedPendingEnrollmentAsync(study)).toBe(true);
  expect(await AsyncStorage.getItem(key)).toBe(queue);
});

test("quarantined unknown legacy responses remain recovery-only even beside closed archives", async () => {
  await createClosedArchive();
  await prepareAndStore();
  const source = `${studyPrefix}PingsState:unknown-legacy-ping`;
  await AsyncStorage.setItem(source, "synthetic unknown response bytes");
  await quarantineLegacyResumeAsync(source);
  expect(await AsyncStorage.getItem(source)).toBeNull();
  const indexKey = "@WELLPING:legacyResumeQuarantineIndex.v1";
  const preservedIndex = await AsyncStorage.getItem(indexKey);
  expect(preservedIndex).not.toBeNull();
  expect(await isVerifiedPendingEnrollmentAsync(study)).toBe(false);
  await expect(preparePendingEnrollmentAsync(study)).rejects.toThrow(
    /recovery/,
  );
  expect(await AsyncStorage.getItem(indexKey)).toBe(preservedIndex);
});
