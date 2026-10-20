import { StudyInfo } from "@wellping/study-schemas/lib/types";

import {
  beiweLoginAsync,
  beiweUploadDataForUserAsync,
} from "../../helpers/beiwe";
import { withDataJournalLockAsync } from "../../helpers/dataJournal";
import { AllData } from "../../helpers/dataUploadType";
import { getHashedPasswordAsync } from "../../helpers/helpers";
import { secureGetUserAsync } from "../../helpers/secureStore/user";
import { getStudyInfoAsync } from "../../helpers/studyFile";

jest.mock("../../helpers/studyFile", () => ({ getStudyInfoAsync: jest.fn() }));
jest.mock("../../helpers/secureStore/user", () => ({
  secureGetUserAsync: jest.fn(),
}));
jest.mock("../../helpers/loginSession", () => ({
  getLoginSessionIDAsync: async (user: {
    username: string;
    loginDate: number;
  }) => `${user.username}-synthetic-installation-${user.loginDate}`,
}));
jest.mock("../../helpers/helpers", () => ({
  getHashedPasswordAsync: jest.fn(),
  base64ToBase64URL: (value: string) =>
    value.replace(/\+/g, "-").replace(/\//g, "_"),
}));
jest.mock("../../helpers/debug", () => ({
  JS_VERSION_NUMBER: "synthetic",
  HOME_SCREEN_DEBUG_VIEW_SYMBOLS: {},
}));

jest.mock("../../../config/release", () => ({ RELEASE: undefined }));

describe.each([false, true])("Beiwe upload release v1: %s", (v1) => {
  const study: StudyInfo = {
    ...require("../../../local/debug/DEBUG_STUDY.json").studyInfo,
    server: { beiwe: { serverUrl: "https://synthetic-study.invalid" } },
  };
  const user = {
    username: "synthetic",
    password: "synthetic-only",
    loginDate: 1000,
  };
  const data: AllData = {
    user: {
      username: user.username,
      loginSessionId: "synthetic-synthetic-installation-1000",
      installation: {} as AllData["user"]["installation"],
    },
    receipt: "synthetic-receipt",
    pings: [],
    answers: [],
  };
  let currentStudy: StudyInfo;
  let currentUser: typeof user | null;
  let fetchMock: jest.SpyInstance;
  const start = jest.fn();
  const end = jest.fn();
  const upload = (payload = data) =>
    beiweUploadDataForUserAsync(payload, user, start, end, study);

  const responseData = () =>
    v1
      ? { protocol: "wellping-v1", receipt: data.receipt, enrolled: true }
      : { new_pings_count: 0, new_answers_count: 0 };
  const response = () =>
    ({
      status: 200,
      json: async () => responseData(),
      text: async () => JSON.stringify(responseData()),
      headers: { get: () => "application/json" },
    } as unknown as Response);
  const sentData = () => {
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    return v1 ? body.payload : body;
  };
  beforeEach(() => {
    jest.clearAllMocks();
    require("../../../config/release").RELEASE = v1
      ? { beiweUrl: study.server.beiwe!.serverUrl }
      : undefined;
    currentStudy = JSON.parse(JSON.stringify(study));
    currentUser = { ...user };
    (getStudyInfoAsync as jest.Mock).mockImplementation(
      async () => currentStudy,
    );
    (secureGetUserAsync as jest.Mock).mockImplementation(
      async () => currentUser,
    );
    (getHashedPasswordAsync as jest.Mock).mockResolvedValue("synthetic+hash/");
    fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(response());
  });

  test("uses captured destination and session without changing the legacy server contract", async () => {
    await expect(upload()).resolves.toEqual(responseData());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      v1
        ? "https://synthetic-study.invalid/wellping/v1/upload"
        : "https://synthetic-study.invalid/ssnl_upload?password=synthetic-hash_&device_id=synthetic-synthetic-installation-1000&username=synthetic&patient_id=synthetic",
    );
    expect(options.method).toBe("POST");
    expect(options.redirect).toBe("error");
    expect(sentData()).toEqual(data);
    expect(start).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledWith();
  });

  test.each([
    [
      "study",
      () => {
        currentStudy = { ...currentStudy, id: "other" };
      },
    ],
    [
      "server",
      () => {
        currentStudy.server.beiwe!.serverUrl = "https://other.invalid";
      },
    ],
    [
      "session",
      () => {
        currentUser = { ...user, loginDate: 2000 };
      },
    ],
    [
      "logout",
      () => {
        currentUser = null;
      },
    ],
  ])(
    "rejects a changed %s during password hashing instead of sending to either destination",
    async (_label, change) => {
      (getHashedPasswordAsync as jest.Mock).mockImplementationOnce(async () => {
        await Promise.resolve();
        change();
        return "synthetic-hash";
      });
      await expect(upload()).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(end).toHaveBeenCalledWith("BW: upload failed");
    },
  );

  test("rejects stale prefetched data before contacting the server", async () => {
    await expect(
      upload({
        ...data,
        user: { ...data.user, loginSessionId: "different-session" },
      }),
    ).rejects.toThrow("session changed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("caller mutation while hashing cannot retarget or rewrite a captured upload", async () => {
    const mutableData = JSON.parse(JSON.stringify(data));
    const mutableStudy = JSON.parse(JSON.stringify(study));
    const mutableUser = { ...user };
    (getHashedPasswordAsync as jest.Mock).mockImplementationOnce(async () => {
      mutableData.user.username = "changed";
      mutableStudy.server.beiwe.serverUrl = "https://changed.invalid";
      mutableUser.username = "changed";
      return "synthetic-hash";
    });
    await beiweUploadDataForUserAsync(
      mutableData,
      mutableUser,
      start,
      end,
      mutableStudy,
    );
    expect(fetchMock.mock.calls[0][0]).toMatch(
      /^https:\/\/synthetic-study\.invalid\//,
    );
    expect(sentData()).toEqual(data);
  });

  test("a session switch while the server responds does not report successful acknowledgement", async () => {
    fetchMock.mockImplementationOnce(async () => {
      currentUser = { ...user, loginDate: 2000 };
      return response();
    });
    await expect(upload()).rejects.toThrow("session changed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledWith("BW: upload failed");
  });

  test("an inaccessible current study fails closed without any network request", async () => {
    (getStudyInfoAsync as jest.Mock).mockRejectedValueOnce(
      new Error("Synthetic storage failure"),
    );
    await expect(upload()).rejects.toThrow("storage failure");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("registration remains possible before the secure login is stored", async () => {
    currentUser = null;
    await beiweLoginAsync(user);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain(
      v1 ? "/wellping/v1/enroll" : "/register_user",
    );
    if (v1)
      expect(sentData()).toEqual({
        device_os: expect.anything(),
        os_version: expect.anything(),
      });
    else expect(sentData()).toEqual({});
  });

  test("the final destination check is serialized with study changes but the response is not", async () => {
    let guardStarted!: () => void;
    const guarding = new Promise<void>((resolve) => {
      guardStarted = resolve;
    });
    let releaseGuard!: () => void;
    const pausedGuard = new Promise<void>((resolve) => {
      releaseGuard = resolve;
    });
    let releaseNetwork!: (value: Response) => void;
    const network = new Promise<Response>((resolve) => {
      releaseNetwork = resolve;
    });
    let reads = 0;
    const order: string[] = [];
    (secureGetUserAsync as jest.Mock).mockImplementation(async () => {
      if (++reads === 2) {
        guardStarted();
        await pausedGuard;
      }
      return currentUser;
    });
    fetchMock.mockImplementationOnce(() => {
      order.push("send");
      return network;
    });
    const uploading = upload();
    const rejected = expect(uploading).rejects.toThrow("destination changed");
    await guarding;
    const switched = withDataJournalLockAsync(async () => {
      order.push("switch");
      currentStudy.server.beiwe!.serverUrl = "https://other.invalid";
    });
    releaseGuard();
    await switched;
    expect(order).toEqual(["send", "switch"]);
    expect(fetchMock.mock.calls[0][0]).toMatch(
      /^https:\/\/synthetic-study\.invalid\//,
    );
    expect(end).not.toHaveBeenCalled();
    releaseNetwork(response());
    await rejected;
  });
});
