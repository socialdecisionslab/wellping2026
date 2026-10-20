import AsyncStorage from "@react-native-async-storage/async-storage";
import { beiweUploadDataForUserAsync } from "../../helpers/beiwe";
import { uploadDataAsync } from "../../helpers/dataUpload";
import { getUnuploadedPingsListAsync } from "../../helpers/asyncStorage/unuploadedPingsList";
import { secureStorePingAsync } from "../../helpers/secureStore/ping";
import {
  setUpSurveyScreenTestAsync,
  STUDY_INFO,
} from "../SurveyScreen.test/helper";

jest.mock("../../helpers/beiwe", () => ({
  beiweUploadDataForUserAsync: jest.fn(),
}));
jest.mock("../../helpers/firebase", () => ({}));
const study = {
  ...STUDY_INFO,
  server: { beiwe: { serverUrl: "https://synthetic.invalid" } },
};

beforeEach(async () => {
  await AsyncStorage.clear();
  (beiweUploadDataForUserAsync as jest.Mock).mockReset();
});

test("lost acknowledgment keeps responses pending and retry uses the same receipt", async () => {
  const ping = await setUpSurveyScreenTestAsync();
  const upload = beiweUploadDataForUserAsync as jest.Mock;
  upload
    .mockRejectedValueOnce(Error("lost acknowledgment"))
    .mockResolvedValueOnce({});
  await expect(
    uploadDataAsync(study, () => {}, { unuploadedOnly: true }),
  ).rejects.toThrow();
  expect(await getUnuploadedPingsListAsync()).toEqual([ping.id]);
  await uploadDataAsync(study, () => {}, { unuploadedOnly: true });
  expect(upload.mock.calls[0][0].receipt).toBe(upload.mock.calls[1][0].receipt);
  expect(await getUnuploadedPingsListAsync()).toEqual([]);
});

test("a new local revision stays pending while an older upload completes", async () => {
  const ping = await setUpSurveyScreenTestAsync();
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const upload = beiweUploadDataForUserAsync as jest.Mock;
  upload.mockImplementationOnce(async () => {
    started();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return {};
  });
  const sending = uploadDataAsync(study, () => {}, { unuploadedOnly: true });
  await ready;
  await secureStorePingAsync({ ...ping, endTime: new Date() });
  release();
  await sending;
  expect(await getUnuploadedPingsListAsync()).toEqual([ping.id]);
  upload.mockResolvedValueOnce({});
  await uploadDataAsync(study, () => {}, { unuploadedOnly: true });
  expect(upload.mock.calls[1][0].receipt).not.toBe(
    upload.mock.calls[0][0].receipt,
  );
  expect(await getUnuploadedPingsListAsync()).toEqual([]);
});

test("manual and automatic uploads never overlap", async () => {
  await setUpSurveyScreenTestAsync();
  let active = 0,
    maximum = 0;
  (beiweUploadDataForUserAsync as jest.Mock).mockImplementation(async () => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return {};
  });
  await Promise.all([
    uploadDataAsync(study, () => {}, { unuploadedOnly: false }),
    uploadDataAsync(study, () => {}, { unuploadedOnly: true }),
  ]);
  expect(maximum).toBe(1);
});
