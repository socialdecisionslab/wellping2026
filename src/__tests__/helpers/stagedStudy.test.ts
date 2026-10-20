jest.mock("../../HomeScreen", () => "HomeScreen");
jest.mock("../../screens/LoginScreen", () => "LoginScreen");
import RootScreen from "../../RootScreen";
import { getLatestPingAsync } from "../../helpers/pings";
import { getCurrentNotificationTimeAsync } from "../../helpers/notifications";
import {
  getTempStudyFileAsync,
  clearTempStudyFileAsync,
} from "../../helpers/asyncStorage/tempStudyFile";

jest.mock("../../helpers/pings", () => ({ getLatestPingAsync: jest.fn() }));
jest.mock("../../helpers/notifications", () => ({
  getCurrentNotificationTimeAsync: jest.fn(),
}));
jest.mock("../../helpers/asyncStorage/tempStudyFile", () => ({
  getTempStudyFileAsync: jest.fn(),
  clearTempStudyFileAsync: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  (getTempStudyFileAsync as jest.Mock).mockResolvedValue("candidate");
});
test("an active survey retains its originating study and staged update", async () => {
  const time = new Date();
  (getLatestPingAsync as jest.Mock).mockResolvedValue({
    notificationTime: time,
    endTime: null,
  });
  (getCurrentNotificationTimeAsync as jest.Mock).mockResolvedValue(time);
  const root = new RootScreen({});
  const parse = jest.spyOn(root, "parseStudyFileAsync");
  expect(await root.loadTempStudyFileAsync()).toBe(true);
  expect(parse).not.toHaveBeenCalled();
  expect(clearTempStudyFileAsync).not.toHaveBeenCalled();
});
test.each([true, false])(
  "completed surveys consume the candidate after parse result %s",
  async (result) => {
    (getLatestPingAsync as jest.Mock).mockResolvedValue({
      endTime: new Date(),
    });
    const root = new RootScreen({});
    jest.spyOn(root, "parseStudyFileAsync").mockResolvedValue(result);
    expect(await root.loadTempStudyFileAsync()).toBe(result);
    expect(clearTempStudyFileAsync).toHaveBeenCalledTimes(1);
  },
);
test("expired surveys do not prevent later study updates", async () => {
  (getLatestPingAsync as jest.Mock).mockResolvedValue({
    notificationTime: new Date(0),
    endTime: null,
  });
  (getCurrentNotificationTimeAsync as jest.Mock).mockResolvedValue(null);
  const root = new RootScreen({});
  const parse = jest.spyOn(root, "parseStudyFileAsync").mockResolvedValue(true);
  await root.loadTempStudyFileAsync();
  expect(parse).toHaveBeenCalledWith("candidate");
});
