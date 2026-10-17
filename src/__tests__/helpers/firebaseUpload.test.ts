import { StudyInfo } from "@wellping/study-schemas/lib/types";
import { getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase, get, ref, update } from "firebase/database";

import { withDataJournalLockAsync } from "../../helpers/dataJournal";
import { AllData, UnuploadedData } from "../../helpers/dataUploadType";
import {
  firebaseUploadDataForUserAsync,
  validateAndInitializeFirebaseWithConfig,
} from "../../helpers/firebase";
import { secureGetUserAsync } from "../../helpers/secureStore/user";
import { getStudyInfoAsync } from "../../helpers/studyFile";

// No real SDK initialization, credentials, network, or backend is used here.
jest.mock("firebase/app", () => ({
  getApp: jest.fn(),
  initializeApp: jest.fn(),
}));
jest.mock("firebase/auth", () => ({ getAuth: jest.fn() }));
jest.mock("firebase/database", () => ({
  getDatabase: jest.fn(),
  ref: jest.fn(),
  get: jest.fn(),
  update: jest.fn(),
  set: jest.fn(() => {
    throw new Error("Root replacement is forbidden");
  }),
  push: jest.fn(() => {
    throw new Error("Random retry keys are forbidden");
  }),
}));
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
jest.mock("../../helpers/debug", () => ({
  HOME_SCREEN_DEBUG_VIEW_SYMBOLS: {},
}));

const study: StudyInfo = {
  ...require("../../../local/debug/DEBUG_STUDY.json").studyInfo,
  server: {
    firebase: {
      config: {
        apiKey: "synthetic-not-a-key",
        projectId: "synthetic-project",
        appId: "synthetic-app",
        databaseURL: "https://synthetic-project.invalid",
      },
    },
  },
};
const localUser = {
  username: "synthetic",
  password: "synthetic-only",
  loginDate: 1000,
};
const sessionId = "synthetic-synthetic-installation-1000";
const data: AllData = {
  user: {
    username: localUser.username,
    loginSessionId: sessionId,
    installation: {} as AllData["user"]["installation"],
  },
  pings: [
    {
      id: "mood0",
      notificationTime: new Date("2026-10-01T09:00:00Z"),
      startTime: new Date("2026-10-01T09:01:00Z"),
      endTime: null,
      tzOffset: 0,
      streamName: "mood",
    },
  ],
  answers: [
    {
      pingId: "mood0",
      questionId: "question[__PLACEHOLDER__]",
      date: new Date("2026-10-01T09:02:00Z"),
      data: { value: 1 },
      preferNotToAnswer: null,
    },
  ],
};
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
let remote: Record<string, any>;
let app: any;
let auth: any;
let currentStudy: StudyInfo;
let currentLocalUser: typeof localUser | null;
const start = jest.fn();
const end = jest.fn();

function snapshot(value: any): any {
  const saved = plain(value);
  return {
    val: () => saved,
    exists: () => saved !== null,
    child: (key: string) => snapshot(saved?.[key] ?? null),
    size: saved && typeof saved === "object" ? Object.keys(saved).length : 0,
  };
}
function applyUpdate(updates: Record<string, any>): void {
  const next = plain(remote);
  for (const [path, value] of Object.entries(updates)) {
    const [collection, key] = path.split("/");
    if (key) (next[collection] ||= {})[key] = plain(value);
    else next[collection] = plain(value);
  }
  remote = next;
}
const upload = (payload: AllData | UnuploadedData = data) =>
  firebaseUploadDataForUserAsync(payload, localUser, start, end, study);

beforeEach(() => {
  jest.clearAllMocks();
  remote = {};
  currentStudy = plain(study);
  currentLocalUser = { ...localUser };
  app = { options: { ...study.server.firebase!.config } };
  auth = {
    currentUser: {
      uid: "synthetic-uid",
      email: "synthetic@user.wellpingssnl",
      emailVerified: true,
    },
  };
  (getApp as jest.Mock).mockImplementation(() => app);
  (getAuth as jest.Mock).mockImplementation(() => auth);
  (getDatabase as jest.Mock).mockReturnValue({ app });
  (ref as jest.Mock).mockImplementation((_db, path) => ({ path }));
  (get as jest.Mock).mockImplementation(async () => snapshot(remote));
  (update as jest.Mock).mockImplementation(async (_root, updates) =>
    applyUpdate(updates),
  );
  (getStudyInfoAsync as jest.Mock).mockImplementation(async () => currentStudy);
  (secureGetUserAsync as jest.Mock).mockImplementation(
    async () => currentLocalUser,
  );
});

