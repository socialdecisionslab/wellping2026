import React from "react";
import { Alert } from "react-native";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";

import LoginScreen from "../screens/LoginScreen";
import { completePendingEnrollmentAsync } from "../helpers/failedEnrollment";
import { getStudyFileAsync } from "../helpers/studyFile";
import { loginAsync, logoutAsync } from "../helpers/users";

jest.mock("../helpers/users", () => ({
  loginAsync: jest.fn(),
  logoutAsync: jest.fn().mockRejectedValue(new Error("NO_ACTIVE_OWNER")),
}));
jest.mock("../helpers/failedEnrollment", () => ({
  completePendingEnrollmentAsync: jest.fn(),
}));
jest.mock("../helpers/studyFile", () => ({ getStudyFileAsync: jest.fn() }));
jest.mock("expo-linking", () => ({
  parseInitialURLAsync: jest.fn().mockResolvedValue({}),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));

const study = require("../../local/debug/DEBUG_STUDY.json");

beforeEach(() => {
  jest.clearAllMocks();
  (getStudyFileAsync as jest.Mock).mockResolvedValue(study);
  (loginAsync as jest.Mock).mockResolvedValue(undefined);
  (completePendingEnrollmentAsync as jest.Mock).mockResolvedValue(undefined);
  jest.spyOn(LoginScreen.prototype, "confirmAgeAsync").mockResolvedValue(true);
  jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
});

async function showLogin(download = jest.fn().mockResolvedValue(true)) {
  const ref = React.createRef<LoginScreen>();
  render(
    <LoginScreen
      ref={ref}
      downloadAndParseStudyFileAsync={download}
      loggedInAsync={jest.fn()}
    />,
  );
  fireEvent.changeText(
    screen.getByPlaceholderText("Paste your login code here…"),
    "synthetic-synthetic",
  );
  await act(async () => {
    await ref.current!.loginFnAsync();
  });
  return { ref, download };
}

test("authentication rejection restores retry UI and never calls owner-gated logout", async () => {
  (loginAsync as jest.Mock).mockRejectedValue(
    new Error("private synthetic credential"),
  );
  const { ref } = await showLogin();
  expect(screen.getByText(/Unable to authenticate/)).toBeTruthy();
  expect(screen.queryByText(/Authenticating/)).toBeNull();
  expect(screen.queryByText(/private synthetic credential/)).toBeNull();
  expect(screen.getByRole("button", { name: "Log In" })).toBeEnabled();
  expect(logoutAsync).not.toHaveBeenCalled();
  expect(completePendingEnrollmentAsync).not.toHaveBeenCalled();
  await act(async () => {
    await ref.current!.loginFnAsync();
  });
  expect(loginAsync).toHaveBeenCalledTimes(2);
});

test.each(["download", "read", "completion"])(
  "a rejected %s operation cannot leave a loading dead end",
  async (stage) => {
    const download = jest.fn().mockResolvedValue(true);
    if (stage === "download") download.mockRejectedValue(new Error("private"));
    if (stage === "read")
      (getStudyFileAsync as jest.Mock).mockRejectedValueOnce(
        new Error("private"),
      );
    if (stage === "completion")
      (completePendingEnrollmentAsync as jest.Mock).mockRejectedValueOnce(
        new Error("private"),
      );
    await showLogin(download);
    expect(screen.getByText(/Unable to authenticate/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log In" })).toBeEnabled();
    expect(screen.queryByText(/Loading study data|Authenticating/)).toBeNull();
    expect(logoutAsync).not.toHaveBeenCalled();
  },
);

test("network failure restores retry UI without authenticating or completing enrollment", async () => {
  const download = jest
    .fn()
    .mockImplementation(async ({ handleNetworkErrorAsync }) => {
      await handleNetworkErrorAsync(
        "Synthetic connection unavailable. Try again.",
      );
      return false;
    });
  await showLogin(download);
  expect(screen.getByText(/Synthetic connection unavailable/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Log In" })).toBeEnabled();
  expect(loginAsync).not.toHaveBeenCalled();
  expect(completePendingEnrollmentAsync).not.toHaveBeenCalled();
  expect(logoutAsync).not.toHaveBeenCalled();
});

test("successful authentication completes the receipt before displaying success", async () => {
  await showLogin();
  await waitFor(() => expect(screen.getByText("Logged in!")).toBeTruthy());
  expect(completePendingEnrollmentAsync).toHaveBeenCalledTimes(1);
  expect((loginAsync as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
    (completePendingEnrollmentAsync as jest.Mock).mock.invocationCallOrder[0],
  );
  expect(Alert.alert).toHaveBeenCalledWith(
    "Welcome to Well Ping!",
    expect.any(String),
    expect.any(Array),
    { cancelable: false },
  );
  expect(logoutAsync).not.toHaveBeenCalled();
});
