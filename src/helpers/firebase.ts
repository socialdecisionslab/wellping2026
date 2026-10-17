/**
 * Unless otherwise noted, precondition for every function in the file is:
 * `isUsingFirebase(studyInfo) === true`.
 */

import { StudyInfo } from "@wellping/study-schemas/lib/types";
import * as Crypto from "expo-crypto";
import {
  initializeApp as firebaseInitializeApp,
  getApp as firebaseGetApp,
  deleteApp as firebaseDeleteApp,
  FirebaseApp,
} from "firebase/app";
import {
  getAuth as firebaseGetAuth,
  signInWithEmailAndPassword as firebaseSignInWithEmailAndPassword,
  signOut as firebaseSignOut,
  Auth as FirebaseAuth,
  UserCredential as FirebaseUserCredential,
} from "firebase/auth";
import {
  getDatabase as firebaseGetDatabase,
  ref as firebaseRef,
  get as firebaseGet,
  update as firebaseUpdate,
  Database as FirebaseDatabase,
} from "firebase/database";

import { withDataJournalLockAsync } from "./dataJournal";
import {
  UploadData,
  getUploadDataType,
  UploadDataType,
  AllData,
  UnuploadedData,
} from "./dataUploadType";
import { getLoginSessionIDAsync } from "./loginSession";
import { getHttpsOrigin } from "./networkSafety";
import { User, secureGetUserAsync } from "./secureStore/user";
import { DataUploadServerResponse, getFirebaseServerConfig } from "./server";
import { getStudyInfoAsync } from "./studyFile";

/**
 * Firebase requires to use an email as the user's login name.
 * So we add a fictional email domain to the actual username.
 */
const FIREBASE_LOGIN_EMAIL_DOMAIN = "@user.wellpingssnl";
const getFirebaseLoginEmail = (username: string): string =>
  username + FIREBASE_LOGIN_EMAIL_DOMAIN;

export function getFirebaseApp(): FirebaseApp {
  try {
    return firebaseGetApp();
  } catch (e) {
    throw new Error(`firebaseApp not initialized!`);
  }
}
async function deleteFirebaseAppAsync(): Promise<void> {
  await firebaseDeleteApp(getFirebaseApp());
}

export function getFirebaseAuth(): FirebaseAuth {
  return firebaseGetAuth(getFirebaseApp());
}

export function getFirebaseDatabase(): FirebaseDatabase {
  const app = getFirebaseApp();
  return firebaseGetDatabase(app, app.options.databaseURL);
}

export function validateAndInitializeFirebaseWithConfig(studyInfo: StudyInfo) {
  if (!firebaseInitialized()) {
    firebaseInitializeApp(getFirebaseServerConfig(studyInfo).config);
  }

  try {
    assertFirebaseConfig(getFirebaseApp(), studyInfo);
    // Construct Auth to validate the configuration without making a request.
    getFirebaseAuth();
  } catch (e) {
    const message =
      "Firebase configuration is invalid. Please contact study staff.";
    throw new Error(message);
  }
}

export function firebaseInitialized(): boolean {
  try {
    firebaseGetApp();
    return true;
  } catch (e) {
    return false;
  }
}

export async function firebaseLoginAsync(
  user: User,
): Promise<FirebaseUserCredential> {
  try {
    const auth = getFirebaseAuth();
    const userCredential = await firebaseSignInWithEmailAndPassword(
      auth,
      getFirebaseLoginEmail(user.username),
      user.password,
    );
    if (!userCredential.user?.emailVerified) {
      // If the email is not verified, we know that this is not a pre-imported
      // user (as all pre-imported users have a verified fictional email
      // address). And they should not use the app.
      // See `MARK: FIREBASE_AUTH_VERIFIED_FICTIONAL_EMAIL_NOTE`.
      throw new Error(":( Why are you doing this?");
    }
    return userCredential;
  } catch (error) {
    throw new Error(
      "Unable to sign in. Please check your login code or contact study staff.",
    );
  }
}

