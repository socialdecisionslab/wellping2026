/**
 * Durable, owner-isolated research records. All callers share one operation lane.
 * A discoverable preparing/ready/applied WAL is published before primary writes;
 * replay is idempotent and never stores responses in AsyncStorage. Network work
 * must happen after captureDataSnapshotAsync returns, outside this lane.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Answer } from "@wellping/study-schemas/lib/answerTypes";
import { AnswerSchema } from "@wellping/study-schemas/lib/schemas/Answer";
import { PingSchema } from "@wellping/study-schemas/lib/schemas/Ping";
import { Ping, StreamName, StudyInfo } from "@wellping/study-schemas/lib/types";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import uuid from "react-native-uuid";

import { getASKeyAsync } from "./asyncStorage/asyncStorage";
import { getInstallationIDAsync } from "./debug";
import {
  clearChunkedValue,
  readChunkedValue,
  writeChunkedValue,
  UncommittedChunkedValueError,
} from "./secureStore/chunkedValue";
import { getSSKeyAsync } from "./secureStore/secureStore";
import { secureGetUserAsync, User } from "./secureStore/user";
import { getStudyInfoAsync } from "./studyFile";

export class DataRecoveryError extends Error {
  readonly code: string;
  constructor(
    code: string,
    message = "Saved research data needs recovery. Existing data has been preserved.",
  ) {
    super(message);
    this.name = "DataRecoveryError";
    this.code = code;
  }
}
export type DataOwner = {
  id: string;
  secureNamespace: string;
  studyId: string;
  installationId: string;
  username: string;
  loginDate: number;
  loginSessionId: string;
};
export type DataSnapshot = {
  owner: DataOwner;
  /** Internal authentication context only. Never include this property in exports. */
  user: User;
  studyInfo: StudyInfo;
  pings: Ping[];
  answers: Answer[];
  revisions: Record<string, number>;
};
type Context = {
  owner: DataOwner;
  user: User;
  studyInfo: StudyInfo;
  registryKey: string;
  legacyPrefix: string;
  base: string;
};
type Index = {
  version: 1;
  ownerId: string;
  sequence: number;
  pings: string[];
  answers: Record<string, string[]>;
  revisions: Record<string, number>;
  dirty: Record<string, number>;
  nextByStream: Record<string, number>;
  insertions: Record<string, string>;
  expiry: Record<string, number | null>;
};
type Registry = {
  version: 1;
  owners: { id: string; state: "preparing" | "ready" }[];
};
type Mutation = {
  kind: "ping" | "answer";
  pingId: string;
  questionId?: string;
  value: string | null;
};
type Transaction = {
  version: 1;
  id: string;
  ownerId: string;
  mutations: Mutation[];
  index: Index;
};
type Head = {
  version: 1;
  id: string;
  ownerId: string;
  state: "preparing" | "ready" | "applied";
  sequence: number;
  digest: string;
  indexDigest: string;
};
const options = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const digest = (value: string) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
const isHash = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isCount = (v: unknown): v is number =>
  Number.isSafeInteger(v) && (v as number) >= 0;
