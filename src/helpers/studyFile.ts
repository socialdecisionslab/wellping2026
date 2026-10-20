import { RELEASE } from "../../config/release";
import { requestTextAsync } from "./http";
import { StudyFileSchema } from "@wellping/study-schemas/lib/schemas/StudyFile";
import {
  StudyFile,
  StudyInfo,
  StreamName,
  Streams,
  ExtraData,
  ChoicesList,
} from "@wellping/study-schemas/lib/types";
import { isThisWeek } from "date-fns";
import * as Crypto from "expo-crypto";

import { IS_LOCAL_DEVELOPMENT } from "../../config/local";
import { STUDY_FILE_URL_PREFIXES_WHITELIST } from "../../config/studyWhitelist";
import {
  storeCurrentStudyFileAsync,
  getCurrentStudyFileAsync,
  getCurrentStudyInfoAsync,
  getCurrentStreamsAsync,
  getCurrentExtraDataAsync,
} from "./asyncStorage/studyFile";
import { validateAndInitializeFirebaseWithConfig } from "./firebase";
import { preparePendingEnrollmentAsync } from "./failedEnrollment";
import { ignoreTimeObjectTimezone } from "./helpers";
import { getHttpsOrigin } from "./networkSafety";
import { isUsingFirebase } from "./server";

export const WELLPING_LOCAL_DEBUG_URL =
  "https://debug.local.wellping.ssnl.stanford.edu/DEBUG_STUDY.json";

export type LocalStudyFileType = "debug";
export function getLocalStudyFileType(
  studyFileURL: string,
): LocalStudyFileType | null {
  if (studyFileURL === WELLPING_LOCAL_DEBUG_URL) {
    return "debug";
  }
  return null;
}

export async function getLocalStudyFileTypeAsync(): Promise<LocalStudyFileType | null> {
  return getLocalStudyFileType((await getStudyInfoAsync()).studyFileURL);
}

/**
 * Returns whether of not the study file is stored locally.
 */
export async function studyFileExistsAsync() {
  const currentStudyInfo = await getCurrentStudyInfoAsync();
  if (currentStudyInfo === null) {
    return false;
  }

  const currentStreams = await getCurrentStreamsAsync();
  if (currentStreams === null) {
    return false;
  }

  const extraData = await getCurrentExtraDataAsync();
  if (extraData === null) {
    return false;
  }

  return true;
}

/**
 * Downloads a study file (in JSON or YAML format) from `url`.
 * Returns the content of the file (as a string) if the file is a JSON file,
 * or returns a JSON-stringified parsed YAML object.
 * Throws an error if the download process (or YAML parsing process if any)
 * failed.
 */
export async function downloadStudyFileAsync({
  url,
  username,
  password,
}: {
  url: string;
  username: string;
  password: string;
}): Promise<string> {
  const localStudyFilePath = getLocalStudyFileType(url);
  if (localStudyFilePath !== null) {
    throw new Error(
      "The old debug study entry is disabled. Use the isolated synthetic runner.",
    );
  }

  getHttpsOrigin(url);

  if (
    RELEASE
      ? url !== RELEASE.studyUrl
      : !STUDY_FILE_URL_PREFIXES_WHITELIST.some((whitelistPrefix) =>
          url.startsWith(whitelistPrefix),
        )
  ) {
    throw new Error(
      "This study file URL is not in the whitelist. Please refer to " +
        "https://github.com/wellping/wellping for more information.",
    );
  }

  // TODO: Currently the password is hashed this way to make it works with Beiwe default authentication. It certainly does not have to be this way and could be changed later.
  function _base64ToBase64URL(input: string): string {
    return input.replace(/\+/g, "-").replace(/\//g, "_");
  }
  const passwordHash = _base64ToBase64URL(
    await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      password,
      {
        encoding: Crypto.CryptoEncoding.BASE64,
      },
    ),
  );

  if (RELEASE) {
    const response = await requestTextAsync(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        protocol: "wellping-v1",
        credentials: { username, passwordHash },
      }),
    });
    if (response.status < 200 || response.status >= 300)
      throw new Error(
        "Unable to load study configuration. Check your enrollment details.",
      );
    return response.text;
  }
  const queryObject: { [key: string]: string } = {
    username,
    password: passwordHash,
  };
  const query = Object.keys(queryObject)
    .map(
      (k) => encodeURIComponent(k) + "=" + encodeURIComponent(queryObject[k]),
    )
    .join("&");

  let response: Response;
  try {
    response = await fetch(`${url}?${query}`, {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      headers: {
        Accept: "*/*",
        "Content-Type": "application/json",
      },
    });
  } catch (e) {
    throw new Error("Unable to download or read the study configuration.");
  }

  if (response.status < 200 || response.status >= 300) {
    if (response.status === 403) {
      throw new Error(
        "Verification failed. Make sure you have entered the correct login code!",
      );
    } else {
      throw new Error(
        `Study file fetch failed - error code ${response.status}!`,
      );
    }
  }

  let responseText: string;
  try {
    responseText = await response.text();
  } catch {
    throw new Error("Unable to read the study configuration.");
  }

  const contentType = response.headers.get("content-type");
  if (contentType && contentType.includes("json")) {
    // It is a JSON file.
    return responseText;
  } else {
    // Try if YAML can parse it.
    // Notice that since "every JSON file is also a valid YAML file."
    // (https://yaml.org/spec/1.2/spec.html#id2759572), this will also handle
    // the case if the JSON file has a wrong content type.
    try {
      const yaml = require("js-yaml");
      const doc = yaml.safeLoad(responseText);
      return JSON.stringify(doc);
    } catch (e) {
      throw new Error("Unable to download or read the study configuration.");
    }
  }
}

