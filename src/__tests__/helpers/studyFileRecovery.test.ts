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
  expect(error).toBe("Study configuration is invalid. Contact the study team.");
  expect(error).not.toContain("Synthetic Firebase configuration failure");
  expect(await getStudyFileAsync()).toEqual(savedStudy);
});

test("a failed atomic replacement preserves the previous complete study", async () => {
  expect(await parseAndStoreStudyFileAsync(rawStudy)).toBeNull();
  const previous = await getStudyFileAsync();
  jest
    .spyOn(AsyncStorage, "setItem")
    .mockRejectedValueOnce(new Error("Synthetic disk failure"));
  expect(
    await parseAndStoreStudyFileAsync(
      JSON.stringify({
        ...study,
        studyInfo: { ...study.studyInfo, version: "replacement" },
      }),
    ),
  ).not.toBeNull();
  expect(await getStudyFileAsync()).toEqual(previous);
  expect(await studyFileExistsAsync()).toBe(true);
});

test("a valid replacement commits all study sections together", async () => {
  expect(await parseAndStoreStudyFileAsync(rawStudy)).toBeNull();
  const replacement = {
    ...study,
    studyInfo: { ...study.studyInfo, version: "replacement" },
  };
  expect(
    await parseAndStoreStudyFileAsync(JSON.stringify(replacement)),
  ).toBeNull();
  expect((await getStudyFileAsync()).studyInfo.version).toBe("replacement");
});

test("study identity changes preserve the existing enrollment namespace", async () => {
  expect(await parseAndStoreStudyFileAsync(rawStudy)).toBeNull();
  expect(
    await parseAndStoreStudyFileAsync(
      JSON.stringify({
        ...study,
        studyInfo: { ...study.studyInfo, id: "other-study" },
      }),
    ),
  ).not.toBeNull();
  expect((await getStudyFileAsync()).studyInfo.id).toBe(study.studyInfo.id);
});

afterEach(async () => {
  await clearCurrentStudyFileAsync();
});
