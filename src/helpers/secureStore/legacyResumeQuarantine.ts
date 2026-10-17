import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";

import { ASYNC_STORAGE_WELLPING_PREFIX } from "../asyncStorage/asyncStorageConfig";
import {
  readChunkedValue,
  UncommittedChunkedValueError,
  writeChunkedValue,
} from "./chunkedValue";
import { getSSKeyAsync } from "./secureStore";

// Global rather than study/session scoped: recovery remains discoverable after logout.
// The index contains only opaque keys. Source names and exact legacy strings are encrypted.
const INDEX = `${ASYNC_STORAGE_WELLPING_PREFIX}legacyResumeQuarantineIndex.v1`;
const KEY_PATTERN =
  /^(WELLPING_LOCAL-)?legacyResumeQuarantine\.v1\.[a-f0-9]{64}\.[a-f0-9]{64}$/;
const hash = (value: string) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
export type LegacyResumeRecoveryRecord = {
  version: 1;
  secureScope: string;
  sourceKey: string;
  value: string;
};
export class LegacyResumeRecoveryError extends Error {
  readonly code = "LEGACY_RESUME_RECOVERY";
  constructor() {
    super(
      "Legacy survey data requires recovery. Existing responses have not been discarded.",
    );
    this.name = "LegacyResumeRecoveryError";
  }
}
function validKey(key: unknown): key is string {
  return (
    typeof key === "string" &&
    KEY_PATTERN.test(key) &&
    key.startsWith("WELLPING_LOCAL-") ===
      ASYNC_STORAGE_WELLPING_PREFIX.startsWith("LOCAL_ONLY:")
  );
}
/** Read-only recovery inventory; never treats an unreadable index as empty. */
export async function listLegacyResumeQuarantineAsync(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(INDEX);
  if (raw === null) return [];
  let keys: unknown;
  try {
    keys = JSON.parse(raw);
  } catch (_) {
    throw new LegacyResumeRecoveryError();
  }
  if (
    !Array.isArray(keys) ||
    !keys.every(validKey) ||
    new Set(keys).size !== keys.length
  )
    throw new LegacyResumeRecoveryError();
  return keys;
}
async function sourcePrefix(sourceKey: string, secureScope: string) {
  return `${
    secureScope.startsWith("WELLPING_LOCAL-") ? "WELLPING_LOCAL-" : ""
  }legacyResumeQuarantine.v1.${await hash(
    JSON.stringify([secureScope, sourceKey]),
  )}.`;
}
async function recordKey(record: LegacyResumeRecoveryRecord) {
  return `${await sourcePrefix(
    record.sourceKey,
    record.secureScope,
  )}${await hash(JSON.stringify(record))}`;
}
/** Recovery tooling can inspect records explicitly, without assigning them to a participant. */
export async function readLegacyResumeQuarantineAsync(
  key: string,
): Promise<LegacyResumeRecoveryRecord> {
  if (
    !validKey(key) ||
    !(await listLegacyResumeQuarantineAsync()).includes(key)
  )
    throw new LegacyResumeRecoveryError();
  try {
    const value = await readChunkedValue(key);
    if (value === null) throw new LegacyResumeRecoveryError();
    const record = JSON.parse(value);
    if (
      !record ||
      typeof record !== "object" ||
      Array.isArray(record) ||
      Object.keys(record).length !== 4 ||
      !Object.keys(record).every((field) =>
        ["version", "secureScope", "sourceKey", "value"].includes(field),
      ) ||
      record.version !== 1 ||
      typeof record.secureScope !== "string" ||
      typeof record.sourceKey !== "string" ||
      typeof record.value !== "string" ||
      (await recordKey(record)) !== key
    )
      throw new LegacyResumeRecoveryError();
    return record;
  } catch (_) {
    throw new LegacyResumeRecoveryError();
  }
}
export async function hasLegacyResumeQuarantineAsync(
  sourceKey: string,
): Promise<boolean> {
  const prefix = await sourcePrefix(sourceKey, await getSSKeyAsync());
  const keys = (await listLegacyResumeQuarantineAsync()).filter((key) =>
    key.startsWith(prefix),
  );
  // A registered but incomplete/corrupt recovery record must never become "missing".
  for (const key of keys) await readLegacyResumeQuarantineAsync(key);
  return keys.length > 0;
}
/** Caller serializes operations. Preserve the source string exactly, not parsed/re-serialized.
 * A durable intent index precedes encrypted writes. Source removal requires both verified
 * ciphertext and a verified index, and is retried safely after process interruption. */
export async function quarantineLegacyResumeAsync(
  sourceKey: string,
): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(sourceKey);
    if (value === null) return hasLegacyResumeQuarantineAsync(sourceKey);
    const record: LegacyResumeRecoveryRecord = {
      version: 1,
      secureScope: await getSSKeyAsync(),
      sourceKey,
      value,
    };
    const key = await recordKey(record);
    if (!validKey(key)) throw new LegacyResumeRecoveryError();
    const keys = await listLegacyResumeQuarantineAsync();
    if (!keys.includes(key)) {
      const next = JSON.stringify([...keys, key]);
      await AsyncStorage.setItem(INDEX, next);
      if ((await AsyncStorage.getItem(INDEX)) !== next)
        throw new LegacyResumeRecoveryError();
    }
    const serialized = JSON.stringify(record);
    let existing: string | null;
    try {
      existing = await readChunkedValue(key);
    } catch (error) {
      if (!(error instanceof UncommittedChunkedValueError)) throw error;
      existing = null; // Exact source is still present; retry the interrupted copy.
    }
    if (existing === null) await writeChunkedValue(key, serialized);
    else if (existing !== serialized) throw new LegacyResumeRecoveryError();
    const verified = await readLegacyResumeQuarantineAsync(key);
    if (JSON.stringify(verified) !== serialized)
      throw new LegacyResumeRecoveryError();
    if ((await AsyncStorage.getItem(sourceKey)) !== value)
      throw new LegacyResumeRecoveryError();
    await AsyncStorage.removeItem(sourceKey);
    if ((await AsyncStorage.getItem(sourceKey)) !== null)
      throw new LegacyResumeRecoveryError();
    return true;
  } catch (_) {
    throw new LegacyResumeRecoveryError();
  }
}
