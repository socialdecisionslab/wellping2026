import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { storeCurrentStudyFileAsync } from "../../helpers/asyncStorage/studyFile";
import {
  getTempStudyFileAsync,
  storeTempStudyFileAsync,
} from "../../helpers/asyncStorage/tempStudyFile";
import {
  closeDataSessionAsync,
  getDataOwnerAsync,
} from "../../helpers/dataJournal";
import { secureStoreUserAsync } from "../../helpers/secureStore/user";

const study = require("../../../local/debug/DEBUG_STUDY.json");
const user = { username: "synthetic", password: "test-only", loginDate: 1 };

beforeEach(async () => {
  await AsyncStorage.clear();
  for (const key of Object.keys((SecureStore as any).__INTERNAL_MOCK_STORAGE__))
    delete (SecureStore as any).__INTERNAL_MOCK_STORAGE__[key];
  await storeCurrentStudyFileAsync(study);
  await secureStoreUserAsync(user);
});

test("the requesting owner can stage a study refresh", async () => {
  const owner = await getDataOwnerAsync();
  await storeTempStudyFileAsync("synthetic update", owner.id);
  expect(await getTempStudyFileAsync()).toBe("synthetic update");
});

test.each(["participant", "login session", "study"])(
  "a delayed refresh cannot replace the new %s's pending update",
  async (change) => {
    const original = await getDataOwnerAsync();
    if (change === "study")
      await storeCurrentStudyFileAsync({
        ...study,
        studyInfo: { ...study.studyInfo, id: "different_study" },
      });
    await secureStoreUserAsync({
      ...user,
      username: change === "participant" ? "second-participant" : user.username,
      loginDate: change === "login session" ? 2 : 1,
    });
    const current = await getDataOwnerAsync();
    await storeTempStudyFileAsync("current update", current.id);
    await expect(
      storeTempStudyFileAsync("stale update", original.id),
    ).rejects.toMatchObject({ code: "OWNER_CHANGED" });
    expect(await getTempStudyFileAsync()).toBe("current update");
  },
);

test("a refresh completing after session closure cannot recreate pending metadata", async () => {
  const owner = await getDataOwnerAsync();
  await closeDataSessionAsync();
  await expect(
    storeTempStudyFileAsync("late update", owner.id),
  ).rejects.toMatchObject({ code: "SESSION_CLOSED" });
  expect(await getTempStudyFileAsync()).toBeNull();
});
