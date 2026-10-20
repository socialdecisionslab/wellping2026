import { beginSessionTeardown, finishSessionTeardown } from "./uploadActivity";
import { StudyInfo } from "@wellping/study-schemas/lib/types";
import * as Notifications from "expo-notifications";

import { clearCurrentStudyFileAsync } from "./asyncStorage/studyFile";
import { clearTempStudyFileAsync } from "./asyncStorage/tempStudyFile";
import { getUnuploadedPingsListAsync } from "./asyncStorage/unuploadedPingsList";
import { beiweLoginAsync } from "./beiwe";
import { clearAllPingsAndAnswersAsync } from "./cleanup";
import {
  firebaseLoginAsync,
  firebaseLogoutAndDeleteAppAsync,
  firebaseInitialized,
} from "./firebase";
import { getPingsAsync } from "./pings";
import {
  secureStoreUserAsync,
  secureClearUserAsync,
  User,
} from "./secureStore/user";
import { isUsingFirebase, isUsingBeiwe, isUsingServer } from "./server";
import { getStudyInfoAsync, studyFileExistsAsync } from "./studyFile";

/**
 * Throws an error if the login is unsuccessful.
 */
export async function loginAsync(user: User, studyInfo: StudyInfo) {
  if (isUsingServer(studyInfo)) {
    if (isUsingFirebase(studyInfo)) {
      await firebaseLoginAsync(user);
    }
    if (isUsingBeiwe(studyInfo)) {
      await beiweLoginAsync(user);
    }
  } else {
    await new Promise((r) => setTimeout(r, 3000)); // Simulate loading.
  }

  await secureStoreUserAsync(user);
}

export async function logoutAsync() {
  beginSessionTeardown();
  try {
    await performLogoutAsync();
  } finally {
    finishSessionTeardown();
  }
}

async function performLogoutAsync() {
  // Check before authentication teardown or any deletion. Fail closed if reads fail.
  if (await studyFileExistsAsync()) {
    const unuploaded = await getUnuploadedPingsListAsync();
    const pings = await getPingsAsync();
    if (unuploaded.length > 0 || pings.some((ping) => !ping.endTime)) {
      throw new Error(
        "Cannot log out while responses are unsent or a survey is in progress. Complete the survey and sync before logging out. Your data has been preserved.",
      );
    }
  }

  await Notifications.cancelAllScheduledNotificationsAsync();

  if (firebaseInitialized()) {
    await firebaseLogoutAndDeleteAppAsync();
  }

  if (await studyFileExistsAsync()) {
    await clearAllPingsAndAnswersAsync();
  }

  await clearTempStudyFileAsync();

  await secureClearUserAsync();
  await clearCurrentStudyFileAsync();
}
