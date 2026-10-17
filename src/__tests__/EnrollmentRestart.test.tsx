import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Alert } from "react-native";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";

import RootScreen from "../RootScreen";
import LoginScreen from "../screens/LoginScreen";
import { preparePendingEnrollmentAsync } from "../helpers/failedEnrollment";
import { storeCurrentStudyFileAsync } from "../helpers/asyncStorage/studyFile";
import { secureStoreUserAsync } from "../helpers/secureStore/user";
import { downloadStudyFileAsync } from "../helpers/studyFile";
import { loginAsync, logoutAsync } from "../helpers/users";

jest.mock("../HomeScreen", () => () => {
  const React = require("react");
  const { Text } = require("react-native");
  return React.createElement(Text, {}, "Synthetic study home");
});
jest.mock("../helpers/studyFile", () => ({
  ...jest.requireActual("../helpers/studyFile"),
  downloadStudyFileAsync: jest.fn(),
}));
jest.mock("../helpers/users", () => ({
  loginAsync: jest.fn(),
  logoutAsync: jest.fn(),
}));
jest.mock("../helpers/firebase", () => ({
  validateAndInitializeFirebaseWithConfig: jest.fn(),
}));
jest.mock("expo-linking", () => ({
  parseInitialURLAsync: jest.fn().mockResolvedValue({}),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));

const study = require("../../local/debug/DEBUG_STUDY.json");

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  (SecureStore as any).__INTERNAL_MOCK_STORAGE__ = {};
  (downloadStudyFileAsync as jest.Mock).mockResolvedValue(
    JSON.stringify(study),
  );
  (loginAsync as jest.Mock).mockRejectedValue(
    new Error("Synthetic authentication rejection"),
  );
  jest.spyOn(LoginScreen.prototype, "confirmAgeAsync").mockResolvedValue(true);
  jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
});

async function attemptLogin() {
  await waitFor(() =>
    expect(screen.getByText("Welcome to Well Ping!")).toBeTruthy(),
  );
  fireEvent.changeText(
    screen.getByPlaceholderText("Paste your login code here…"),
    "synthetic-synthetic",
  );
  await act(async () => {
    await fireEvent.press(screen.getByRole("button", { name: "Log In" }));
  });
}

test("failed fresh authentication remains retryable after a Root restart and success clears its receipt", async () => {
  const first = render(<RootScreen />);
  await attemptLogin();
  await waitFor(() =>
    expect(screen.getByText(/Unable to authenticate/)).toBeTruthy(),
  );
  expect(await AsyncStorage.getItem("pendingEnrollment.v1")).not.toBeNull();
  expect(logoutAsync).not.toHaveBeenCalled();
  first.unmount();

  const restarted = render(<RootScreen />);
  await waitFor(() =>
    expect(screen.getByText("Welcome to Well Ping!")).toBeTruthy(),
  );
  expect(screen.queryByText(/Saved study data needs recovery/)).toBeNull();
  expect(downloadStudyFileAsync).toHaveBeenCalledTimes(1);
  (loginAsync as jest.Mock).mockImplementation(secureStoreUserAsync);
  await attemptLogin();
  await waitFor(() => expect(screen.getByText("Logged in!")).toBeTruthy());
  expect(await AsyncStorage.getItem("pendingEnrollment.v1")).toBeNull();
  expect(logoutAsync).not.toHaveBeenCalled();
  restarted.unmount();

  render(<RootScreen />);
  await waitFor(() =>
    expect(screen.getByText("Synthetic study home")).toBeTruthy(),
  );
  expect(screen.queryByText(/Saved study data needs recovery/)).toBeNull();
});

test.each([false, true])(
  "saved study with unknown research data stays recovery-only, pending receipt: %s",
  async (receipt) => {
    if (receipt) await preparePendingEnrollmentAsync(study);
    await storeCurrentStudyFileAsync(study);
    const historical = `@WELLPING:Study_${study.studyInfo.id}/dataJournal.v1.owners`;
    await AsyncStorage.setItem(historical, "synthetic historical data");
    render(<RootScreen />);
    await waitFor(() =>
      expect(screen.getByText(/Saved study data needs recovery/)).toBeTruthy(),
    );
    expect(screen.queryByText("Welcome to Well Ping!")).toBeNull();
    expect(await AsyncStorage.getItem(historical)).toBe(
      "synthetic historical data",
    );
    expect(logoutAsync).not.toHaveBeenCalled();
    expect(downloadStudyFileAsync).not.toHaveBeenCalled();
  },
);
