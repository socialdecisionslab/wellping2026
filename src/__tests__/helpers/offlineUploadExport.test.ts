import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { storeCurrentStudyFileAsync } from "../../helpers/asyncStorage/studyFile";
import { secureStoreUserAsync } from "../../helpers/secureStore/user";
import { insertPingAsync } from "../../helpers/pings";
import { insertAnswerAsync } from "../../helpers/answers";
import {
  getUnuploadedDataAsync,
  getAllDataAsync,
  uploadDataAsync,
} from "../../helpers/dataUpload";
import { beiweUploadDataForUserAsync } from "../../helpers/beiwe";
import { firebaseUploadDataForUserAsync } from "../../helpers/firebase";
import {
  parseResearchExport,
  serializeResearchExport,
} from "../../helpers/researchExport";
jest.mock("../../helpers/firebase", () => ({
  firebaseUploadDataForUserAsync: jest.fn(),
}));
jest.mock("../../helpers/beiwe", () => ({
  beiweUploadDataForUserAsync: jest.fn(),
}));
const original = require("../../../local/debug/DEBUG_STUDY.json");
const study = {
  ...original,
  studyInfo: {
    ...original.studyInfo,
    server: {
      firebase: {
        config: {
          projectId: "synthetic",
          databaseURL: "https://synthetic.invalid",
        },
      },
    },
  },
};
beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  for (const key of Object.keys((SecureStore as any).__INTERNAL_MOCK_STORAGE__))
    delete (SecureStore as any).__INTERNAL_MOCK_STORAGE__[key];
  await storeCurrentStudyFileAsync(study);
  await secureStoreUserAsync({
    username: "synthetic",
    password: "synthetic-secret",
    loginDate: 1,
  });
});
async function save(
  value: string,
  ping?: Awaited<ReturnType<typeof insertPingAsync>>,
) {
  const observation =
    ping ??
    (await insertPingAsync({
      streamName: "welcomeStream",
      notificationTime: new Date(),
      startTime: new Date(),
    }));
  await insertAnswerAsync({
    ping: observation,
    question: study.streams.welcomeStream.Hello,
    realQuestionId: "Hello",
    preferNotToAnswer: null,
    data: { value },
    date: new Date(),
  });
  return observation;
}
test("offline response survives failed upload and exports losslessly after retry", async () => {
  await save("你好 🌿");
  (firebaseUploadDataForUserAsync as jest.Mock)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({});
  await expect(
    uploadDataAsync(study.studyInfo, jest.fn(), { unuploadedOnly: true }),
  ).rejects.toThrow("offline");
  expect((await getUnuploadedDataAsync()).unuploadedAnswers).toHaveLength(1);
  await uploadDataAsync(study.studyInfo, jest.fn(), { unuploadedOnly: true });
  expect((await getUnuploadedDataAsync()).unuploadedPings).toEqual([]);
  const saved = await getAllDataAsync();
  const exported = serializeResearchExport({
    schemaVersion: 1,
    studyId: study.studyInfo.id,
    participant: {
      username: saved.user.username,
      sessionId: saved.user.loginSessionId,
    },
    pings: saved.pings,
    answers: saved.answers,
  });
  expect(parseResearchExport(exported).answers).toEqual(saved.answers);
  expect(exported).not.toContain("synthetic-secret");
});
test("answer edited while old revision uploads remains queued", async () => {
  const ping = await save("before");
  let release!: () => void;
  let started!: () => void;
  const didStart = new Promise<void>((resolve) => {
    started = resolve;
  });
  (firebaseUploadDataForUserAsync as jest.Mock).mockImplementationOnce(
    async () => {
      started();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return {};
    },
  );
  const syncing = uploadDataAsync(study.studyInfo, jest.fn(), {
    unuploadedOnly: true,
  });
  await didStart;
  await save("after", ping);
  release();
  await syncing;
  const pending = await getUnuploadedDataAsync();
  expect(pending.unuploadedPings.map((item) => item.id)).toEqual([ping.id]);
  expect(pending.unuploadedAnswers[0].data).toEqual({ value: "after" });
});

test("all configured destinations must succeed before local acknowledgement", async () => {
  const dual = {
    ...study,
    studyInfo: {
      ...study.studyInfo,
      server: {
        ...study.studyInfo.server,
        beiwe: { serverUrl: "https://synthetic.invalid" },
      },
    },
  };
  await storeCurrentStudyFileAsync(dual);
  await save("two destinations");
  (firebaseUploadDataForUserAsync as jest.Mock).mockResolvedValue({});
  (beiweUploadDataForUserAsync as jest.Mock).mockRejectedValue(
    new Error("offline second destination"),
  );
  await expect(
    uploadDataAsync(dual.studyInfo, jest.fn(), { unuploadedOnly: true }),
  ).rejects.toThrow();
  expect(beiweUploadDataForUserAsync).toHaveBeenCalledTimes(1);
  expect((await getUnuploadedDataAsync()).unuploadedPings).toHaveLength(1);
});

test("a destination replacement while a request is outstanding preserves pending data", async () => {
  await save("destination fenced");
  (firebaseUploadDataForUserAsync as jest.Mock).mockImplementationOnce(
    async () => {
      await storeCurrentStudyFileAsync({
        ...study,
        studyInfo: {
          ...study.studyInfo,
          server: {
            firebase: {
              config: {
                projectId: "replacement",
                databaseURL: "https://replacement.invalid",
              },
            },
          },
        },
      });
      return {};
    },
  );
  await expect(
    uploadDataAsync(study.studyInfo, jest.fn(), { unuploadedOnly: true }),
  ).rejects.toThrow();
  expect((await getUnuploadedDataAsync()).unuploadedPings).toHaveLength(1);
});