test("full and incremental retries use stable logical keys and one atomic child-path update", async () => {
  expect(await upload()).toEqual({ new_pings_count: 1, new_answers_count: 1 });
  const first = plain(remote);
  const incremental: UnuploadedData = {
    user: data.user,
    unuploadedPings: data.pings,
    unuploadedAnswers: data.answers,
  };
  expect(await upload(incremental)).toEqual({
    new_pings_count: 1,
    new_answers_count: 1,
  });
  expect(remote).toEqual(first);
  expect(update).toHaveBeenCalledTimes(2);
  expect(Object.keys((update as jest.Mock).mock.calls[0][1]).sort()).toEqual([
    expect.stringMatching(/^answers\/v1_[a-f0-9]{64}$/),
    expect.stringMatching(/^pings\/v1_[a-f0-9]{64}$/),
    "user",
  ]);
  expect((update as jest.Mock).mock.calls[0][0].path).toBe(
    `users/synthetic-uid/${sessionId}/`,
  );
  expect(getDatabase).toHaveBeenCalledWith(
    app,
    study.server.firebase!.config.databaseURL,
  );
  expect(start).toHaveBeenCalledTimes(2);
  expect(end).toHaveBeenNthCalledWith(1);
  expect(end).toHaveBeenNthCalledWith(2);
});

test("reuses legacy push keys and preserves remote-only records and root metadata", async () => {
  remote = {
    user: plain(data.user),
    pings: {
      "-oldPing": { ...plain(data.pings[0]), endTime: "earlier" },
      "-remotePing": { id: "remoteOnly" },
    },
    answers: {
      "-oldAnswer": { ...plain(data.answers[0]), data: { value: 0 } },
      "-remoteAnswer": { pingId: "remoteOnly", questionId: "other" },
    },
    staffNote: "untouched",
  };
  await upload();
  expect(Object.keys(remote.pings).sort()).toEqual(["-oldPing", "-remotePing"]);
  expect(Object.keys(remote.answers).sort()).toEqual([
    "-oldAnswer",
    "-remoteAnswer",
  ]);
  expect(remote.pings["-oldPing"]).toEqual(plain(data.pings[0]));
  expect(remote.answers["-oldAnswer"]).toEqual(plain(data.answers[0]));
  expect(remote.staffNote).toBe("untouched");
});

test("a remote-only write arriving after the read is not overwritten", async () => {
  (update as jest.Mock).mockImplementationOnce(async (_root, updates) => {
    remote.pings = { "-concurrent": { id: "concurrent" } };
    remote.answers = {
      "-concurrent": { pingId: "concurrent", questionId: "q" },
    };
    remote.staffNote = "arrived during upload";
    applyUpdate(updates);
  });
  expect(await upload()).toEqual({ new_pings_count: 2, new_answers_count: 2 });
  expect(remote.pings["-concurrent"]).toEqual({ id: "concurrent" });
  expect(remote.staffNote).toBe("arrived during upload");
});

test("a committed write with a lost acknowledgement is safe to retry", async () => {
  (update as jest.Mock).mockImplementationOnce(async (_root, updates) => {
    applyUpdate(updates);
    throw new Error("Synthetic lost acknowledgement");
  });
  await expect(upload()).rejects.toThrow("lost acknowledgement");
  const committed = plain(remote);
  await upload();
  expect(remote).toEqual(committed);
  expect(Object.keys(remote.pings)).toHaveLength(1);
  expect(Object.keys(remote.answers)).toHaveLength(1);
});

test("a failed post-write verification is safe to retry", async () => {
  (get as jest.Mock)
    .mockImplementationOnce(async () => snapshot(remote))
    .mockRejectedValueOnce(new Error("Synthetic verification failure"));
  await expect(upload()).rejects.toThrow("verification failure");
  await upload();
  expect(Object.keys(remote.answers)).toHaveLength(1);
});

test("two uploads reading the same empty snapshot cannot create duplicate logical records", async () => {
  let release!: () => void;
  const bothRead = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reads = 0;
  (get as jest.Mock).mockImplementation(async () => {
    const captured = snapshot(remote);
    if (++reads <= 2) {
      if (reads === 2) release();
      await bothRead;
    }
    return captured;
  });
  await Promise.all([upload(), upload()]);
  expect(Object.keys(remote.pings)).toHaveLength(1);
  expect(Object.keys(remote.answers)).toHaveLength(1);
  expect(update).toHaveBeenCalledTimes(2);
});

test("a failed legacy-record read fails closed before any write", async () => {
  (get as jest.Mock).mockRejectedValueOnce(
    new Error("Synthetic permission denied"),
  );
  await expect(upload()).rejects.toThrow("permission denied");
  expect(update).not.toHaveBeenCalled();
});