/**
 * Parses a study file from `rawJsonString` (a string that can be parsed to a
 * JSON object).
 * If the study file is successfully parsed and the Firebase config is validated,
 * initializes Firebase and stores the downloaded study file in Async Storage.
 * Returns `null` if all processes are successful.
 * Returns the error message if any process is unsuccessful.
 * Validation failures preserve the saved study so it can be loaded on restart.
 */
export async function parseAndStoreStudyFileAsync(
  rawJsonString: string,
  { freshEnrollment = false }: { freshEnrollment?: boolean } = {},
): Promise<string | null> {
  try {
    const parsedStudy = StudyFileSchema.parse(JSON.parse(rawJsonString));
    if (
      RELEASE &&
      (!parsedStudy.studyInfo.version?.trim() ||
        parsedStudy.studyInfo.studyFileURL !== RELEASE.studyUrl ||
        parsedStudy.studyInfo.server.beiwe?.serverUrl !== RELEASE.beiweUrl ||
        isUsingFirebase(parsedStudy.studyInfo) ||
        parsedStudy.studyInfo.contactEmail !== RELEASE.supportEmail)
    ) {
      throw new Error("Study configuration does not match this release.");
    }
    const previous = await getCurrentStudyFileAsync();
    if (
      previous &&
      previous.studyInfo.id !== parsedStudy.studyInfo.id &&
      !(
        IS_LOCAL_DEVELOPMENT &&
        Object.keys(previous.studyInfo.server).length === 0 &&
        Object.keys(parsedStudy.studyInfo.server).length === 0
      )
    )
      throw new Error("End the current study session before changing studies.");
    if (isUsingFirebase(parsedStudy.studyInfo)) {
      validateAndInitializeFirebaseWithConfig(parsedStudy.studyInfo);
    }
    if (freshEnrollment) await preparePendingEnrollmentAsync(parsedStudy);
    await storeCurrentStudyFileAsync(parsedStudy);
    return null;
  } catch (e) {
    // Preserve the last complete saved configuration on any failed replacement.
    return "Study configuration is invalid. Contact the study team.";
  }
}

/**
 * Returns the stored study info.
 * Throws an error if there isn't any current study file stored.
 */
export async function getStudyInfoAsync(): Promise<StudyInfo> {
  const currentStudyInfo = await getCurrentStudyInfoAsync();
  if (currentStudyInfo === null) {
    throw new Error("getCurrentStudyInfoAsync = null");
  }

  return currentStudyInfo;
}

function getStudyStartDateOrEndDateAsync(
  type: "startDate" | "endDate",
  studyInfo: StudyInfo,
): Date {
  return ignoreTimeObjectTimezone(
    type === "startDate" ? studyInfo.startDate : studyInfo.endDate,
  );
}
export function getStudyStartDate(studyInfo: StudyInfo): Date {
  return getStudyStartDateOrEndDateAsync("startDate", studyInfo);
}
export function getStudyEndDate(studyInfo: StudyInfo): Date {
  return getStudyStartDateOrEndDateAsync("endDate", studyInfo);
}

/**
 * Returns the stored streams.
 * Throws an error if there isn't any current study file stored.
 */
export async function getStreamsAsync(): Promise<Streams> {
  const currentStreams = await getCurrentStreamsAsync();
  if (currentStreams === null) {
    throw new Error("getCurrentStreamsAsync = null");
  }

  return currentStreams;
}

/**
 * Returns the stored extra data.
 * Throws an error if there isn't any current study file stored.
 */
export async function getExtraDataAsync(): Promise<ExtraData> {
  const currentExtraData = await getCurrentExtraDataAsync();
  if (currentExtraData === null) {
    throw new Error("getCurrentExtraDataAsync = null");
  }

  return currentExtraData;
}

/**
 * *** Use the more specific `getStudyInfoAsync()` or `getStreamsAsync()` if
 * possible. ***
 *
 * Returns the stored study file.
 * Throws an error if there isn't any current study file stored.
 */
export async function getStudyFileAsync(): Promise<StudyFile> {
  const study = await getCurrentStudyFileAsync();
  if (!study) throw new Error("No saved study configuration.");
  return study;
}

/**
 * Returns a choices list keyed `key` in `reusableChoices` in `extraData`.
 * Returns `null` if no such choices list is found.
 */
export async function getReusableChoicesAsync(
  key: string,
): Promise<ChoicesList | null> {
  const extraData = await getExtraDataAsync();
  if (extraData.reusableChoices) {
    if (extraData.reusableChoices[key]) {
      return extraData.reusableChoices[key];
    }
  }
  return null;
}

/**
 * Returns a choices list keyed `key` in `reusableChoices` in `extraData`.
 * If no such choices list is found, returns an array containing a single
 * string explaining the error.
 */
export async function getReusableChoicesIncludeErrorAsync(
  key: string,
): Promise<ChoicesList> {
  const reusableChoices = await getReusableChoicesAsync(key);
  if (reusableChoices === null) {
    return [`ERROR: reusable choices with key "${key}" is not found.`];
  } else {
    return reusableChoices;
  }
}

export function getAllStreamNames(studyInfo: StudyInfo): StreamName[] {
  return Object.keys(studyInfo.streamsStartingQuestionIds) as StreamName[];
}
export async function getAllStreamNamesAsync(): Promise<StreamName[]> {
  return getAllStreamNames(await getStudyInfoAsync());
}

export function isTimeThisWeek(time: Date, studyInfo: StudyInfo): boolean {
  return isThisWeek(time, {
    weekStartsOn: studyInfo.weekStartsOn,
  });
}
export async function isTimeThisWeekAsync(time: Date): Promise<boolean> {
  return isTimeThisWeek(time, await getStudyInfoAsync());
}
