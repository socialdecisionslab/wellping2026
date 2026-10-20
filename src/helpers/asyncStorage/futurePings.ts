import AsyncStorage from "@react-native-async-storage/async-storage";
import { StreamName } from "@wellping/study-schemas/lib/types";
import { getStreamsAsync } from "../studyFile";
import { getASKeyAsync } from "./asyncStorage";
import {
  captureCurrentDataOwnerAsync,
  DataRecoveryError,
  assertDataOwnerInsideLockAsync,
  withDataJournalLockAsync,
} from "../dataJournal";

export type FuturePing = { afterDate: Date; streamName: StreamName };
type State = { version: 2; queue: FuturePing[]; completed: string[] };
async function context(expectedOwnerId?: string) {
  const owner = await captureCurrentDataOwnerAsync();
  if (expectedOwnerId !== undefined && owner.id !== expectedOwnerId)
    throw new DataRecoveryError("OWNER_CHANGED");
  const legacy = await AsyncStorage.getItem(
    await getASKeyAsync("FuturePingQueue:"),
  );
  if (legacy !== null) {
    const value = JSON.parse(legacy);
    if (!Array.isArray(value) || value.length > 0)
      throw new Error(
        "An earlier follow-up schedule needs ownership recovery; data preserved.",
      );
  }
  return { owner, key: await getASKeyAsync(`FuturePingQueue.v2.${owner.id}`) };
}
async function read(key: string): Promise<State> {
  const raw = await AsyncStorage.getItem(key);
  if (raw === null) return { version: 2, queue: [], completed: [] };
  const data = JSON.parse(raw);
  if (
    !data ||
    data.version !== 2 ||
    !Array.isArray(data.queue) ||
    !Array.isArray(data.completed) ||
    !data.completed.every((id: unknown) => typeof id === "string")
  )
    throw new Error("Follow-up schedule needs recovery; data preserved.");
  const queue = data.queue.map((ping: any) => {
    const afterDate = new Date(ping.afterDate);
    if (
      typeof ping.afterDate !== "string" ||
      afterDate.toISOString?.() !== ping.afterDate ||
      typeof ping.streamName !== "string" ||
      !Number.isFinite(afterDate.getTime())
    )
      throw new Error("Invalid follow-up schedule; data preserved.");
    return { streamName: ping.streamName, afterDate };
  });
  const streams = await getStreamsAsync();
  if (
    queue.some(
      (ping: FuturePing) =>
        !Object.prototype.hasOwnProperty.call(streams, ping.streamName),
    )
  )
    throw new Error("Unknown follow-up stream; schedule preserved.");
  return { version: 2, queue, completed: data.completed };
}
export async function getFuturePingsQueue(): Promise<FuturePing[]> {
  const { owner, key } = await context();
  return withDataJournalLockAsync(async () => {
    await assertDataOwnerInsideLockAsync(owner);
    return (await read(key)).queue;
  });
}
export async function initFuturePingQueueAsync() {
  // Initialization is idempotent and never clears an existing queue.
  await getFuturePingsQueue();
}
export async function enqueueFollowupPingsOnceAsync(
  operationId: string,
  followups: FuturePing[],
  expectedOwnerId?: string,
) {
  if (
    followups.some(
      (ping) =>
        !(ping.afterDate instanceof Date) || !Number.isFinite(+ping.afterDate),
    )
  )
    throw new Error("Invalid follow-up date.");
  const frozen = followups.map((ping) => ({
    streamName: ping.streamName,
    afterDate: new Date(ping.afterDate),
  }));
  const { owner, key } = await context();
  await withDataJournalLockAsync(async () => {
    await assertDataOwnerInsideLockAsync(owner);
    if (expectedOwnerId !== undefined && owner.id !== expectedOwnerId)
      throw new Error("Follow-up session changed; data preserved.");
    const streams = await getStreamsAsync();
    if (
      frozen.some(
        (ping) =>
          !Object.prototype.hasOwnProperty.call(streams, ping.streamName),
      )
    )
      throw new Error("Unknown follow-up stream.");
    const state = await read(key);
    if (state.completed.includes(operationId)) return;
    if (state.queue.length === 0) state.queue.push(...frozen);
    state.completed.push(operationId);
    await AsyncStorage.setItem(key, JSON.stringify(state));
  });
}
export async function enqueueToFuturePingQueue(futurePing: FuturePing) {
  if (
    !(futurePing.afterDate instanceof Date) ||
    !Number.isFinite(+futurePing.afterDate)
  )
    throw new Error("Invalid follow-up date.");
  const frozen = { ...futurePing, afterDate: new Date(futurePing.afterDate) };
  const { owner, key } = await context();
  await withDataJournalLockAsync(async () => {
    await assertDataOwnerInsideLockAsync(owner);
    const streams = await getStreamsAsync();
    if (!Object.prototype.hasOwnProperty.call(streams, frozen.streamName))
      throw new Error("Unknown follow-up stream.");
    const state = await read(key);
    if (
      !state.queue.some(
        (ping) =>
          ping.streamName === frozen.streamName &&
          +ping.afterDate === +frozen.afterDate,
      )
    )
      state.queue.push(frozen);
    await AsyncStorage.setItem(key, JSON.stringify(state));
  });
}
export async function dequeueFuturePingIfAny(): Promise<FuturePing | null> {
  const { owner, key } = await context();
  return withDataJournalLockAsync(async () => {
    await assertDataOwnerInsideLockAsync(owner);
    const state = await read(key);
    const index = state.queue.findIndex((ping) => new Date() > ping.afterDate);
    if (index < 0) return null;
    const [ping] = state.queue.splice(index, 1);
    await AsyncStorage.setItem(key, JSON.stringify(state));
    return ping;
  });
}

/** Non-destructive reservation: acknowledgement follows durable ping creation. */
export async function peekFuturePingIfAny(
  expectedOwnerId?: string,
): Promise<(FuturePing & { operationId: string }) | null> {
  const { owner, key } = await context(expectedOwnerId);
  return withDataJournalLockAsync(async () => {
    await assertDataOwnerInsideLockAsync(owner);
    const ping = (await read(key)).queue.find(
      (item) => new Date() > item.afterDate,
    );
    return ping
      ? {
          ...ping,
          operationId: JSON.stringify([
            "followup",
            ping.streamName,
            ping.afterDate.toISOString(),
          ]),
        }
      : null;
  });
}
export async function acknowledgeFuturePingAsync(
  operationId: string,
  expectedOwnerId?: string,
) {
  const { owner, key } = await context(expectedOwnerId);
  await withDataJournalLockAsync(async () => {
    await assertDataOwnerInsideLockAsync(owner);
    const state = await read(key);
    state.queue = state.queue.filter(
      (ping) =>
        JSON.stringify([
          "followup",
          ping.streamName,
          ping.afterDate.toISOString(),
        ]) !== operationId,
    );
    await AsyncStorage.setItem(key, JSON.stringify(state));
  });
}
