/**
 * A credential-free receipt that a saved configuration belongs to a fresh,
 * unfinished enrollment, not an established research session. This is never an
 * ownership claim and never permits reading, adopting, or deleting observations.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { StudyFileSchema } from "@wellping/study-schemas/lib/schemas/StudyFile";
import { StudyFile } from "@wellping/study-schemas/lib/types";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

import { IS_LOCAL_DEVELOPMENT, LOCAL_STORAGE_PREFIX } from "../../config/local";
import { ASYNC_STORAGE_WELLPING_PREFIX } from "./asyncStorage/asyncStorageConfig";
import { getCurrentStudyFileAsync } from "./asyncStorage/studyFile";
import { withDataJournalLockAsync } from "./dataJournal";
import { getInstallationIDAsync } from "./debug";

const KEY = `${LOCAL_STORAGE_PREFIX}pendingEnrollment.v1`;
type PendingEnrollment = { version: 1; studyFingerprint: string };
const recoveryMessage =
  "Saved enrollment requires recovery. Existing data has been preserved.";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          canonical((value as Record<string, unknown>)[key]),
        ]),
    );
  }
  return value;
}

async function installationAsync(): Promise<string> {
  const installation = await getInstallationIDAsync();
  if (
    !installation ||
    installation === "ASYNCGETINSTALLATIONIDERROR" ||
    !/^[A-Za-z0-9_.-]+$/.test(installation)
  )
    throw new Error(recoveryMessage);
  return installation;
}

async function fingerprintAsync(study: StudyFile): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify([
      "pending-enrollment-v1",
      LOCAL_STORAGE_PREFIX,
      await installationAsync(),
      canonical(StudyFileSchema.parse(study)),
    ]),
  );
}

function parseMarker(raw: string | null): PendingEnrollment | null {
  if (raw === null) return null;
  try {
    const marker = JSON.parse(raw);
    if (
      !marker ||
      Array.isArray(marker) ||
      Object.keys(marker).length !== 2 ||
      marker.version !== 1 ||
      typeof marker.studyFingerprint !== "string" ||
      !/^[a-f0-9]{64}$/.test(marker.studyFingerprint)
    )
      return null;
    return marker;
  } catch {
    return null;
  }
}

async function readUserAsync(study: StudyFile): Promise<string | null> {
  const prefix = IS_LOCAL_DEVELOPMENT ? "WELLPING_LOCAL" : "WELLPING";
  return SecureStore.getItemAsync(
    `${prefix}-${await installationAsync()}-Study_${study.studyInfo.id}.user`,
  );
}

async function hasStudyRecordsAsync(study: StudyFile): Promise<boolean> {
  const prefix = `${ASYNC_STORAGE_WELLPING_PREFIX}Study_${study.studyInfo.id}/`;
  // Do not infer that empty, corrupt, legacy, or another owner's records are
  // disposable. Any study-scoped metadata requires the normal recovery path.
  return (await AsyncStorage.getAllKeys()).some((key) =>
    key.startsWith(prefix),
  );
}

/** Called only on the explicit initial-login path, before saving its config. */
export function preparePendingEnrollmentAsync(study: StudyFile): Promise<void> {
  return withDataJournalLockAsync(async () => {
    const saved = await getCurrentStudyFileAsync();
    const rawMarker = await AsyncStorage.getItem(KEY);
    const marker = parseMarker(rawMarker);
    const studyFingerprint = await fingerprintAsync(study);
    if (
      (rawMarker !== null && marker === null) ||
      (saved !== null &&
        (marker?.studyFingerprint !== (await fingerprintAsync(saved)) ||
          marker.studyFingerprint !== studyFingerprint)) ||
      (await readUserAsync(study)) !== null ||
      (await hasStudyRecordsAsync(study))
    )
      throw new Error(recoveryMessage);

    // Persist first. A crash before the configuration write leaves harmless
    // metadata; a crash afterward leaves enough evidence to permit login retry.
    await AsyncStorage.setItem(
      KEY,
      JSON.stringify({ version: 1, studyFingerprint }),
    );
  });
}

/** False means ordinary recovery, never permission to clear an unknown study. */
export function isVerifiedPendingEnrollmentAsync(
  study: StudyFile,
): Promise<boolean> {
  return withDataJournalLockAsync(async () => {
    const marker = parseMarker(await AsyncStorage.getItem(KEY));
    if (!marker) return false;
    const saved = await getCurrentStudyFileAsync();
    const fingerprint = await fingerprintAsync(study);
    return (
      saved !== null &&
      marker.studyFingerprint === fingerprint &&
      (await fingerprintAsync(saved)) === fingerprint &&
      (await readUserAsync(study)) === null &&
      !(await hasStudyRecordsAsync(study))
    );
  });
}

/** Only remove our receipt once authentication has durably saved a user. */
export function completePendingEnrollmentAsync(): Promise<void> {
  return withDataJournalLockAsync(async () => {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw === null) return;
    const marker = parseMarker(raw);
    const saved = await getCurrentStudyFileAsync();
    if (
      !marker ||
      !saved ||
      marker.studyFingerprint !== (await fingerprintAsync(saved))
    )
      throw new Error(recoveryMessage);
    const rawUser = await readUserAsync(saved);
    if (rawUser === null) throw new Error(recoveryMessage);
    let user;
    try {
      user = JSON.parse(rawUser);
    } catch {
      throw new Error(recoveryMessage);
    }
    if (
      !user ||
      typeof user.username !== "string" ||
      !user.username ||
      typeof user.password !== "string" ||
      !Number.isFinite(user.loginDate)
    )
      throw new Error(recoveryMessage);
    await AsyncStorage.removeItem(KEY);
  });
}
