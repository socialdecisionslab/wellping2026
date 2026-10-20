import React from "react";
import { render, waitFor, screen } from "@testing-library/react-native";
import RootScreen from "../RootScreen";
import {
  studyFileExistsAsync,
  getStudyFileAsync,
  parseAndStoreStudyFileAsync,
  downloadStudyFileAsync,
} from "../helpers/studyFile";
import { secureGetUserAsync } from "../helpers/secureStore/user";
import {
  getTempStudyFileAsync,
  storeTempStudyFileAsync,
} from "../helpers/asyncStorage/tempStudyFile";
import { isVerifiedPendingEnrollmentAsync } from "../helpers/failedEnrollment";
import { logoutAsync } from "../helpers/users";
import {
  getDataOwnerAsync,
  getVerifiedPendingLogoutAsync,
} from "../helpers/dataJournal";
jest.mock("../helpers/pings", () => ({
  getPingsAsync: jest.fn().mockResolvedValue([]),
}));
jest.mock("../helpers/dataJournal", () => ({
  getDataOwnerAsync: jest.fn(),
  getVerifiedPendingLogoutAsync: jest.fn().mockResolvedValue(null),
}));
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
  (getDataOwnerAsync as jest.Mock).mockResolvedValue({
    id: "original-owner",
    username: "synthetic",
    loginDate: 1,
  });
  (getVerifiedPendingLogoutAsync as jest.Mock).mockResolvedValue(null);
  (logoutAsync as jest.Mock).mockResolvedValue(undefined);
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
  root.setState = ((next: any, callback?: () => void) => {
    root.state = { ...root.state, ...next };
    callback?.();
  }) as any;
  await root.componentDidMount();
  expect(root.state.isLoading).toBe(false);
  expect(root.state.recoveryError).not.toBe(true);
  expect(root.state.userInfo).toBeNull();
  expect(logoutAsync).not.toHaveBeenCalled();
});

function rootInstance() {
  const root = new RootScreen({});
  root.setState = ((next: any, callback?: () => void) => {
    root.state = { ...root.state, ...next };
    callback?.();
  }) as any;
  return root;
}

test("background download stages using the owner captured before the network response", async () => {
  let respond!: (value: string) => void;
  (downloadStudyFileAsync as jest.Mock).mockReturnValueOnce(
    new Promise<string>((resolve) => {
      respond = resolve;
    }),
  );
  const attempt = rootInstance().downloadAndParseStudyFileAsync({
    url: study.studyInfo.studyFileURL,
    user: { username: "synthetic", password: "test-only", loginDate: 1 },
    isRedownload: true,
    handleNetworkErrorAsync: async () => {},
  });
  await Promise.resolve();
  (getDataOwnerAsync as jest.Mock).mockResolvedValue({ id: "new-owner" });
  respond("synthetic update");
  await expect(attempt).resolves.toBe(true);
  expect(storeTempStudyFileAsync).toHaveBeenCalledWith(
    "synthetic update",
    "original-owner",
  );
});

test("background refresh rejects stale credentials before downloading", async () => {
  await expect(
    rootInstance().downloadAndParseStudyFileAsync({
      url: study.studyInfo.studyFileURL,
      user: { username: "previous-user", password: "test-only", loginDate: 1 },
      isRedownload: true,
      handleNetworkErrorAsync: async () => {},
    }),
  ).rejects.toThrow(/different session/);
  expect(downloadStudyFileAsync).not.toHaveBeenCalled();
  expect(storeTempStudyFileAsync).not.toHaveBeenCalled();
});

test.each([false, true])(
  "verified logout resumes before missing credentials/configuration, config present: %s",
  async (configPresent) => {
    const owner = {
      id: "verified-owner",
      secureNamespace: "verified-namespace",
    };
    (getVerifiedPendingLogoutAsync as jest.Mock).mockResolvedValue(owner);
    (studyFileExistsAsync as jest.Mock).mockResolvedValue(configPresent);
    (secureGetUserAsync as jest.Mock).mockResolvedValue(null);
    const root = rootInstance();
    await root.componentDidMount();
    expect(logoutAsync).toHaveBeenCalledWith(owner);
    expect(studyFileExistsAsync).not.toHaveBeenCalled();
    expect(getStudyFileAsync).not.toHaveBeenCalled();
    expect(root.state.userInfo).toBeNull();
    expect(root.state.isLoading).toBe(false);
    expect(root.state.recoveryError).toBe(false);
  },
);

test("unverified logout receipt fails closed instead of deleting or showing login", async () => {
  (getVerifiedPendingLogoutAsync as jest.Mock).mockRejectedValueOnce(
    new Error("private damaged receipt"),
  );
  const root = rootInstance();
  await root.componentDidMount();
  expect(root.state.recoveryError).toBe(true);
  expect(logoutAsync).not.toHaveBeenCalled();
  expect(studyFileExistsAsync).not.toHaveBeenCalled();
});

test("interrupted logout retry remains recoverable and retries the captured owner", async () => {
  const owner = { id: "verified-owner", secureNamespace: "verified-namespace" };
  (getVerifiedPendingLogoutAsync as jest.Mock).mockResolvedValue(owner);
  (logoutAsync as jest.Mock).mockRejectedValueOnce(
    new Error("storage failure"),
  );
  const root = rootInstance();
  await root.componentDidMount();
  expect(root.state.recoveryError).toBe(true);
  await root.componentDidMount();
  expect(logoutAsync).toHaveBeenNthCalledWith(2, owner);
  expect(root.state.recoveryError).toBe(false);
  expect(root.state.isLoading).toBe(false);
});

test("logout commits a loading gate before draining and restores active UI on refusal", async () => {
  const root = rootInstance();
  const activeUser = {
    username: "synthetic",
    password: "test-only",
    loginDate: 1,
  };
  root.state = {
    ...root.state,
    isLoading: false,
    userInfo: activeUser,
    survey: study,
  };
  let committed!: () => void;
  root.setState = ((next: any, callback?: () => void) => {
    root.state = { ...root.state, ...next };
    if (callback) committed = callback;
  }) as any;
  (logoutAsync as jest.Mock).mockRejectedValueOnce(new Error("unsent data"));
  const attempt = root.logoutFnAsync();
  const rejected = expect(attempt).rejects.toThrow(/unsent/);
  expect(root.state.isLoggingOut).toBe(true);
  expect(logoutAsync).not.toHaveBeenCalled();
  committed();
  await rejected;
  expect(root.state.isLoggingOut).toBe(false);
  expect(root.state.userInfo).toEqual(activeUser);
  expect(root.state.survey).toEqual(study);
  expect(root.state.logoutError).toBe(true);
  expect(root.state.recoveryError).toBe(false);
});

test("logout failure after verified closure presents recovery instead of reopening input", async () => {
  const root = rootInstance();
  (getVerifiedPendingLogoutAsync as jest.Mock).mockResolvedValue({
    id: "closed-owner",
  });
  (logoutAsync as jest.Mock).mockRejectedValueOnce(
    new Error("teardown interrupted"),
  );
  await expect(root.logoutFnAsync()).rejects.toThrow();
  expect(root.state.isLoggingOut).toBe(false);
  expect(root.state.recoveryError).toBe(true);
});
