import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { setupNotificationsPermissionAsync } from "../../helpers/notifications";

jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  AndroidImportance: { HIGH: 4 },
  AndroidNotificationVisibility: { PUBLIC: 1 },
}));

test.each([true, false])(
  "Android creates the channel before requesting permission (granted=%s)",
  async (granted) => {
    jest.replaceProperty(Platform, "OS", "android");
    const events: string[] = [];
    (Notifications.setNotificationChannelAsync as jest.Mock).mockImplementation(
      async () => {
        events.push("channel");
      },
    );
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: false,
    });
    (Notifications.requestPermissionsAsync as jest.Mock).mockImplementation(
      async () => {
        events.push("permission");
        return { granted };
      },
    );
    expect(await setupNotificationsPermissionAsync()).toBe(granted);
    expect(events).toEqual(["channel", "permission"]);
  },
);
