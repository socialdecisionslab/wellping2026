import * as Crypto from "expo-crypto";
import { RELEASE } from "../../config/release";
import { StudyInfo } from "@wellping/study-schemas/lib/types";
import { beiweUploadDataForUserAsync } from "./beiwe";
import { AllData, UnuploadedData } from "./dataUploadType";
import {
  HOME_SCREEN_DEBUG_VIEW_SYMBOLS,
  getUserInstallationInfoAsync,
} from "./debug";
import { firebaseUploadDataForUserAsync } from "./firebase";
import {
  isUsingFirebase,
  isUsingBeiwe,
  DataUploadServerResponse,
} from "./server";
import {
  captureDataSnapshotAsync,
  acknowledgeDataSnapshotAsync,
  assertDataOwnerAsync,
} from "./dataJournal";
import { getStudyInfoAsync } from "./studyFile";

type Snapshot = Awaited<ReturnType<typeof captureDataSnapshotAsync>>;
async function payload(
  snapshot: Snapshot,
  unuploadedOnly: boolean,
): Promise<AllData | UnuploadedData> {
  const user = {
    username: snapshot.owner.username,
    loginSessionId: snapshot.owner.loginSessionId,
    installation: await getUserInstallationInfoAsync(),
  };
  await assertDataOwnerAsync(snapshot.owner);
  const metadata = {
    studyId: snapshot.owner.studyId,
    revisions: Object.fromEntries(
      Object.entries(snapshot.revisions).map(([id, revision]) => [
        id,
        { revision, studyVersion: snapshot.studyVersions[id] },
      ]),
    ),
  };
  const data = unuploadedOnly
    ? {
        ...metadata,
        user,
        unuploadedPings: snapshot.pings,
        unuploadedAnswers: snapshot.answers,
      }
    : { ...metadata, user, pings: snapshot.pings, answers: snapshot.answers };
  return {
    ...data,
    receipt: await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      JSON.stringify(data),
    ),
  };
}
export async function getAllDataAsync(): Promise<AllData> {
  return (await payload(await captureDataSnapshotAsync({}), false)) as AllData;
}
export async function getUnuploadedDataAsync(): Promise<UnuploadedData> {
  return (await payload(
    await captureDataSnapshotAsync({ unuploadedOnly: true }),
    true,
  )) as UnuploadedData;
}

// Serialize network attempts, not storage: new responses remain writable offline.
let uploads: Promise<unknown> = Promise.resolve();
export function uploadDataAsync(
  studyInfo: StudyInfo,
  setUploadStatusSymbol: (symbol: string) => void,
  { unuploadedOnly }: { unuploadedOnly: boolean },
): Promise<DataUploadServerResponse> {
  const destination = JSON.parse(JSON.stringify(studyInfo)) as StudyInfo;
  const snapshotPromise = captureDataSnapshotAsync({ unuploadedOnly });
  // Attach rejection immediately even if an older network attempt is pending.
  const prepared = snapshotPromise.then(
    (snapshot) => ({ snapshot }),
    (error) => ({ error }),
  );
  const operation = uploads.then(async () => {
    const result = await prepared;
    if (!("snapshot" in result)) throw result.error;
    const snapshot = result.snapshot;
    await assertDataOwnerAsync(snapshot.owner);
    const current = await getStudyInfoAsync();
    if (
      current.id !== destination.id ||
      JSON.stringify(current.server) !== JSON.stringify(destination.server)
    )
      throw new Error(
        "Study destination changed; responses remain on this device.",
      );
    if (
      RELEASE &&
      Object.values(snapshot.studyVersions).some((version) => !version)
    )
      throw new Error(
        "Originating study version is unknown. Responses remain saved for recovery.",
      );
    const data = await payload(snapshot, unuploadedOnly);
    setUploadStatusSymbol(HOME_SCREEN_DEBUG_VIEW_SYMBOLS.UPLOAD.UPLOADING);
    try {
      let response: DataUploadServerResponse = {};
      // A backend response is not a local acknowledgement. Report success only
      // after the exact captured revisions have been durably acknowledged.
      const started = () => {};
      const ended = () => {};
      if (isUsingFirebase(destination))
        response = await firebaseUploadDataForUserAsync(
          data,
          snapshot.user,
          started,
          ended,
          destination,
        );
      if (isUsingBeiwe(destination))
        response = await beiweUploadDataForUserAsync(
          data,
          snapshot.user,
          started,
          ended,
          destination,
        );
      if (!isUsingFirebase(destination) && !isUsingBeiwe(destination))
        throw new Error(
          "No upload server configured. Responses remain saved on this device.",
        );
      await acknowledgeDataSnapshotAsync(snapshot);
      setUploadStatusSymbol(HOME_SCREEN_DEBUG_VIEW_SYMBOLS.UPLOAD.END_SUCCESS);
      return response;
    } catch (error) {
      setUploadStatusSymbol("Retry sync");
      throw error;
    }
  });
  uploads = operation.catch(() => undefined);
  return operation;
}
