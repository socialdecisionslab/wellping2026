import AsyncStorage from "@react-native-async-storage/async-storage";

import { getAnswersAsync, insertAnswerAsync } from "../../helpers/answers";
import { clearCurrentStudyFileAsync } from "../../helpers/asyncStorage/studyFile";
import {
  addToUnuploadedPingsListIfNeededAsync,
  getUnuploadedPingsListAsync,
} from "../../helpers/asyncStorage/unuploadedPingsList";
import { validateAndInitializeFirebaseWithConfig } from "../../helpers/firebase";
import { insertPingAsync } from "../../helpers/pings";
import {
  secureGetUserAsync,
  secureStoreUserAsync,
} from "../../helpers/secureStore/user";
import {
  getStudyFileAsync,
  parseAndStoreStudyFileAsync,
  studyFileExistsAsync,
} from "../../helpers/studyFile";

// Never initialize a real backend, even when testing invalid Firebase config.
jest.mock("../../helpers/firebase", () => ({
  validateAndInitializeFirebaseWithConfig: jest.fn(),
}));

const study = require("../../../local/debug/DEBUG_STUDY.json");
const rawStudy = JSON.stringify(study);

beforeEach(async () => {
  await AsyncStorage.clear();
  (validateAndInitializeFirebaseWithConfig as jest.Mock).mockReset();
});

test.each([
  ["malformed JSON", "{unfinished"],
  ["missing study configuration", "{}"],
  [
    "invalid study configuration",
    JSON.stringify({ ...study, studyInfo: { ...study.studyInfo, id: 42 } }),
  ],
])(
  "rejects %s without losing the saved study or offline responses",
  async (_, replacement) => {
    expect(await parseAndStoreStudyFileAsync(rawStudy)).toBeNull();
    const savedStudy = await getStudyFileAsync();
    const user = {
      username: "synthetic",
      password: "synthetic-only",
      loginDate: 1000,
    };
    await secureStoreUserAsync(user);
    const ping = await insertPingAsync({
      notificationTime: new Date("2026-01-01T09:00:00Z"),
      startTime: new Date("2026-01-01T09:01:00Z"),
      streamName: "welcomeStream",
    });
    await addToUnuploadedPingsListIfNeededAsync(ping);
    const question = savedStudy.streams.welcomeStream.Hello;
    const answer = await insertAnswerAsync({
      ping,
      question,
      realQuestionId: question.id,
      preferNotToAnswer: null,
      data: { value: ":)" },
      date: new Date("2026-01-01T09:02:00Z"),
    });

    expect(await parseAndStoreStudyFileAsync(replacement)).not.toBeNull();

    // Read through the same storage APIs used on restart, not in-memory state.
    expect(await studyFileExistsAsync()).toBe(true);
    expect(await getStudyFileAsync()).toEqual(savedStudy);
    expect(await secureGetUserAsync()).toEqual(user);
    expect(await getUnuploadedPingsListAsync()).toEqual([ping.id]);
    expect(await getAnswersAsync({ unuploadedOnly: true })).toEqual([answer]);

    // A corrected update can still be applied after the rejected one.
    expect(
      await parseAndStoreStudyFileAsync(
        JSON.stringify({
          ...study,
          studyInfo: { ...study.studyInfo, version: "corrected" },
        }),
      ),
    ).toBeNull();
    expect((await getStudyFileAsync()).studyInfo.version).toBe("corrected");
    expect(await getAnswersAsync({ unuploadedOnly: true })).toEqual([answer]);
  },
);

test("an invalid first study does not establish an enrollment", async () => {
  expect(await parseAndStoreStudyFileAsync("{}")).not.toBeNull();
  expect(await studyFileExistsAsync()).toBe(false);
});

test("backend configuration rejection preserves the saved study", async () => {
  expect(await parseAndStoreStudyFileAsync(rawStudy)).toBeNull();
  const savedStudy = await getStudyFileAsync();
  (validateAndInitializeFirebaseWithConfig as jest.Mock).mockImplementation(
    () => {
      throw new Error("Synthetic Firebase configuration failure");
    },
  );
  const replacement = JSON.stringify({
    ...study,
    studyInfo: { ...study.studyInfo, server: { firebase: { config: {} } } },
  });
  const error = await parseAndStoreStudyFileAsync(replacement);
  expect(validateAndInitializeFirebaseWithConfig).toHaveBeenCalledTimes(1);
  expect(error).toContain("Synthetic Firebase configuration failure");
  expect(await getStudyFileAsync()).toEqual(savedStudy);
});

test("a storage failure still clears a potentially partial replacement", async () => {
  expect(await parseAndStoreStudyFileAsync(rawStudy)).toBeNull();
  const setItem = (AsyncStorage.setItem as jest.Mock).getMockImplementation()!;
  const write = jest
    .spyOn(AsyncStorage, "setItem")
    .mockClear()
    .mockImplementationOnce(setItem)
    .mockRejectedValueOnce(new Error("Synthetic disk failure"));
  jest.spyOn(console, "error").mockImplementation(() => {});
  expect(await parseAndStoreStudyFileAsync(rawStudy)).toContain(
    "Synthetic disk failure",
  );
  expect(write).toHaveBeenCalledTimes(2);
  expect(await studyFileExistsAsync()).toBe(false);
});

afterEach(async () => {
  await clearCurrentStudyFileAsync();
});
