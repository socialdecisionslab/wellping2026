import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";

import type { SurveyScreenState } from "../../SurveyScreen";
import {
  clearChunkedValue,
  readChunkedValue,
  writeChunkedValue,
} from "../secureStore/chunkedValue";
import { secureGetPingAsync } from "../secureStore/ping";
import { getSSKeyAsync } from "../secureStore/secureStore";
import { secureGetUserAsync } from "../secureStore/user";
import { getASKeyAsync } from "./asyncStorage";

const PINGS_STATE_PREFIX = "PingsState:";
const INDEX = "secureResumeIndex.v1";
let operations: Promise<unknown> = Promise.resolve();
function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = operations.then(operation);
  operations = result.catch(() => undefined);
  return result;
}
async function keyFor(pingId: string) {
  const user = await secureGetUserAsync();
  if (!user)
    throw new Error(
      "Cannot access resume state without an active participant session.",
    );
  const identity = JSON.stringify([
    await getSSKeyAsync(),
    user.username,
    user.loginDate,
    pingId,
  ]);
  return `${
    (await getSSKeyAsync()).startsWith("WELLPING_LOCAL-")
      ? "WELLPING_LOCAL-"
      : ""
  }resume.v1.${await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    identity,
  )}`;
}
async function register(key: string) {
  const indexKey = await getASKeyAsync(INDEX);
  const keys: string[] = JSON.parse(
    (await AsyncStorage.getItem(indexKey)) || "[]",
  );
  if (!keys.includes(key))
    await AsyncStorage.setItem(indexKey, JSON.stringify([...keys, key]));
}
function parseState(value: string): SurveyScreenState {
  const state = JSON.parse(value);
  if (
    !state ||
    !state.currentQuestionData ||
    !Array.isArray(state.nextQuestionsDataStack) ||
    !state.answers ||
    typeof state.answers !== "object"
  ) {
    throw new Error("Invalid resume state; data preserved.");
  }
  return state;
}
export function storePingStateAsync(pingId: string, state: SurveyScreenState) {
  // Snapshot synchronously so subsequent UI state changes cannot affect this write.
  const value = JSON.stringify(state);
  return serialized(async () => {
    const key = await keyFor(pingId);
    await register(key);
    await writeChunkedValue(key, value);
    if ((await readChunkedValue(key)) !== value)
      throw new Error("Resume write verification failed.");
    await AsyncStorage.removeItem(
      `${await getASKeyAsync(PINGS_STATE_PREFIX)}${pingId}`,
    );
  });
}
export function getPingStateAsync(pingId: string): Promise<SurveyScreenState> {
  return serialized(async () => {
    const key = await keyFor(pingId);
    const value = await readChunkedValue(key);
    if (value !== null) return parseState(value);
    const legacyKey = `${await getASKeyAsync(PINGS_STATE_PREFIX)}${pingId}`;
    const legacy = await AsyncStorage.getItem(legacyKey);
    if (legacy === null)
      throw new Error(
        "No saved survey state is available. Existing responses have not been deleted.",
      );
    const user = await secureGetUserAsync();
    const ping = await secureGetPingAsync(pingId);
    // Old snapshots had only study scope. Never silently adopt a previous session's answers.
    if (
      !user ||
      !ping?.startTime ||
      ping.startTime.getTime() < user.loginDate
    ) {
      throw new Error(
        "Legacy resume ownership cannot be verified; data preserved for recovery.",
      );
    }
    const state = parseState(legacy);
    await register(key);
    await writeChunkedValue(key, legacy);
    if ((await readChunkedValue(key)) !== legacy)
      throw new Error("Resume migration verification failed.");
    await AsyncStorage.removeItem(legacyKey);
    return state;
  });
}
export function clearPingStateAsync(pingId: string) {
  return serialized(async () => {
    await clearChunkedValue(await keyFor(pingId));
    await AsyncStorage.removeItem(
      `${await getASKeyAsync(PINGS_STATE_PREFIX)}${pingId}`,
    );
  });
}
/** Call before deleting study/session information. Index contains opaque keys, never answers. */
export function clearAllPingStatesAsync() {
  return serialized(async () => {
    const indexKey = await getASKeyAsync(INDEX);
    const keys: string[] = JSON.parse(
      (await AsyncStorage.getItem(indexKey)) || "[]",
    );
    for (const key of keys) {
      if (!/^(WELLPING_LOCAL-)?resume\.v1\.[a-f0-9]{64}$/.test(key))
        throw new Error("Invalid resume index; cleanup stopped.");
      await clearChunkedValue(key);
    }
    const prefix = await getASKeyAsync(PINGS_STATE_PREFIX);
    for (const key of await AsyncStorage.getAllKeys())
      if (key.startsWith(prefix)) await AsyncStorage.removeItem(key);
    await AsyncStorage.removeItem(indexKey);
  });
}
