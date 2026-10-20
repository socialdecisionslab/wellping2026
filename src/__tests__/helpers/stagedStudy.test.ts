jest.mock("../../HomeScreen", () => "HomeScreen");
jest.mock("../../screens/LoginScreen", () => "LoginScreen");
import RootScreen from "../../RootScreen";
import { getPingsAsync } from "../../helpers/pings";
import { isJournalPingActiveAsync } from "../../helpers/dataJournal";
import { parseAndStoreStudyFileAsync } from "../../helpers/studyFile";
import {
  getTempStudyFileAsync,
  clearTempStudyFileAsync,
} from "../../helpers/asyncStorage/tempStudyFile";
jest.mock("../../helpers/pings", () => ({ getPingsAsync: jest.fn() }));
jest.mock("../../helpers/dataJournal", () => ({
  isJournalPingActiveAsync: jest.fn(),
}));
jest.mock("../../helpers/studyFile", () => ({
  parseAndStoreStudyFileAsync: jest.fn(),
}));
jest.mock("../../helpers/asyncStorage/tempStudyFile", () => ({
  getTempStudyFileAsync: jest.fn(),
  clearTempStudyFileAsync: jest.fn(),
}));
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getTempStudyFileAsync).mockResolvedValue("candidate");
  jest
    .mocked(getPingsAsync)
    .mockResolvedValue([{ id: "ping", endTime: null }] as any);
  jest.mocked(isJournalPingActiveAsync).mockResolvedValue(false);
});
function root() {
  const instance = new RootScreen({});
  instance.setState = jest.fn();
  return instance;
}
test("an active survey retains its originating study and staged update", async () => {
  jest.mocked(isJournalPingActiveAsync).mockResolvedValue(true);
  expect(await root().loadTempStudyFileAsync()).toBe(true);
  expect(parseAndStoreStudyFileAsync).not.toHaveBeenCalled();
  expect(clearTempStudyFileAsync).not.toHaveBeenCalled();
});
test.each([null, "Invalid update"])(
  "completed surveys apply a valid update and retain a failed candidate: %s",
  async (error) => {
    jest.mocked(parseAndStoreStudyFileAsync).mockResolvedValue(error);
    expect(await root().loadTempStudyFileAsync()).toBe(true);
    expect(parseAndStoreStudyFileAsync).toHaveBeenCalledWith("candidate");
    expect(clearTempStudyFileAsync).toHaveBeenCalledTimes(
      error === null ? 1 : 0,
    );
  },
);
test("expired surveys do not prevent later study updates", async () => {
  jest.mocked(parseAndStoreStudyFileAsync).mockResolvedValue(null);
  await root().loadTempStudyFileAsync();
  expect(isJournalPingActiveAsync).toHaveBeenCalledWith("ping");
  expect(parseAndStoreStudyFileAsync).toHaveBeenCalledWith("candidate");
});
test("unreadable active status retains the candidate and original configuration", async () => {
  jest.mocked(isJournalPingActiveAsync).mockRejectedValue(Error("disk"));
  await expect(root().loadTempStudyFileAsync()).rejects.toThrow("disk");
  expect(parseAndStoreStudyFileAsync).not.toHaveBeenCalled();
  expect(clearTempStudyFileAsync).not.toHaveBeenCalled();
});

test("an older active ping also defers updates when a newer ping is complete", async () => {
  jest.mocked(getPingsAsync).mockResolvedValue([
    { id: "older", endTime: null },
    { id: "newer", endTime: new Date() },
  ] as any);
  jest
    .mocked(isJournalPingActiveAsync)
    .mockImplementation(async (id) => id === "older");
  await root().loadTempStudyFileAsync();
  expect(parseAndStoreStudyFileAsync).not.toHaveBeenCalled();
  expect(clearTempStudyFileAsync).not.toHaveBeenCalled();
});