const own = (v: object, k: string) =>
  Object.prototype.hasOwnProperty.call(v, k);
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const object = (v: unknown): v is Record<string, any> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
function keys(
  v: Record<string, any>,
  required: string[],
  optional: string[] = [],
) {
  return (
    required.every((k) => own(v, k)) &&
    Object.keys(v).every((k) => required.includes(k) || optional.includes(k))
  );
}
function recovery(code: string): never {
  throw new DataRecoveryError(code);
}
function parse(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return recovery("MALFORMED_DATA");
  }
}
let operations: Promise<unknown> = Promise.resolve();
/** Do not call another journal API inside this callback (the lane is non-reentrant). */
export function withDataJournalLockAsync<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const result = operations.then(operation);
  operations = result.catch(() => undefined);
  return result;
}
function parsePing(value: string): Ping {
  try {
    const p = parse(value);
    if (
      !object(p) ||
      !keys(p, [
        "id",
        "notificationTime",
        "startTime",
        "endTime",
        "tzOffset",
        "streamName",
      ]) ||
      typeof p.startTime !== "string" ||
      typeof p.notificationTime !== "string" ||
      !(p.endTime === null || typeof p.endTime === "string")
    )
      recovery("INVALID_PING");
    return PingSchema.parse({
      ...p,
      startTime: new Date(p.startTime),
      notificationTime: new Date(p.notificationTime),
      endTime: p.endTime === null ? null : new Date(p.endTime),
    });
  } catch (error) {
    if (error instanceof DataRecoveryError) throw error;
    return recovery("INVALID_PING");
  }
}
function parseAnswer(value: string): Answer {
  try {
    const a = parse(value);
    if (
      !object(a) ||
      !keys(a, ["pingId", "questionId", "preferNotToAnswer", "data", "date"]) ||
      typeof a.date !== "string"
    )
      recovery("INVALID_ANSWER");
    return AnswerSchema.parse({ ...a, date: new Date(a.date) });
  } catch (error) {
    if (error instanceof DataRecoveryError) throw error;
    return recovery("INVALID_ANSWER");
  }
}
async function readValue(key: string) {
  try {
    return await readChunkedValue(key);
  } catch (error) {
    if (error instanceof UncommittedChunkedValueError) throw error;
    throw new DataRecoveryError("DAMAGED_SECURE_RECORD");
  }
}
async function captureContext(): Promise<Context> {
  const secureNamespace = await getSSKeyAsync();
  const studyInfo = await getStudyInfoAsync();
  const installationId = await getInstallationIDAsync();
  const active = await secureGetUserAsync();
  if (!active || !isId(active.username) || !Number.isFinite(active.loginDate))
    recovery("NO_ACTIVE_OWNER");
  const user = copy(active);
  const studyId = String(studyInfo.id);
  if (!isId(installationId) || installationId === "ASYNCGETINSTALLATIONIDERROR")
    recovery("INSTALLATION_UNAVAILABLE");
  const legacyPrefix = await getASKeyAsync();
  const identity = JSON.stringify([
    secureNamespace,
    studyId,
    installationId,
    user.username,
    user.loginDate,
  ]);
  const id = await digest(identity);
  if (secureNamespace !== (await getSSKeyAsync())) recovery("OWNER_CHANGED");
  const owner: DataOwner = {
    id,
    secureNamespace,
    studyId,
    installationId,
    username: user.username,
    loginDate: user.loginDate,
    loginSessionId: `${user.username}-${installationId}-${user.loginDate}`,
  };
  return {
    owner,
    user,
    studyInfo: copy(studyInfo),
    legacyPrefix,
    registryKey: `${legacyPrefix}dataJournal.v1.owners`,
    base: `${secureNamespace}dataJournal.v1.${id}`,
  };
}
async function assertContext(context: Context) {
  if ((await captureContext()).owner.id !== context.owner.id)
    recovery("OWNER_CHANGED");
}
/** Captures identity without creating/adopting any research records. */
export async function captureCurrentDataOwnerAsync(): Promise<DataOwner> {
  return withDataJournalLockAsync(async () =>
    copy((await captureContext()).owner),
  );
}
/** Use immediately before dispatching a captured upload to its captured destination. */
/** Read-only guard for callers already holding withDataJournalLockAsync. */
export async function assertDataOwnerInsideLockAsync(
  owner: DataOwner,
): Promise<void> {
  const expectedId = owner.id;
  if ((await captureContext()).owner.id !== expectedId)
    recovery("OWNER_CHANGED");
}
export function assertDataOwnerAsync(owner: DataOwner): Promise<void> {
  const expected = copy(owner);
  return withDataJournalLockAsync(async () => {
    if ((await captureContext()).owner.id !== expected.id)
      recovery("OWNER_CHANGED");
  });
}
function emptyIndex(ownerId: string): Index {
  return {
    version: 1,
    ownerId,
    sequence: 0,
    pings: [],
    answers: {},
    revisions: {},
    dirty: {},
    nextByStream: {},
    insertions: {},
    expiry: {},
  };
}
function validateIndex(value: unknown, ownerId: string): Index {
  if (
    !object(value) ||
    !keys(value, [
      "version",
      "ownerId",
      "sequence",
      "pings",
      "answers",
      "revisions",
      "dirty",
      "nextByStream",
      "insertions",
      "expiry",
    ]) ||
    value.version !== 1 ||
    value.ownerId !== ownerId ||
    !isCount(value.sequence) ||
    !Array.isArray(value.pings) ||
    !value.pings.every(isId) ||
    new Set(value.pings).size !== value.pings.length ||
    ![
      value.answers,
      value.revisions,
      value.dirty,
      value.nextByStream,
      value.insertions,
      value.expiry,
    ].every(object)
  )
    recovery("INVALID_INDEX");
  const result = value as Index;
  for (const id of result.pings) {
    if (
      !own(result.answers, id) ||
      !Array.isArray(result.answers[id]) ||
      !result.answers[id].every(isId) ||
      new Set(result.answers[id]).size !== result.answers[id].length ||
      !own(result.expiry, id) ||
      !(
        result.expiry[id] === null ||
        (Number.isFinite(result.expiry[id]) &&
          Number.isFinite(new Date(result.expiry[id] as number).getTime()))
      ) ||
      !own(result.revisions, id) ||
      !isCount(result.revisions[id]) ||
      result.revisions[id] < 1
    )
      recovery("INVALID_INDEX");
  }
  if (
    [
      ...Object.keys(result.answers),
      ...Object.keys(result.revisions),
      ...Object.keys(result.dirty),
      ...Object.keys(result.expiry),
    ].some((id) => !result.pings.includes(id))
  )
    recovery("ORPHAN_INDEX");
  if (
    Object.keys(result.dirty).some(
      (id) => result.dirty[id] !== result.revisions[id],
    )
  )
    recovery("INVALID_DIRTY_REVISION");
  if (Object.values(result.nextByStream).some((v) => !isCount(v)))
    recovery("INVALID_ALLOCATION");
  if (Object.values(result.insertions).some((id) => !result.pings.includes(id)))
    recovery("INVALID_INSERTION_TOKEN");
  return result;
}
async function readIndex(context: Context): Promise<Index> {
  const value = await readValue(`${context.base}.index`);
  if (value === null) recovery("MISSING_INDEX");
  return validateIndex(parse(value), context.owner.id);
}
function validateRegistry(value: unknown): Registry {
  if (
    !object(value) ||
    !keys(value, ["version", "owners"]) ||
    value.version !== 1 ||
    !Array.isArray(value.owners) ||
    !value.owners.every(
      (entry: any) =>
        object(entry) &&
        keys(entry, ["id", "state"]) &&
        isHash(entry.id) &&
        ["preparing", "ready"].includes(entry.state),
    ) ||
    new Set(value.owners.map((entry: any) => entry.id)).size !==
      value.owners.length
  )
    recovery("INVALID_OWNER_REGISTRY");
  return value as Registry;
}
async function checkLegacy(
  context: Context,
  pingId?: string,
  questionId?: string,
) {
  const oldKeys = pingId === undefined ? await AsyncStorage.getAllKeys() : [];
  if (
    oldKeys.some(
      (key) =>
        key === `${context.legacyPrefix}pingsList` ||
        key === `${context.legacyPrefix}unuploadedPingsList` ||
        key.startsWith(`${context.legacyPrefix}answersList/`),
    )
  )
    recovery("LEGACY_OWNERSHIP_UNVERIFIED");
  if (
    pingId !== undefined &&
    (await SecureStore.getItemAsync(
      `${context.owner.secureNamespace}ping.${pingId}`,
      options,
    )) !== null
  )
    recovery("LEGACY_OWNERSHIP_UNVERIFIED");
  if (
    pingId !== undefined &&
    questionId !== undefined &&
    /^[A-Za-z0-9_.-]+$/.test(questionId) &&
    (await SecureStore.getItemAsync(
      `${context.owner.secureNamespace}answer.${pingId}.${questionId}`,
      options,
    )) !== null
  )
    recovery("LEGACY_OWNERSHIP_UNVERIFIED");
}
async function ensureOwner(context: Context): Promise<void> {
  await assertContext(context);
  await checkLegacy(context);
  const rawRegistry = await AsyncStorage.getItem(context.registryKey);
  const registry =
    rawRegistry === null
      ? { version: 1 as const, owners: [] }
      : validateRegistry(parse(rawRegistry));
  let entry = registry.owners.find((v) => v.id === context.owner.id);
  if (!entry) {
    // Never infer ownership of a pre-existing index/body from timestamps.
    if (
      (await SecureStore.getItemAsync(`${context.base}.owner`, options)) !==
        null ||
      (await SecureStore.getItemAsync(`${context.base}.index`, options)) !==
        null ||
      (await SecureStore.getItemAsync(`${context.base}.head`, options)) !== null
    )
      recovery("ORPHAN_OWNER_DATA");
    entry = { id: context.owner.id, state: "preparing" };
    registry.owners.push(entry);
    await AsyncStorage.setItem(context.registryKey, JSON.stringify(registry));
  }
  let ownerValue: string | null;
  try {
    ownerValue = await readValue(`${context.base}.owner`);
  } catch (error) {
    if (
      entry.state !== "preparing" ||
      !(error instanceof UncommittedChunkedValueError)
    )
      throw error;
    if (
      (await SecureStore.getItemAsync(`${context.base}.index`, options)) !==
      null
    )
      recovery("MISSING_OWNER_MANIFEST");
    await clearChunkedValue(`${context.base}.owner`);
    ownerValue = null;
  }
  if (
    ownerValue !== null &&
    JSON.stringify(parse(ownerValue)) !== JSON.stringify(context.owner)
  )
    recovery("OWNER_MANIFEST_MISMATCH");
  if (entry.state === "ready") {
    if (ownerValue === null) recovery("MISSING_OWNER_MANIFEST");
    return;
  }
  if (
    ownerValue === null &&
    (await SecureStore.getItemAsync(`${context.base}.index`, options)) !== null
  )
    recovery("MISSING_OWNER_MANIFEST");
  if (ownerValue === null)
    await writeChunkedValue(
      `${context.base}.owner`,
      JSON.stringify(context.owner),
    );
  let indexValue: string | null;
  try {
    indexValue = await readValue(`${context.base}.index`);
  } catch (error) {
    if (!(error instanceof UncommittedChunkedValueError)) throw error;
    await clearChunkedValue(`${context.base}.index`);
    indexValue = null;
  }
  if (indexValue === null)
    await writeChunkedValue(
      `${context.base}.index`,
      JSON.stringify(emptyIndex(context.owner.id)),
    );
  else if (
    JSON.stringify(validateIndex(parse(indexValue), context.owner.id)) !==
    JSON.stringify(emptyIndex(context.owner.id))
  )
    recovery("UNOWNED_INDEX");
  entry.state = "ready";
  await AsyncStorage.setItem(context.registryKey, JSON.stringify(registry));
}
function validateHead(raw: string, ownerId: string): Head {
  const v = parse(raw);
  if (
    !object(v) ||
    !keys(v, [
      "version",
      "id",
      "ownerId",
      "state",
      "sequence",
      "digest",
      "indexDigest",
    ]) ||
    v.version !== 1 ||
    v.ownerId !== ownerId ||
    typeof v.id !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      v.id,
    ) ||
    !["preparing", "ready", "applied"].includes(v.state) ||
    !isCount(v.sequence) ||
    v.sequence < 1 ||
    !isHash(v.digest) ||
    !isHash(v.indexDigest)
  )
    recovery("INVALID_JOURNAL_HEAD");
  return v as Head;
}
function validateTransaction(raw: string, head: Head): Transaction {
  const tx = parse(raw);
  if (
    !object(tx) ||
    !keys(tx, ["version", "id", "ownerId", "mutations", "index"]) ||
    tx.version !== 1 ||
    tx.id !== head.id ||
    tx.ownerId !== head.ownerId ||
    !Array.isArray(tx.mutations)
  )
    recovery("INVALID_JOURNAL");
  validateIndex(tx.index, head.ownerId);
  if (tx.index.sequence !== head.sequence) recovery("INVALID_JOURNAL_SEQUENCE");
  const seen = new Set<string>();
  for (const m of tx.mutations) {
    if (
      !object(m) ||
      !keys(m, ["kind", "pingId", "value"], ["questionId"]) ||
      !["ping", "answer"].includes(m.kind) ||
      !isId(m.pingId) ||
      !(m.value === null || typeof m.value === "string") ||
      (m.kind === "answer" ? !isId(m.questionId) : own(m, "questionId"))
    )
      recovery("INVALID_JOURNAL_MUTATION");
    const name = JSON.stringify([m.kind, m.pingId, m.questionId]);
    if (seen.has(name)) recovery("DUPLICATE_JOURNAL_MUTATION");
    seen.add(name);
    if (m.value !== null) {
      const v = m.kind === "ping" ? parsePing(m.value) : parseAnswer(m.value);
      if (
        m.kind === "ping"
          ? (v as Ping).id !== m.pingId
          : (v as Answer).pingId !== m.pingId ||
            (v as Answer).questionId !== m.questionId
      )
        recovery("JOURNAL_RECORD_MISMATCH");
    }
    const indexed =
      m.kind === "ping"
        ? tx.index.pings.includes(m.pingId)
        : own(tx.index.answers, m.pingId) &&
          tx.index.answers[m.pingId].includes(m.questionId);
    if (Boolean(indexed) !== (m.value !== null))
      recovery("JOURNAL_INDEX_MISMATCH");
  }
  return tx as Transaction;
}
async function recordKey(
  context: Context,
  kind: "ping" | "answer",
  pingId: string,
  questionId?: string,
) {
  return `${context.base}.${kind === "ping" ? "p" : "a"}.${await digest(
    JSON.stringify([pingId, questionId ?? null]),
  )}`;
}
async function recordValue(
  context: Context,
  kind: "ping" | "answer",
  pingId: string,
  questionId?: string,
) {
  let raw: string | null;
  try {
    raw = await readValue(await recordKey(context, kind, pingId, questionId));
  } catch (error) {
    if (error instanceof UncommittedChunkedValueError)
      recovery("UNCOMMITTED_PRIMARY_RECORD");
    throw error;
  }
  if (raw === null) return null;
  const value = parse(raw);
  if (
    !object(value) ||
    !keys(value, ["version", "ownerId", "kind", "value"]) ||
    value.version !== 1 ||
    value.ownerId !== context.owner.id ||
    value.kind !== kind ||
    typeof value.value !== "string"
  )
    recovery("INVALID_RECORD_OWNER");
  const parsed =
    kind === "ping" ? parsePing(value.value) : parseAnswer(value.value);
  if (
    kind === "ping"
      ? (parsed as Ping).id !== pingId
      : (parsed as Answer).pingId !== pingId ||
        (parsed as Answer).questionId !== questionId
  )
    recovery("INVALID_RECORD_ID");
  return value.value as string;
}
async function applyTransaction(context: Context, transaction: Transaction) {
  for (const mutation of transaction.mutations) {
    const key = await recordKey(
      context,
      mutation.kind,
      mutation.pingId,
      mutation.questionId,
    );
    if (mutation.value === null) await clearChunkedValue(key);
    else {
      const value = JSON.stringify({
        version: 1,
        ownerId: context.owner.id,
        kind: mutation.kind,
        value: mutation.value,
      });
      // A redo may replace a partial pending version, but never a malformed committed one.
      await writeChunkedValue(key, value);
      if ((await readValue(key)) !== value)
        recovery("RECORD_VERIFICATION_FAILED");
    }
  }
  await writeChunkedValue(
    `${context.base}.index`,
    JSON.stringify(transaction.index),
  );
}
async function recover(context: Context) {
  const rawHead = await SecureStore.getItemAsync(
    `${context.base}.head`,
    options,
  );
  if (rawHead === null) return;
  const head = validateHead(rawHead, context.owner.id);
  const walKey = `${context.base}.wal.${head.id}`;
  if (head.state === "preparing") {
    // Primary mutations are forbidden before ready. The prior index is intact.
    const index = await readIndex(context);
    if (index.sequence !== head.sequence - 1)
      recovery("PREPARING_JOURNAL_CONFLICT");
    // Validate a complete payload before discarding; malformed WAL is evidence, not trash.
    try {
      const raw = await readValue(walKey);
      if (raw !== null) {
        if ((await digest(raw)) !== head.digest)
          recovery("JOURNAL_DIGEST_MISMATCH");
        validateTransaction(raw, head);
      }
    } catch (error) {
      if (!(error instanceof UncommittedChunkedValueError)) throw error;
    }
    await clearChunkedValue(walKey);
    await SecureStore.deleteItemAsync(`${context.base}.head`, options);
    return;
  }
  if (head.state === "ready") {
    let raw: string | null;
    try {
      raw = await readValue(walKey);
    } catch {
      return recovery("DAMAGED_READY_JOURNAL");
    }
    if (raw === null || (await digest(raw)) !== head.digest)
      recovery("MISSING_READY_JOURNAL");
    const transaction = validateTransaction(raw, head);
    // An interrupted index write can have only a pending generation. Replay repairs it.
    let index: Index | null = null;
    try {
      index = await readIndex(context);
    } catch (error) {
      if (!(error instanceof UncommittedChunkedValueError)) throw error;
    }
    if (
      index &&
      index.sequence !== head.sequence - 1 &&
      index.sequence !== head.sequence
    )
      recovery("JOURNAL_SEQUENCE_CONFLICT");
    if ((await digest(JSON.stringify(transaction.index))) !== head.indexDigest)
      recovery("JOURNAL_INDEX_DIGEST_MISMATCH");
    await applyTransaction(context, transaction);
    head.state = "applied";
    await SecureStore.setItemAsync(
      `${context.base}.head`,
      JSON.stringify(head),
      options,
    );
  }
  const index = await readIndex(context);
  if (
    index.sequence !== head.sequence ||
    (await digest(JSON.stringify(index))) !== head.indexDigest
  )
    recovery("APPLIED_JOURNAL_CONFLICT");
  // A fully retained malformed WAL is evidence. A pending-only WAL is the
  // cleanup tombstone, so interruption during cleanup can safely resume.
  try {
    const raw = await readValue(walKey);
    if (raw !== null) {
      if ((await digest(raw)) !== head.digest)
        recovery("JOURNAL_DIGEST_MISMATCH");
      validateTransaction(raw, head);
    }
  } catch (error) {
    if (!(error instanceof UncommittedChunkedValueError)) throw error;
  }
  await clearChunkedValue(walKey);
  await SecureStore.deleteItemAsync(`${context.base}.head`, options);
}
async function prepare(context: Context) {
  await ensureOwner(context);
  await recover(context);
  return readIndex(context);
}
async function commit(context: Context, index: Index, mutations: Mutation[]) {
  await assertContext(context);
  const next = copy(index);
  next.sequence++;
  if (!isCount(next.sequence)) recovery("REVISION_OVERFLOW");
  const transaction: Transaction = {
    version: 1,
    id: String(uuid.v4()),
    ownerId: context.owner.id,
    mutations,
    index: next,
  };
  const raw = JSON.stringify(transaction);
  const head: Head = {
    version: 1,
    id: transaction.id,
    ownerId: context.owner.id,
    state: "preparing",
    sequence: next.sequence,
    digest: await digest(raw),
    indexDigest: await digest(JSON.stringify(next)),
  };
  validateTransaction(raw, head);
  await SecureStore.setItemAsync(
    `${context.base}.head`,
    JSON.stringify(head),
    options,
  );
  await writeChunkedValue(`${context.base}.wal.${head.id}`, raw);
  if ((await readValue(`${context.base}.wal.${head.id}`)) !== raw)
    recovery("JOURNAL_VERIFICATION_FAILED");
  head.state = "ready";
  await SecureStore.setItemAsync(
    `${context.base}.head`,
    JSON.stringify(head),
    options,
  );
  await recover(context);
}
function run<T>(
  operation: (context: Context, index: Index) => Promise<T>,
  expectedOwnerId?: string,
): Promise<T> {
  // Begin capturing the caller's session before waiting behind another write.
  const captured = withDataJournalLockAsync(captureContext);
  return withDataJournalLockAsync(async () => {
    const context = await captured;
    if (expectedOwnerId !== undefined && context.owner.id !== expectedOwnerId)
      recovery("OWNER_CHANGED");
    const index = await prepare(context);
    return operation(context, index);
  });
}
function bump(index: Index, pingId: string) {
  const revision =
    (own(index.revisions, pingId) ? index.revisions[pingId] : 0) + 1;
  if (!isCount(revision)) recovery("REVISION_OVERFLOW");
  Object.defineProperty(index.revisions, pingId, {
    value: revision,
    writable: true,
    configurable: true,
    enumerable: true,
  });
  Object.defineProperty(index.dirty, pingId, {
    value: revision,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}
async function getPing(context: Context, index: Index, pingId: string) {
  await checkLegacy(context, pingId);
  const raw = await recordValue(context, "ping", pingId);
  if (index.pings.includes(pingId) && raw === null)
    recovery("MISSING_INDEXED_PING");
  if (!index.pings.includes(pingId) && raw !== null) recovery("ORPHAN_PING");
  return raw === null ? null : parsePing(raw);
}
async function getAnswer(
  context: Context,
  index: Index,
  pingId: string,
  questionId: string,
) {
  await checkLegacy(context, pingId, questionId);
  const raw = await recordValue(context, "answer", pingId, questionId);
  const indexed =
    own(index.answers, pingId) && index.answers[pingId].includes(questionId);
  if (indexed && raw === null) recovery("MISSING_INDEXED_ANSWER");
  if (!indexed && raw !== null) recovery("ORPHAN_ANSWER");
  return raw === null ? null : parseAnswer(raw);
}
async function savePing(context: Context, index: Index, ping: Ping) {
  const previous = await getPing(context, index, ping.id);
  if (previous) {
    if (
      JSON.stringify({ ...previous, endTime: null }) !==
      JSON.stringify({ ...ping, endTime: null })
    )
      recovery("PING_ID_REUSE");
    if (previous.endTime !== null) return previous;
    if (JSON.stringify(previous) === JSON.stringify(ping)) return previous;
  } else {
    index.pings.push(ping.id);
    if (!own(index.expiry, ping.id))
      Object.defineProperty(index.expiry, ping.id, {
        value: null,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    Object.defineProperty(index.answers, ping.id, {
      value: [],
      enumerable: true,
      writable: true,
      configurable: true,
    });
    const suffix = ping.id.startsWith(ping.streamName)
      ? Number(ping.id.slice(ping.streamName.length))
      : 0;
    const allocated = own(index.nextByStream, ping.streamName)
      ? index.nextByStream[ping.streamName]
      : 0;
    if (isCount(suffix) && suffix > allocated)
      Object.defineProperty(index.nextByStream, ping.streamName, {
        value: suffix,
        enumerable: true,
        writable: true,
        configurable: true,
      });
  }
  bump(index, ping.id);
  await commit(context, index, [
    { kind: "ping", pingId: ping.id, value: JSON.stringify(ping) },
  ]);
  return ping;
}
export function getDataOwnerAsync(): Promise<DataOwner> {
  return run(async (context) => copy(context.owner));
}
export function recoverDataJournalAsync(): Promise<void> {
  return run(async () => undefined);
}
export function storeJournalPingAsync(ping: Ping): Promise<Ping> {
  const value = JSON.stringify(PingSchema.parse(ping));
  return run((context, index) => savePing(context, index, parsePing(value)));
}
export function insertJournalPingAsync(input: {
  notificationTime: Date;
  startTime: Date;
  streamName: StreamName;
  operationId?: string;
  expiresAt?: Date;
}): Promise<Ping> {
  const { streamName, operationId } = input;
  const expiresAt = input.expiresAt?.getTime() ?? null;
  const notificationTime = input.notificationTime.getTime(),
    startTime = input.startTime.getTime(),
    tzOffset = input.startTime.getTimezoneOffset();
  return run(async (context, index) => {
    if (operationId !== undefined) {
      if (!isId(operationId)) recovery("INVALID_INSERTION_TOKEN");
      if (own(index.insertions, operationId)) {
        const existing = await getPing(
          context,
          index,
          index.insertions[operationId],
        );
        if (!existing || existing.streamName !== streamName)
          recovery("INSERTION_TOKEN_REUSE");
        return existing;
      }
    }
    let next =
      (own(index.nextByStream, streamName)
        ? index.nextByStream[streamName]
        : 0) + 1;
    while (index.pings.includes(`${streamName}${next}`)) next++;
    if (!isCount(next)) recovery("ALLOCATION_OVERFLOW");
    if (
      expiresAt !== null &&
      (!Number.isFinite(expiresAt) || expiresAt < notificationTime)
    )
      recovery("INVALID_PING_EXPIRY");
    Object.defineProperty(index.expiry, `${streamName}${next}`, {
      value: expiresAt,
      enumerable: true,
      writable: true,
      configurable: true,
    });
    if (operationId !== undefined)
      Object.defineProperty(index.insertions, operationId, {
        value: `${streamName}${next}`,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    return savePing(
      context,
      index,
      PingSchema.parse({
        id: `${streamName}${next}`,
        streamName,
        notificationTime: new Date(notificationTime),
        startTime: new Date(startTime),
        tzOffset,
        endTime: null,
      }),
    );
  });
}
export function completeJournalPingAsync(
  pingId: string,
  date: Date,
  expectedOwnerId?: string,
): Promise<Ping> {
  const endTime = date.getTime();
  return run(async (context, index) => {
    const ping = await getPing(context, index, pingId);
    if (!ping) throw new Error(`pingId ${pingId} not found in getPingsAsync.`);
    if (ping.endTime !== null) return ping;
    return savePing(
      context,
      index,
      PingSchema.parse({ ...ping, endTime: new Date(endTime) }),
    );
  }, expectedOwnerId);
}
/** Unknown legacy/protocol expiry stays active rather than guessing from timestamps. */
export function isJournalPingActiveAsync(
  pingId: string,
  now = new Date(),
): Promise<boolean> {
  const at = now.getTime();
  if (!Number.isFinite(at))
    return Promise.reject(new DataRecoveryError("INVALID_EXPIRY_CHECK"));
  return run(async (context, index) => {
    const ping = await getPing(context, index, pingId);
    if (!ping) recovery("MISSING_INDEXED_PING");
    return (
      ping.endTime === null &&
      (index.expiry[pingId] === null || (index.expiry[pingId] as number) >= at)
    );
  });
}
export function getJournalPingAsync(pingId: string): Promise<Ping | null> {
  return run((context, index) => getPing(context, index, pingId));
}
export function getJournalAnswerAsync(
  pingId: string,
  questionId: string,
): Promise<Answer | null> {
  return run((context, index) => getAnswer(context, index, pingId, questionId));
}
export function storeJournalAnswerAsync(
  answer: Answer,
  expectedOwnerId?: string,
): Promise<void> {
  const value = JSON.stringify(AnswerSchema.parse(answer));
  const captured = parseAnswer(value);
  return run(async (context, index) => {
    if (!(await getPing(context, index, captured.pingId)))
      recovery("ANSWER_WITHOUT_PING");
    const previous = await getAnswer(
      context,
      index,
      captured.pingId,
      captured.questionId,
    );
    if (previous && JSON.stringify(previous) === value) return;
    if (!index.answers[captured.pingId].includes(captured.questionId))
      index.answers[captured.pingId].push(captured.questionId);
    bump(index, captured.pingId);
    await commit(context, index, [
      {
        kind: "answer",
        pingId: captured.pingId,
        questionId: captured.questionId,
        value,
      },
    ]);
  }, expectedOwnerId);
}
export function captureDataSnapshotAsync({
  unuploadedOnly = false,
}: { unuploadedOnly?: boolean } = {}): Promise<DataSnapshot> {
  return run(async (context, index) => {
    const pings: Ping[] = [],
      answers: Answer[] = [],
      revisions: Record<string, number> = {};
    for (const id of index.pings) {
      if (unuploadedOnly && !own(index.dirty, id)) continue;
      const ping = await getPing(context, index, id);
      if (!ping) recovery("MISSING_INDEXED_PING");
      pings.push(ping);
      Object.defineProperty(revisions, id, {
        value: index.revisions[id],
        enumerable: true,
      });
      for (const questionId of index.answers[id]) {
        const answer = await getAnswer(context, index, id, questionId);
        if (!answer) recovery("MISSING_INDEXED_ANSWER");
        answers.push(answer);
      }
    }
    return {
      owner: copy(context.owner),
      user: copy(context.user),
      studyInfo: copy(context.studyInfo),
      pings,
      answers,
      revisions,
    };
  });
}
export function acknowledgeDataSnapshotAsync(
  snapshot: Pick<DataSnapshot, "owner" | "revisions" | "studyInfo">,
  expectedStudyInfo?: StudyInfo,
): Promise<void> {
  const owner = copy(snapshot.owner),
    revisions = copy(snapshot.revisions),
    destination = copy(snapshot.studyInfo),
    expectedDestination =
      expectedStudyInfo === undefined ? undefined : copy(expectedStudyInfo);
  return run(async (context, index) => {
    if (context.owner.id !== owner.id) recovery("OWNER_CHANGED");
    if (
      expectedDestination &&
      (expectedDestination.id !== destination?.id ||
        JSON.stringify(expectedDestination.server) !==
          JSON.stringify(destination?.server))
    )
      recovery("DESTINATION_CHANGED");
    if (
      !destination ||
      context.studyInfo.id !== destination.id ||
      JSON.stringify(context.studyInfo.server) !==
        JSON.stringify(destination.server)
    )
      recovery("DESTINATION_CHANGED");
    let changed = false;
    for (const [id, revision] of Object.entries(revisions)) {
      if (!isCount(revision) || revision < 1)
        recovery("INVALID_ACKNOWLEDGEMENT");
      if (own(index.dirty, id) && index.dirty[id] === revision) {
        await getPing(context, index, id);
        for (const questionId of index.answers[id])
          await getAnswer(context, index, id, questionId);
        delete index.dirty[id];
        changed = true;
      }
    }
    if (changed) await commit(context, index, []);
  });
}
export function getJournalPingIdsAsync(
  unuploadedOnly = false,
): Promise<string[]> {
  return run(async (_context, index) =>
    index.pings.filter((id) => !unuploadedOnly || own(index.dirty, id)),
  );
}
export function getAnswersQuestionIdsForPingAsync(
  pingId: string,
): Promise<string[]> {
  return run(async (context, index) => {
    await getPing(context, index, pingId);
    return own(index.answers, pingId) ? [...index.answers[pingId]] : [];
  });
}
/** Resume reconciliation must read one owner and one committed answer revision atomically. */
export function getResumeAnswersAsync(
  pingId: string,
  expectedOwnerId: string,
): Promise<Answer[]> {
  return run(async (context, index) => {
    if (context.owner.id !== expectedOwnerId) recovery("OWNER_CHANGED");
    if (!(await getPing(context, index, pingId)))
      recovery("MISSING_INDEXED_PING");
    const answers: Answer[] = [];
    for (const questionId of index.answers[pingId]) {
      const answer = await getAnswer(context, index, pingId, questionId);
      if (!answer) recovery("MISSING_INDEXED_ANSWER");
      answers.push(answer);
    }
    return answers;
  }, expectedOwnerId);
}
export function getJournalAnswerIdsAsync(
  unuploadedOnly = false,
): Promise<[string, string][]> {
  return run(async (_context, index) =>
    index.pings
      .filter((id) => !unuploadedOnly || own(index.dirty, id))
      .flatMap((id) => index.answers[id].map((q): [string, string] => [id, q])),
  );
}
export function markJournalPingDirtyAsync(pingId: string): Promise<void> {
  return run(async (context, index) => {
    if (!(await getPing(context, index, pingId)))
      recovery("MISSING_INDEXED_PING");
    if (own(index.dirty, pingId)) return;
    Object.defineProperty(index.dirty, pingId, {
      value: index.revisions[pingId],
      enumerable: true,
      writable: true,
      configurable: true,
    });
    await commit(context, index, []);
  });
}
export function clearJournalDirtyAsync(): Promise<void> {
  return run(async (_context, index) => {
    if (Object.keys(index.dirty).length) recovery("UNSAFE_ACKNOWLEDGEMENT");
  });
}
export function removeJournalRecordsAsync({
  pingId,
  questionId,
  allAnswers = false,
  allPings = false,
  answersForPing = false,
}: {
  pingId?: string;
  questionId?: string;
  allAnswers?: boolean;
  allPings?: boolean;
  answersForPing?: boolean;
}): Promise<void> {
  return run(async (context, index) => {
    const mutations: Mutation[] = [];
    for (const id of [...index.pings]) {
      if (!allPings && !allAnswers && id !== pingId) continue;
      await getPing(context, index, id);
      let changed = false;
      for (const q of [...index.answers[id]]) {
        if (
          !allPings &&
          !allAnswers &&
          questionId !== undefined &&
          q !== questionId
        )
          continue;
        await getAnswer(context, index, id, q);
        mutations.push({
          kind: "answer",
          pingId: id,
          questionId: q,
          value: null,
        });
        index.answers[id] = index.answers[id].filter((v) => v !== q);
        changed = true;
      }
      if (
        allPings ||
        (!allAnswers &&
          !answersForPing &&
          id === pingId &&
          questionId === undefined)
      ) {
        mutations.push({ kind: "ping", pingId: id, value: null });
        index.pings = index.pings.filter((v) => v !== id);
        delete index.answers[id];
        delete index.revisions[id];
        delete index.dirty[id];
        delete index.expiry[id];
        for (const token of Object.keys(index.insertions))
          if (index.insertions[token] === id) delete index.insertions[token];
      } else if (changed) bump(index, id);
    }
    if (mutations.length) await commit(context, index, mutations);
  });
}
