import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";

import type { SurveyScreenState } from "../../SurveyScreen";
import {
  assertDataOwnerAsync,
  captureCurrentDataOwnerAsync,
  DataOwner,
  getDataOwnerAsync,
  getResumeAnswersAsync,
} from "../dataJournal";
import {
  clearChunkedValue,
  readChunkedValue,
  SecureStorageIntegrityError,
  writeChunkedValue,
} from "../secureStore/chunkedValue";
import {
  LegacyResumeRecoveryError,
  quarantineLegacyResumeAsync,
} from "../secureStore/legacyResumeQuarantine";
import { getSSKeyAsync } from "../secureStore/secureStore";
import { getASKeyAsync } from "./asyncStorage";

export { LegacyResumeRecoveryError } from "../secureStore/legacyResumeQuarantine";
export class MissingResumeStateError extends Error {
  readonly code = "MISSING_RESUME_STATE";
  constructor() {
    super(
      "No saved survey state is available. Existing responses have not been deleted.",
    );
    this.name = "MissingResumeStateError";
  }
}
const PINGS_STATE_PREFIX = "PingsState:";
const INDEX = "secureResumeIndex.v1";
const KEY_PATTERN = /^(WELLPING_LOCAL-)?resume\.v1\.[a-f0-9]{64}$/;
let operations: Promise<unknown> = Promise.resolve();
function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = operations.then(operation);
  operations = result.catch(() => undefined);
  return result;
}
type ResumeScope = { indexKey: string; legacyPrefix: string; local: boolean };
async function scopeFor(): Promise<ResumeScope> {
  return {
    indexKey: await getASKeyAsync(INDEX),
    legacyPrefix: await getASKeyAsync(PINGS_STATE_PREFIX),
    local: (await getSSKeyAsync()).startsWith("WELLPING_LOCAL-"),
  };
}
function serializedForOwner<T>(
  operation: (owner: DataOwner, scope: ResumeScope) => Promise<T>,
): Promise<T> {
  // Capture the requesting session before waiting behind another resume operation.
  const captured = captureCurrentDataOwnerAsync();
  void captured.catch(() => undefined);
  return serialized(async () => {
    const owner = await captured;
    await assertDataOwnerAsync(owner);
    const scope = await scopeFor();
    await assertDataOwnerAsync(owner);
    const result = await operation(owner, scope);
    // Never return old-session state combined with a newly logged-in owner's answers.
    await assertDataOwnerAsync(owner);
    return result;
  });
}
async function keyFor(pingId: string, expected: DataOwner) {
  const owner = await getDataOwnerAsync();
  if (owner.id !== expected.id)
    throw new SecureStorageIntegrityError(
      "Participant session changed; data preserved.",
    );
  const scope = expected.secureNamespace;
  // Retain the PR6 namespace. Durable ownership validation is separate, not inferred
  // from ping timestamps or silently assigned to whichever participant is logged in.
  const identity = JSON.stringify([
    scope,
    expected.username,
    expected.loginDate,
    pingId,
  ]);
  return `${
    scope.startsWith("WELLPING_LOCAL-") ? "WELLPING_LOCAL-" : ""
  }resume.v1.${await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    identity,
  )}`;
}
async function readIndex(scope: ResumeScope): Promise<string[]> {
  const raw = await AsyncStorage.getItem(scope.indexKey);
  if (raw === null) return [];
  let keys: unknown;
  try {
    keys = JSON.parse(raw);
  } catch (_) {
    throw new SecureStorageIntegrityError(
      "Invalid resume index; data preserved.",
    );
  }
  if (
    !Array.isArray(keys) ||
    !keys.every((key) => typeof key === "string" && KEY_PATTERN.test(key)) ||
    new Set(keys).size !== keys.length
  )
    throw new SecureStorageIntegrityError(
      "Invalid resume index; data preserved.",
    );
  if (keys.some((key) => key.startsWith("WELLPING_LOCAL-") !== scope.local))
    throw new SecureStorageIntegrityError(
      "Invalid resume index; data preserved.",
    );
  return keys;
}
async function register(key: string, scope: ResumeScope) {
  const indexKey = scope.indexKey;
  const keys = await readIndex(scope);
  if (!keys.includes(key)) {
    const value = JSON.stringify([...keys, key]);
    await AsyncStorage.setItem(indexKey, value);
    if ((await AsyncStorage.getItem(indexKey)) !== value)
      throw new SecureStorageIntegrityError(
        "Resume index verification failed; data preserved.",
      );
  }
}
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
function parseState(value: string): SurveyScreenState {
  let state;
  try {
    state = JSON.parse(value);
  } catch (_) {
    throw new SecureStorageIntegrityError(
      "Invalid resume state; data preserved.",
    );
  }
  if (
    !isObject(state) ||
    !isObject(state.currentQuestionData) ||
    !(
      state.currentQuestionData.questionId === null ||
      typeof state.currentQuestionData.questionId === "string"
    ) ||
    !isObject(state.currentQuestionData.extraData) ||
    !Array.isArray(state.nextQuestionsDataStack) ||
    !state.nextQuestionsDataStack.every(
      (question) =>
        isObject(question) &&
        typeof question.questionId === "string" &&
        isObject(question.extraData),
    ) ||
    !isObject(state.answers) ||
    typeof state.isInTransition !== "boolean"
  )
    throw new SecureStorageIntegrityError(
      "Invalid resume state; data preserved.",
    );
  return state as unknown as SurveyScreenState;
}
async function reconcileAnswers(
  pingId: string,
  state: SurveyScreenState,
  owner: DataOwner,
) {
  // Answer writes precede snapshot writes. A crash between them must not restore
  // a stale answer, including questions whose real IDs depend on extraData.
  const answers = { ...state.answers };
  for (const answer of await getResumeAnswersAsync(pingId, owner.id)) {
    const questionId = answer.questionId;
    Object.defineProperty(answers, questionId, {
      value: answer,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return { ...state, answers, isInTransition: false };
}
export function storePingStateAsync(pingId: string, state: SurveyScreenState) {
  // Snapshot synchronously so subsequent UI state changes cannot affect this write.
  const value = JSON.stringify(state);
  return serializedForOwner(async (owner, scope) => {
    parseState(value);
    await quarantineLegacyResumeAsync(`${scope.legacyPrefix}${pingId}`);
    const key = await keyFor(pingId, owner);
    await register(key, scope);
    await writeChunkedValue(key, value);
    if ((await readChunkedValue(key)) !== value)
      throw new SecureStorageIntegrityError(
        "Resume write verification failed.",
      );
  });
}
export function getPingStateAsync(pingId: string): Promise<SurveyScreenState> {
  return serializedForOwner(async (owner, scope) => {
    const legacyKey = `${scope.legacyPrefix}${pingId}`;
    const quarantined = await quarantineLegacyResumeAsync(legacyKey);
    const key = await keyFor(pingId, owner);
    const value = await readChunkedValue(key);
    if (value !== null)
      return reconcileAnswers(pingId, parseState(value), owner);
    if (quarantined) throw new LegacyResumeRecoveryError();
    // An indexed manifest disappearing is damage, not a newly started survey.
    if ((await readIndex(scope)).includes(key))
      throw new SecureStorageIntegrityError(
        "Indexed resume data is unavailable; data preserved.",
      );
    throw new MissingResumeStateError();
  });
}
export function clearPingStateAsync(pingId: string) {
  return serializedForOwner(async (owner, scope) => {
    await quarantineLegacyResumeAsync(`${scope.legacyPrefix}${pingId}`);
    const key = await keyFor(pingId, owner);
    await clearChunkedValue(key);
    // Keep the index during deletion; remove its entry only after chunk cleanup succeeds.
    const keys = await readIndex(scope);
    if (keys.includes(key)) {
      await AsyncStorage.setItem(
        scope.indexKey,
        JSON.stringify(keys.filter((entry) => entry !== key)),
      );
    }
  });
}
/** Call before deleting study/session information. Recovery quarantine is intentionally
 * excluded: old study-scoped records have no verified participant owner. */
export function clearAllPingStatesAsync() {
  return serialized(async () => {
    const scope = await scopeFor();
    const keys = await readIndex(scope);
    const prefix = scope.legacyPrefix;
    for (const key of await AsyncStorage.getAllKeys())
      if (key.startsWith(prefix)) await quarantineLegacyResumeAsync(key);
    for (const key of keys) await clearChunkedValue(key);
    await AsyncStorage.removeItem(scope.indexKey);
  });
}
