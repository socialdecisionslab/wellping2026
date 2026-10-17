import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

import LocalApp from "../../local/LocalApp";
import { openSyntheticSession } from "../../local/session";
import { getAnswersAsync } from "../helpers/answers";
import { getPingsAsync } from "../helpers/pings";

jest.mock("../../config/local", () => ({
  IS_LOCAL_DEVELOPMENT: true,
  LOCAL_STORAGE_PREFIX: "LOCAL_ONLY:",
}));
jest.mock("react-native-safe-area-context", () => {
  const { View } = require("react-native");
  return { SafeAreaProvider: View, SafeAreaView: View };
});
jest.mock("../helpers/firebase", () => ({
  validateAndInitializeFirebaseWithConfig: () => {
    throw new Error("Unexpected backend initialization");
  },
}));
jest.mock("expo-notifications", () => ({
  scheduleNotificationAsync: jest.fn(),
}));

const productionKeys = [
  "currentStudyFile_StudyInfo",
  "currentStudyFile_Streams",
  "currentStudyFile_ExtraData",
  "@WELLPING:InstallationID",
];
const originalFetch = global.fetch;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  for (const key of productionKeys)
    await AsyncStorage.setItem(key, "synthetic production sentinel");
  global.fetch = jest
    .fn()
    .mockRejectedValue(new Error("Unexpected network request"));
  (Notifications.scheduleNotificationAsync as jest.Mock).mockClear();
});

afterEach(async () => {
  expect(global.fetch).not.toHaveBeenCalled();
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  for (const [key] of [
    ...(SecureStore.setItemAsync as jest.Mock).mock.calls,
    ...(SecureStore.deleteItemAsync as jest.Mock).mock.calls,
  ]) {
    expect(key).toMatch(/^WELLPING_LOCAL-/);
  }
  for (const key of productionKeys) {
    expect(await AsyncStorage.getItem(key)).toBe(
      "synthetic production sentinel",
    );
  }
  global.fetch = originalFetch;
});

test("can reopen a new synthetic session before its screen has mounted", async () => {
  const first = await openSyntheticSession();
  const reopened = await openSyntheticSession();
  expect(reopened.ping.id).toBe(first.ping.id);
  expect(reopened.previousState?.currentQuestionData.questionId).toBe("color");
});

test("completes the real survey renderer locally and reopens saved completion", async () => {
  let screen = render(<LocalApp initialQuestionnaire="quick" />);
  const blue = await screen.findByLabelText("select Blue");
  fireEvent.press(blue);
  await waitFor(() =>
    expect(screen.getByLabelText("Next question")).not.toBeDisabled(),
  );
  fireEvent.press(screen.getByLabelText("Next question"));
  await screen.findByText("Local test: move the slider, then finish.");
  fireEvent.press(
    screen.getByLabelText("Prefer not to answer the current question"),
  );
  await screen.findByText("Saved on this test device. No data uploaded.");
  const answers = await getAnswersAsync();
  expect(answers).toHaveLength(2);
  expect(answers[0].data).toEqual({ value: "Blue" });
  expect(answers[1].preferNotToAnswer).toBe(true);
  screen.unmount();

  screen = render(<LocalApp initialQuestionnaire="quick" />);
  await screen.findByText("Saved on this test device. No data uploaded.");
  expect(await getAnswersAsync()).toEqual(answers);
  fireEvent.press(screen.getByText("Start another test survey"));
  await screen.findByText("Local test: choose a color.");
  expect(await getPingsAsync()).toHaveLength(2);
  expect(await getAnswersAsync()).toEqual(answers);
  screen.unmount();
});

test("resumes an unfinished survey from its saved question", async () => {
  let screen = render(<LocalApp initialQuestionnaire="quick" />);
  fireEvent.press(await screen.findByLabelText("select Green"));
  await waitFor(() =>
    expect(screen.getByLabelText("Next question")).not.toBeDisabled(),
  );
  fireEvent.press(screen.getByLabelText("Next question"));
  await screen.findByText("Local test: move the slider, then finish.");
  // Wait for the existing survey's asynchronous progress persistence.
  await waitFor(async () =>
    expect(
      (
        await openSyntheticSession()
      ).previousState?.currentQuestionData.questionId,
    ).toBe("rating"),
  );
  screen.unmount();
  screen = render(<LocalApp initialQuestionnaire="quick" />);
  await screen.findByText("Local test: move the slider, then finish.");
  expect((await getAnswersAsync())[0].data).toEqual({ value: "Green" });
  screen.unmount();
});

test("existing questionnaire preserves questions and resumes separately from the quick test", async () => {
  const original = require("../../local/debug/DEBUG_STUDY.json");
  const { getLocalFixture } = require("../../local/fixtures");
  const fixture = getLocalFixture("existing");
  expect(fixture.streams.myStream).toEqual(original.streams.myStream);
  expect(Object.keys(fixture.streams.myStream)).toHaveLength(16);
  expect(fixture.studyInfo.server).toEqual({});
  expect(fixture.studyInfo.dashboardURL).toBeUndefined();
  expect(fixture.studyInfo.consentFormUrl).toBe(
    "https://example.invalid/consent",
  );
  const existing = await openSyntheticSession(false, "existing");
  expect(existing.streamName).toBe("myStream");
  const quick = await openSyntheticSession(false, "quick");
  expect(quick.streamName).toBe("synthetic");
  const reopened = await openSyntheticSession(false, "existing");
  expect(reopened.ping.id).toBe(existing.ping.id);
  expect(reopened.previousState?.currentQuestionData.questionId).toBe(
    "SocInteraction_Names",
  );
  const screen = render(<LocalApp />);
  await screen.findByLabelText("Prefer not to answer the current question");
  expect(screen.getByText("Switch to quick test")).toBeTruthy();
});
