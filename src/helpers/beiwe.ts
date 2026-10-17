/**
 * Unless otherwise noted, precondition for every function in the file is:
 * `isUsingBeiwe(studyInfo) === true`.
 */

import { StudyInfo } from "@wellping/study-schemas/lib/types";
import * as Device from "expo-device";
import { Platform } from "react-native";

import { withDataJournalLockAsync } from "./dataJournal";
import { UploadData } from "./dataUploadType";
import { JS_VERSION_NUMBER } from "./debug";
import { base64ToBase64URL, getHashedPasswordAsync } from "./helpers";
import { getLoginSessionIDAsync } from "./loginSession";
import { getHttpsOrigin } from "./networkSafety";
import { User, secureGetUserAsync } from "./secureStore/user";
import { DataUploadServerResponse, getBeiweServerConfig } from "./server";
import { getStudyInfoAsync } from "./studyFile";

/**
 * If success, returns nothing.
 * If error, throws error message.
 */
export async function beiweLoginAsync(user: User): Promise<void> {
  const request: { [key: string]: any } = {
    new_password: user.password, // Do not reset password
    phone_number: "1234567890", // Doesn't matter
    device_os: Device.osName,
    os_version: Device.osVersion,
    product: Device.modelName,
    brand: Device.brand,
    manufacturer: Device.manufacturer,
    model: Device.modelId,
    beiwe_version: `WellPing${JS_VERSION_NUMBER}`,
  };

  try {
    let endpoint = "/register_user";
    if (Platform.OS === "ios") {
      endpoint += "/ios/";
    }
    await makePostRequestAsync({
      endpoint,
      request,
      body: {},
      user,
    });
  } catch (e) {
    throw new Error(
      "Unable to sign in. Check your login details and connection.",
    );
  }
}

/**
 * Returns a `DataUploadServerResponse` if successful.
 * Throws an error otherwise.
 */
export async function beiweUploadDataForUserAsync(
  data: UploadData,
  user: User,
  startUploading: () => void,
  endUploading: (errorMessage?: string) => void,
  capturedStudyInfo?: StudyInfo,
): Promise<DataUploadServerResponse> {
  startUploading();

  try {
    const payload = JSON.parse(JSON.stringify(data)) as UploadData;
    const expectedUser = { ...user };
    const studyInfo = JSON.parse(
      JSON.stringify(capturedStudyInfo ?? (await getStudyInfoAsync())),
    ) as StudyInfo;
    const serverUrl = getBeiweServerConfig(studyInfo).serverUrl;
    const loginSessionId = payload.user.loginSessionId;
    const assertCurrentDestinationAsync = async (): Promise<void> => {
      const currentUser = await secureGetUserAsync();
      if (
        currentUser === null ||
        currentUser.username !== expectedUser.username ||
        currentUser.password !== expectedUser.password ||
        currentUser.loginDate !== expectedUser.loginDate ||
        payload.user.username !== expectedUser.username ||
        (await getLoginSessionIDAsync(expectedUser)) !== loginSessionId
      ) {
        throw new Error("The upload session changed. Please try again.");
      }
      const currentStudy = await getStudyInfoAsync();
      if (
        currentStudy.id !== studyInfo.id ||
        getBeiweServerConfig(currentStudy).serverUrl !== serverUrl
      ) {
        throw new Error("The upload destination changed. Please try again.");
      }
    };
    await assertCurrentDestinationAsync();
    const endpoint = "/ssnl_upload";
    const response = await makePostRequestAsync({
      endpoint,
      request: {},
      body: payload,
      user: expectedUser,
      studyInfo,
      loginSessionId,
      beforeSend: assertCurrentDestinationAsync,
      throwShortError: true,
    });
    await assertCurrentDestinationAsync();
    endUploading();
    return response as DataUploadServerResponse;
  } catch (e) {
    endUploading("BW: upload failed");
    throw e;
  }
}

async function getRequestURLAsync(
  endpoint: string,
  request: { [key: string]: any } = {},
  forUser?: User,
  capturedStudyInfo?: StudyInfo,
  capturedLoginSessionId?: string,
): Promise<string> {
  let user: User | null = forUser || null;
  if (!user) {
    user = await secureGetUserAsync();

    if (user == null) {
      throw new Error("user == null in getRequestURLAsync");
    }
  }

  const passwordHash = await getHashedPasswordAsync(user.password);
  request["password"] = base64ToBase64URL(passwordHash);
  request["device_id"] =
    capturedLoginSessionId || (await getLoginSessionIDAsync(user));
  request["username"] = user.username;
  request["patient_id"] = user.username;

  //console.warn(`request is ${JSON.stringify(request)}`);

  const studyInfo = capturedStudyInfo || (await getStudyInfoAsync());
  const serverUrl = getBeiweServerConfig(studyInfo).serverUrl;
  getHttpsOrigin(serverUrl);
  // Legacy server contract: query authentication remains a deployment blocker.
  // Do not move credentials to a new location until the server supports it.
  const query = Object.keys(request)
    .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(request[k]))
    .join("&");
  const url = `${serverUrl}${endpoint}?${query}`;
  return url;
}

async function makePostRequestAsync({
  endpoint,
  request,
  body,
  user,
  throwShortError,
  studyInfo,
  loginSessionId,
  beforeSend,
}: {
  endpoint: string;
  request: { [key: string]: any };
  body?: { [key: string]: any };
  user?: User;
  throwShortError?: boolean;
  studyInfo?: StudyInfo;
  loginSessionId?: string;
  beforeSend?: () => Promise<void>;
}): Promise<any> {
  const headers = {
    "Beiwe-Api-Version": "2",
    "WellPing-JSVersion": JS_VERSION_NUMBER,
    Accept: "*/*",
    "Content-Type": "application/json",
  };

  const url = await getRequestURLAsync(
    endpoint,
    request,
    user,
    studyInfo,
    loginSessionId,
  );
  const send = async (): Promise<Response> => {
    try {
      return await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        redirect: "error",
      });
    } catch {
      throw new Error("Unable to contact the study server.");
    }
  };
  // Keep enrollment changes out of the final check-to-send window, but never
  // hold the storage lock while waiting for the network response.
  const { response } = beforeSend
    ? await withDataJournalLockAsync(async () => {
        await beforeSend();
        return { response: send() };
      })
    : { response: send() };
  const result = await response;

  if (result.status < 200 || result.status >= 300) {
    if (result.status === 401 || result.status === 403) {
      throw new Error(
        throwShortError
          ? `VF${result.status}`
          : "Verification failed. Check your login details.",
      );
    }
    throw new Error(
      throwShortError
        ? `OF${result.status}`
        : "The study server could not complete the request.",
    );
  }

  try {
    return await result.json();
  } catch {
    throw new Error("The study server returned an invalid response.");
  }
}