/**
 * Special precondition: `firebaseInitialized() === true`. We don't need to
 * check for `isUsingFirebase(studyInfo)` for this function.
 */
export async function firebaseLogoutAndDeleteAppAsync(): Promise<void> {
  const auth = getFirebaseAuth();
  if (auth.currentUser !== null) await firebaseSignOut(auth);
  await deleteFirebaseAppAsync();
}

/** Compare actual SDK configuration, not just the selected study's label. */
function assertFirebaseConfig(app: FirebaseApp, studyInfo: StudyInfo): void {
  const expected = getFirebaseServerConfig(studyInfo).config;
  const actual = app.options as Record<string, string | undefined>;
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  if (
    !expected.databaseURL ||
    [...keys].some((key) => expected[key] !== actual[key])
  ) {
    throw new Error("The Firebase destination changed. Please sign in again.");
  }
  getHttpsOrigin(expected.databaseURL);
}

function assertPathComponent(value: string): void {
  if (!value || /[.#$[\]/\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("Invalid upload session.");
  }
}

type RemoteRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is RemoteRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function logicalIdentity(
  value: unknown,
  collection: "pings" | "answers",
): string | null {
  if (!isRecord(value)) return null;
  const parts =
    collection === "pings" ? [value.id] : [value.pingId, value.questionId];
  if (parts.some((part) => typeof part !== "string" || !part)) return null;
  // A tuple avoids ambiguous concatenations, including question placeholders.
  return JSON.stringify(parts);
}

async function makeRecordUpdatesAsync(
  collection: "pings" | "answers",
  records: unknown[],
  previous: unknown,
): Promise<Record<string, unknown>> {
  if (previous != null && !isRecord(previous)) {
    throw new Error("The study server returned invalid saved records.");
  }
  const remote = (previous || {}) as RemoteRecord;
  const existingKeys = new Map<string, string>();
  // Keep an existing legacy push key, so retrying old records does not create
  // another copy. Existing duplicates are not deleted or silently migrated.
  Object.keys(remote)
    .sort()
    .forEach((key) => {
      const identity = logicalIdentity(remote[key], collection);
      if (identity !== null && !existingKeys.has(identity)) {
        existingKeys.set(identity, key);
      }
    });

  const updates: Record<string, unknown> = {};
  for (const record of records) {
    const identity = logicalIdentity(record, collection);
    if (identity === null) throw new Error("Invalid upload record identity.");
    const deterministicKey = `v1_${await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      identity,
    )}`;
    const deterministicRecord = remote[deterministicKey];
    if (
      deterministicRecord !== undefined &&
      logicalIdentity(deterministicRecord, collection) !== identity
    ) {
      throw new Error("The study server returned conflicting saved records.");
    }
    const key =
      deterministicRecord !== undefined
        ? deterministicKey
        : existingKeys.get(identity) || deterministicKey;
    assertPathComponent(key);
    updates[`${collection}/${key}`] = record;
  }
  return updates;
}

/**
 * Send one atomic, non-destructive update to the captured session. Logical
 * record keys are stable across retries, including a lost acknowledgement.
 * This is not a global exactly-once or revision-ordering guarantee: overlapping
 * clients writing the same key remain last-write-wins, and an old push-based
 * client can still create duplicates. Server-enforced revision/conflict rules
 * need a verified backend contract before changing that behavior.
 */
export async function firebaseUploadDataForUserAsync(
  data: UploadData,
  localUser: User,
  startUploading: () => void,
  endUploading: (errorMessage?: string) => void,
  capturedStudyInfo?: StudyInfo,
): Promise<DataUploadServerResponse> {
  startUploading();

  try {
    // Detach caller-owned objects before the first asynchronous operation.
    const payload = JSON.parse(JSON.stringify(data)) as UploadData;
    const expectedUser = { ...localUser };
    const expectedStudy = JSON.parse(
      JSON.stringify(capturedStudyInfo ?? (await getStudyInfoAsync())),
    ) as StudyInfo;
    const app = getFirebaseApp();
    const auth = getFirebaseAuth();
    const user = auth.currentUser;
    if (
      user === null ||
      !user.emailVerified ||
      user.email !== getFirebaseLoginEmail(expectedUser.username)
    ) {
      throw new Error("The Firebase account does not match this upload.");
    }
    const uid = user.uid;
    const sessionId = payload.user.loginSessionId;
    assertPathComponent(uid);
    assertPathComponent(sessionId);

    const assertFirebaseAccount = (): void => {
      if (
        getFirebaseApp() !== app ||
        getFirebaseAuth() !== auth ||
        auth.currentUser !== user ||
        user.uid !== uid ||
        !user.emailVerified ||
        user.email !== getFirebaseLoginEmail(expectedUser.username)
      ) {
        throw new Error("The Firebase account changed. Please try again.");
      }
    };

    const assertCurrentDestinationAsync = async (): Promise<void> => {
      const currentUser = await secureGetUserAsync();
      if (
        currentUser === null ||
        currentUser.username !== expectedUser.username ||
        currentUser.password !== expectedUser.password ||
        currentUser.loginDate !== expectedUser.loginDate ||
        payload.user.username !== expectedUser.username ||
        (await getLoginSessionIDAsync(expectedUser)) !== sessionId
      ) {
        throw new Error("The upload session changed. Please try again.");
      }
      const currentStudy = await getStudyInfoAsync();
      if (currentStudy.id !== expectedStudy.id) {
        throw new Error("The upload study changed. Please try again.");
      }
      assertFirebaseConfig(app, expectedStudy);
      assertFirebaseConfig(app, currentStudy);
      assertFirebaseAccount();
    };

    await assertCurrentDestinationAsync();
    const database = firebaseGetDatabase(app, app.options.databaseURL);
    const root = firebaseRef(database, `users/${uid}/${sessionId}/`);
    // A failed read must not fall back to new keys: old push keys may exist.
    assertFirebaseAccount();
    const before = await firebaseGet(root);
    const previous: unknown = before.val();
    if (previous != null && !isRecord(previous)) {
      throw new Error("The study server returned invalid session data.");
    }
    const remote = (previous || {}) as RemoteRecord;
    if (
      remote.user != null &&
      (!isRecord(remote.user) ||
        remote.user.username !== payload.user.username ||
        remote.user.loginSessionId !== sessionId)
    ) {
      throw new Error("The study server session does not match this upload.");
    }

    const unuploaded =
      getUploadDataType(payload) === UploadDataType.UNUPLOADED_DATA;
    const pings = unuploaded
      ? (payload as UnuploadedData).unuploadedPings
      : (payload as AllData).pings;
    const answers = unuploaded
      ? (payload as UnuploadedData).unuploadedAnswers
      : (payload as AllData).answers;
    const updates = {
      ...(await makeRecordUpdatesAsync("pings", pings, remote.pings)),
      ...(await makeRecordUpdatesAsync("answers", answers, remote.answers)),
      user: payload.user,
    };

    // Keep enrollment changes out of the final check-to-send window. Return a
    // wrapped promise so the journal lock never waits for the network response.
    const { request } = await withDataJournalLockAsync(async () => {
      await assertCurrentDestinationAsync();
      // Auth events are not serialized by the storage lock. Recheck synchronously
      // after the async guard, with no yield between this check and the write.
      assertFirebaseAccount();
      // Child paths preserve remote-only records and unrelated concurrent writes.
      // Pings, answers, and user metadata either all commit or none commit.
      return { request: firebaseUpdate(root, updates) };
    });
    await request;
    await assertCurrentDestinationAsync();
    const after = await firebaseGet(root);
    if (!after.exists()) {
      throw new Error("The study server could not verify the uploaded data.");
    }
    await assertCurrentDestinationAsync();
    endUploading();
    return {
      new_pings_count: after.child("pings").size,
      new_answers_count: after.child("answers").size,
    };
  } catch (error) {
    endUploading("FDB: upload failed");
    throw error;
  }
}
