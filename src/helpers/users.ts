import AsyncStorage from "@react-native-async-storage/async-storage";
import { StudyInfo } from "@wellping/study-schemas/lib/types";
import * as Notifications from "expo-notifications";

import {
  clearCurrentStudyFileAsync,
  getCurrentStudyFileAsync,
} from "./asyncStorage/studyFile";
import { ASYNC_STORAGE_WELLPING_PREFIX } from "./asyncStorage/asyncStorageConfig";
import { beiweLoginAsync } from "./beiwe";
import {
  firebaseLoginAsync,
  firebaseLogoutAndDeleteAppAsync,
  firebaseInitialized,
} from "./firebase";
import {
  closeDataSessionAsync,
  completeDataLogoutAsync,
  DataOwner,
  DataRecoveryError,
  getVerifiedPendingLogoutAsync,
} from "./dataJournal";
import {
  secureStoreUserAsync,
  secureClearUserAsync,
  User,
} from "./secureStore/user";
import { isUsingFirebase, isUsingBeiwe, isUsingServer } from "./server";
import { waitForPendingSurveySavesAsync } from "./surveyAnswerWrites";

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

/** A verified receipt permits retrying teardown without reopening a closed archive. */
export async function logoutAsync(pendingOwner?: DataOwner) {
  // Accepted edits outlive their screen. A detached failure must block logout,
  // even if its ping has expired or the UI has already unmounted.
  await waitForPendingSurveySavesAsync();

  const pending = await getVerifiedPendingLogoutAsync();
  if (
    pendingOwner &&
    (!pending ||
      pending.id !== pendingOwner.id ||
      pending.secureNamespace !== pendingOwner.secureNamespace)
  )
    throw new DataRecoveryError("LOGOUT_OWNER_MISMATCH");

  let owner: DataOwner;
  try {
    // Dirty/active checks and closing are one journal transaction, so no later
    // answer, completion, or resume write can slip through the logout gate.
    owner = pending ?? (await closeDataSessionAsync());
  } catch (error) {
    if (
      error instanceof DataRecoveryError &&
      (error.code === "PENDING_RESEARCH_DATA" ||
        error.code === "ACTIVE_RESEARCH_DATA")
    )
      throw new Error(
        "Cannot log out while responses are unsent or a survey is in progress. Complete the survey and sync before logging out. Your data has been preserved.",
      );
    throw error;
  }

  await Notifications.cancelAllScheduledNotificationsAsync();
  if (firebaseInitialized()) await firebaseLogoutAndDeleteAppAsync();

  // The receipt and all encrypted research records survive every teardown
  // interruption. Captured keys also work after configuration was tombstoned.
  for (const name of ["NotificationTime", "tempStudyFile"]) {
    const key = `${ASYNC_STORAGE_WELLPING_PREFIX}Study_${owner.studyId}/${name}`;
    await AsyncStorage.removeItem(key);
    if ((await AsyncStorage.getItem(key)) !== null)
      throw new DataRecoveryError("LOGOUT_METADATA_STILL_PRESENT");
  }
  await secureClearUserAsync(owner);
  await clearCurrentStudyFileAsync();
  if ((await getCurrentStudyFileAsync()) !== null)
    throw new DataRecoveryError("LOGOUT_STUDY_STILL_PRESENT");
  await completeDataLogoutAsync(owner);
}