test.each([
  [
    "logged out",
    () => {
      auth.currentUser = null;
    },
  ],
  [
    "wrong Firebase user",
    () => {
      auth.currentUser.email = "other@user.wellpingssnl";
    },
  ],
  [
    "unverified Firebase user",
    () => {
      auth.currentUser.emailVerified = false;
    },
  ],
  [
    "wrong database",
    () => {
      app.options.databaseURL = "https://other.invalid";
    },
  ],
  [
    "wrong project",
    () => {
      app.options.projectId = "other";
    },
  ],
  [
    "wrong secure session",
    () => {
      currentLocalUser = { ...localUser, loginDate: 2000 };
    },
  ],
  [
    "wrong study",
    () => {
      currentStudy = { ...currentStudy, id: "other" };
    },
  ],
  [
    "changed study destination",
    () => {
      currentStudy.server.firebase!.config.databaseURL =
        "https://other.invalid";
    },
  ],
])("rejects %s before reading or writing Firebase", async (_label, change) => {
  change();
  await expect(upload()).rejects.toThrow();
  expect(get).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
  expect(end).toHaveBeenCalledTimes(1);
});

test.each([
  [
    "auth",
    () => {
      auth.currentUser = { ...auth.currentUser, uid: "other-uid" };
    },
  ],
  [
    "study",
    () => {
      currentStudy = { ...currentStudy, id: "other" };
    },
  ],
  [
    "session",
    () => {
      currentLocalUser = { ...localUser, loginDate: 2000 };
    },
  ],
])(
  "rejects an %s switch while the legacy read is in flight",
  async (_label, change) => {
    (get as jest.Mock).mockImplementationOnce(async () => {
      const captured = snapshot(remote);
      await Promise.resolve();
      change();
      return captured;
    });
    await expect(upload()).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
  },
);

test("rejects a prefetched payload from a different login session", async () => {
  const stale = {
    ...data,
    user: { ...data.user, loginSessionId: "old-session" },
  };
  await expect(upload(stale)).rejects.toThrow("session changed");
  expect(get).not.toHaveBeenCalled();
});

test("answer tuple identities cannot collide through concatenation", async () => {
  await upload({
    ...data,
    answers: [
      { ...data.answers[0], pingId: "a_b", questionId: "c" },
      { ...data.answers[0], pingId: "a", questionId: "b_c" },
    ],
  });
  expect(Object.keys(remote.answers)).toHaveLength(2);
});

test("does not accept an existing SDK app configured for a different study", () => {
  app.options.projectId = "other";
  expect(() => validateAndInitializeFirebaseWithConfig(study)).toThrow(
    "configuration is invalid",
  );
});

test("a delayed session mutation waits for send initiation, not its network response", async () => {
  let guardStarted!: () => void;
  const guarding = new Promise<void>((resolve) => {
    guardStarted = resolve;
  });
  let releaseGuard!: () => void;
  const pausedGuard = new Promise<void>((resolve) => {
    releaseGuard = resolve;
  });
  let releaseNetwork!: () => void;
  const network = new Promise<void>((resolve) => {
    releaseNetwork = resolve;
  });
  let reads = 0;
  const order: string[] = [];
  (secureGetUserAsync as jest.Mock).mockImplementation(async () => {
    if (++reads === 2) {
      guardStarted();
      await pausedGuard;
    }
    return currentLocalUser;
  });
  (update as jest.Mock).mockImplementationOnce((_root, updates) => {
    order.push("send");
    applyUpdate(updates);
    return network;
  });
  const uploading = upload();
  const rejected = expect(uploading).rejects.toThrow("session changed");
  await guarding;
  const switched = withDataJournalLockAsync(async () => {
    order.push("switch");
    currentLocalUser = { ...localUser, loginDate: 2000 };
  });
  releaseGuard();
  await switched;
  expect(order).toEqual(["send", "switch"]);
  expect(end).not.toHaveBeenCalled();
  releaseNetwork();
  await rejected;
});

test("an auth event after the asynchronous guard cannot slip into the write", async () => {
  let afterRead = false;
  let changed = false;
  (get as jest.Mock).mockImplementationOnce(async () => {
    afterRead = true;
    return snapshot(remote);
  });
  (getAuth as jest.Mock).mockImplementation(() => {
    if (afterRead && !changed) {
      changed = true;
      void Promise.resolve().then(() => {
        auth.currentUser = { ...auth.currentUser, uid: "other-uid" };
      });
    }
    return auth;
  });
  await expect(upload()).rejects.toThrow("account changed");
  expect(update).not.toHaveBeenCalled();
});

test("an empty full upload never replaces existing remote records", async () => {
  remote = {
    pings: { "-remote": { id: "remote" } },
    answers: { "-remote": { pingId: "remote", questionId: "q" } },
  };
  await upload({ ...data, pings: [], answers: [] });
  expect(remote.pings).toEqual({ "-remote": { id: "remote" } });
  expect(remote.answers).toEqual({
    "-remote": { pingId: "remote", questionId: "q" },
  });
});
