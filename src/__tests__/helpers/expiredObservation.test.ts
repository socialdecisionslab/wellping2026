import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { storeCurrentStudyFileAsync } from "../../helpers/asyncStorage/studyFile";
import {
  secureStoreUserAsync,
  secureGetUserAsync,
} from "../../helpers/secureStore/user";
import { insertPingAsync, getPingsAsync } from "../../helpers/pings";
import {
  captureDataSnapshotAsync,
  acknowledgeDataSnapshotAsync,
} from "../../helpers/dataJournal";
import { logoutAsync } from "../../helpers/users";
jest.mock("expo-notifications", () => ({
  cancelAllScheduledNotificationsAsync: jest.fn(),
}));
jest.mock("../../helpers/firebase", () => ({
  firebaseInitialized: () => false,
}));
jest.mock("../../helpers/beiwe", () => ({}));
const study = require("../../../local/debug/DEBUG_STUDY.json");
const user = { username: "synthetic", password: "synthetic", loginDate: 1 };
beforeEach(async () => {
  await AsyncStorage.clear();
  for (const key of Object.keys((SecureStore as any).__INTERNAL_MOCK_STORAGE__))
    delete (SecureStore as any).__INTERNAL_MOCK_STORAGE__[key];
  await storeCurrentStudyFileAsync(study);
  await secureStoreUserAsync(user);
});
async function observe(expiresAt?: Date) {
  return insertPingAsync({
    streamName: "welcomeStream",
    startTime: new Date(Date.now() - 50000),
    notificationTime: new Date(Date.now() - 60000),
    expiresAt,
  });
}
test("expired incomplete observations must sync before logout but are not erased afterwards", async () => {
  const ping = await observe(new Date(Date.now() - 1000));
  await expect(logoutAsync()).rejects.toThrow(/unsent/);
  await acknowledgeDataSnapshotAsync(await captureDataSnapshotAsync({}));
  await logoutAsync();
  // Reopen the exact owner only to verify retention, not normal re-enrollment.
  await storeCurrentStudyFileAsync(study);
  await secureStoreUserAsync(user);
  expect(await getPingsAsync()).toEqual([ping]);
  expect((await getPingsAsync())[0].endTime).toBeNull();
});
test("active incomplete survey cannot logout after partial observations sync", async () => {
  await observe(new Date(Date.now() + 60000));
  await acknowledgeDataSnapshotAsync(await captureDataSnapshotAsync({}));
  await expect(logoutAsync()).rejects.toThrow(/in progress/);
  expect(await secureGetUserAsync()).toEqual(user);
});
test("unknown expiration stays conservatively active", async () => {
  await observe();
  await acknowledgeDataSnapshotAsync(await captureDataSnapshotAsync({}));
  await expect(logoutAsync()).rejects.toThrow(/in progress/);
});
