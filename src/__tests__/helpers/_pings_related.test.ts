import * as userStore from "../../helpers/secureStore/user";
import { notificationsTest } from "./notifications.parttest";
import { pingsTest } from "./pings.parttest";

// All record access requires an authenticated, fixed synthetic participant session.
beforeEach(() => {
  jest.spyOn(userStore, "secureGetUserAsync").mockResolvedValue({
    username: "defaultusername",
    password: "synthetic-only",
    loginDate: 1,
  });
});

// https://github.com/facebook/jest/issues/6194#issuecomment-419837314
describe("pings", pingsTest);
describe("notifications", notificationsTest);
