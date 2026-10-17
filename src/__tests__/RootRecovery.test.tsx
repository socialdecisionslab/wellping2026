import React from "react";
import { render, waitFor, screen } from "@testing-library/react-native";
import RootScreen from "../RootScreen";
import {
  studyFileExistsAsync,
  getStudyFileAsync,
  parseAndStoreStudyFileAsync,
} from "../helpers/studyFile";
import { secureGetUserAsync } from "../helpers/secureStore/user";
import { getTempStudyFileAsync } from "../helpers/asyncStorage/tempStudyFile";
import { isVerifiedPendingEnrollmentAsync } from "../helpers/failedEnrollment";
import { logoutAsync } from "../helpers/users";
jest.mock("../helpers/failedEnrollment", () => ({
  completePendingEnrollmentAsync: jest.fn().mockResolvedValue(undefined),
  isVerifiedPendingEnrollmentAsync: jest.fn().mockResolvedValue(false),
}));
jest.mock("../HomeScreen", () => () => null);
jest.mock("../screens/LoginScreen", () => () => null);
jest.mock("../helpers/studyFile", () => ({
  studyFileExistsAsync: jest.fn(),
  getStudyFileAsync: jest.fn(),
  parseAndStoreStudyFileAsync: jest.fn(),
  downloadStudyFileAsync: jest.fn().mockRejectedValue(new Error("offline")),
}));
jest.mock("../helpers/secureStore/user", () => ({
  secureGetUserAsync: jest.fn(),
}));
jest.mock("../helpers/asyncStorage/tempStudyFile", () => ({
  getTempStudyFileAsync: jest.fn(),
  clearTempStudyFileAsync: jest.fn(),
  storeTempStudyFileAsync: jest.fn(),
}));
jest.mock("../helpers/users", () => ({ logoutAsync: jest.fn() }));
jest.mock("../helpers/firebase", () => ({
  validateAndInitializeFirebaseWithConfig: jest.fn(),
}));
const study = require("../../local/debug/DEBUG_STUDY.json");
beforeEach(() => {
  jest.clearAllMocks();
  (studyFileExistsAsync as jest.Mock).mockResolvedValue(true);
  (getStudyFileAsync as jest.Mock).mockResolvedValue(study);
  (getTempStudyFileAsync as jest.Mock).mockResolvedValue(null);
  (secureGetUserAsync as jest.Mock).mockResolvedValue({
    username: "synthetic",
    password: "synthetic",
    loginDate: 1,
  });
});
test("unreadable saved configuration shows recovery without logout", async () => {
  (studyFileExistsAsync as jest.Mock).mockRejectedValue(
    new Error("private contents"),
  );
  render(<RootScreen />);
  await waitFor(() =>
    expect(screen.getByText(/Saved study data needs recovery/)).toBeTruthy(),
  );
  expect(logoutAsync).not.toHaveBeenCalled();
  expect(screen.queryByText(/private contents/)).toBeNull();
});
test("missing credentials never trigger reinstall advice or deletion", async () => {
  (secureGetUserAsync as jest.Mock).mockResolvedValue(null);
  render(<RootScreen />);
  await waitFor(() =>
    expect(screen.getByText(/Saved study data needs recovery/)).toBeTruthy(),
  );
  expect(logoutAsync).not.toHaveBeenCalled();
});
test("rejected pending update retains current study with a visible warning", async () => {
  (getTempStudyFileAsync as jest.Mock).mockResolvedValue("{broken");
  (parseAndStoreStudyFileAsync as jest.Mock).mockResolvedValue("invalid");
  render(<RootScreen />);
  await waitFor(() =>
    expect(
      screen.getByText(/A study update could not be applied/),
    ).toBeTruthy(),
  );
  expect(logoutAsync).not.toHaveBeenCalled();
});

test("verified pending enrollment returns to login instead of recovery", async () => {
  (secureGetUserAsync as jest.Mock).mockResolvedValue(null);
  (isVerifiedPendingEnrollmentAsync as jest.Mock).mockResolvedValueOnce(true);
  const root = new RootScreen({});
  root.setState = ((next: any) => {
    root.state = { ...root.state, ...next };
  }) as any;
  await root.componentDidMount();
  expect(root.state.isLoading).toBe(false);
  expect(root.state.recoveryError).not.toBe(true);
  expect(root.state.userInfo).toBeNull();
  expect(logoutAsync).not.toHaveBeenCalled();
});
