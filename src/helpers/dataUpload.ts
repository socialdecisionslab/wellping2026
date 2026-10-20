import { beginUpload, finishUpload } from "./uploadActivity";
import * as Crypto from "expo-crypto";
import { withDataLock } from "./dataLock";
import {
  acknowledgeRevisionsAsync,
  getUploadRevisionsAsync,
  markPingDirtyAsync,
} from "./uploadRevisions";
import { StudyInfo } from "@wellping/study-schemas/lib/types";

import { getAnswersAsync } from "./answers";
import { beiweUploadDataForUserAsync } from "./beiwe";
import {
  UserData,
  UploadData,
  AllData,
  UnuploadedData,
} from "./dataUploadType";
import {
  HOME_SCREEN_DEBUG_VIEW_SYMBOLS,
  getUserInstallationInfoAsync,
} from "./debug";
import { firebaseUploadDataForUserAsync } from "./firebase";
import { getLoginSessionIDAsync } from "./loginSession";
import { getPingsAsync } from "./pings";
import { secureGetUserAsync } from "./secureStore/user";
import {
  isUsingFirebase,
  isUsingServer,
  isUsingBeiwe,
  DataUploadServerResponse,
} from "./server";

async function _getUserDataAsync(): Promise<UserData> {
  const user = await secureGetUserAsync();
  if (user === null) {
    throw new Error("user === null in getAllDataAsync");
  }
  return {
    username: user.username,
    loginSessionId: await getLoginSessionIDAsync(user),
    installation: await getUserInstallationInfoAsync(),
  };
}

export async function getAllDataAsync(): Promise<AllData> {
  const user = await _getUserDataAsync();
  const pings = await getPingsAsync();
  const answers = await getAnswersAsync();

  const data: AllData = {
    user,
    pings,
    answers,
  };
  return data;
}

export async function getUnuploadedDataAsync(): Promise<UnuploadedData> {
  const user = await _getUserDataAsync();
  const unuploadedPings = await getPingsAsync({ unuploadedOnly: true });
  const unuploadedAnswers = await getAnswersAsync({ unuploadedOnly: true });

  const data: UnuploadedData = {
    user,
    unuploadedPings,
    unuploadedAnswers,
  };
  return data;
}

/**
 * Returns a `DataUploadServerResponse` if successful.
 * Throws an error otherwise.
 */
async function performUploadAsync(
  studyInfo: StudyInfo,
  setUploadStatusSymbol: (symbol: string) => void,
  {
    unuploadedOnly,
    prefetchedData,
  }: {
    unuploadedOnly: boolean;

    // If we have already gotten the data, we would just use that.
    prefetchedData?: UploadData;
  },
): Promise<DataUploadServerResponse> {
  let data: UploadData;
  if (prefetchedData) {
    data = prefetchedData;
  } else if (unuploadedOnly) {
    data = await getUnuploadedDataAsync();
  } else {
    data = await getAllDataAsync();
  }

  const startUploading = (): void => {
    setUploadStatusSymbol(HOME_SCREEN_DEBUG_VIEW_SYMBOLS.UPLOAD.UPLOADING);
  };
  const endUploading = (errorMessage?: string): void => {
    setUploadStatusSymbol(
      errorMessage || HOME_SCREEN_DEBUG_VIEW_SYMBOLS.UPLOAD.END_SUCCESS,
    );

    // Reset symbol in 3 seconds if no error, and 10 if there was error.
    setTimeout(
      () => {
        setUploadStatusSymbol(HOME_SCREEN_DEBUG_VIEW_SYMBOLS.UPLOAD.INITIAL);
      },
      errorMessage ? 10000 : 3000,
    );
  };

  const user = await secureGetUserAsync();
  if (user === null) {
    endUploading("User===Null");
    throw new Error("secureGetUserAsync() === null in uploadDataAsync");
  }

  let response: DataUploadServerResponse = {};
  if (isUsingServer(studyInfo)) {
    if (isUsingFirebase(studyInfo)) {
      response = await firebaseUploadDataForUserAsync(
        data,
        user,
        startUploading,
        endUploading,
      );
    }
    if (isUsingBeiwe(studyInfo)) {
      response = await beiweUploadDataForUserAsync(
        data,
        user,
        startUploading,
        endUploading,
      );
    }
  } else {
    startUploading();
    endUploading(`No Server Set`);
    throw new Error(
      "No upload server configured. Responses remain saved on this device.",
    );
  }

  return response;
}

// Shared by automatic, foreground and manual uploads. Each queued attempt takes
// a fresh snapshot; no concurrent request can overwrite or acknowledge another.
let uploadTail: Promise<unknown> = Promise.resolve();
export function uploadDataAsync(
  studyInfo: StudyInfo,
  setUploadStatusSymbol: (symbol: string) => void,
  options: { unuploadedOnly: boolean; prefetchedData?: UploadData },
): Promise<DataUploadServerResponse> {
  beginUpload();
  const run = uploadTail.then(async () => {
    if (!isUsingServer(studyInfo))
      throw new Error(
        "No upload server configured. Responses remain saved on this device.",
      );
    const data: UploadData & {
      revisions: import("./uploadRevisions").UploadRevisions;
    } = await withDataLock(async () => {
      const snapshot = options.unuploadedOnly
        ? await getUnuploadedDataAsync()
        : await getAllDataAsync();
      const pings =
        "pings" in snapshot ? snapshot.pings : snapshot.unuploadedPings;
      let revisions = await getUploadRevisionsAsync();
      // Legacy on-device records acquire a stable revision before their first send.
      for (const ping of pings)
        if (!revisions[ping.id]) await markPingDirtyAsync(ping.id);
      revisions = await getUploadRevisionsAsync();
      return {
        ...snapshot,
        studyId: studyInfo.id,
        revisions: Object.fromEntries(
          pings.map((p) => [p.id, revisions[p.id]]),
        ),
      };
    });
    data.receipt = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      JSON.stringify(data),
    );
    const response = await performUploadAsync(
      studyInfo,
      setUploadStatusSymbol,
      { ...options, prefetchedData: data },
    );
    await withDataLock(() =>
      acknowledgeRevisionsAsync(data.revisions, Object.keys(data.revisions)),
    );
    return response;
  });
  const finished = run.finally(finishUpload);
  uploadTail = finished.catch(() => undefined);
  return finished;
}
