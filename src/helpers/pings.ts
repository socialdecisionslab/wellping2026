import { StreamName, Ping } from "@wellping/study-schemas/lib/types";
import { isToday } from "date-fns";

import {
  captureDataSnapshotAsync,
  completeJournalPingAsync,
  insertJournalPingAsync,
  removeJournalRecordsAsync,
} from "./dataJournal";
import { isTimeThisWeekAsync, getAllStreamNamesAsync } from "./studyFile";

export async function getNumberOfPingsForStreamNameAsync(
  streamName: StreamName,
): Promise<number> {
  const { pings } = await captureDataSnapshotAsync();
  return pings.filter((ping) => ping.streamName === streamName).length;
}

export type NumbersOfPingsForAllStreamNames = {
  [stream: string /* actually StreamName */]: number;
};
export async function getNumbersOfPingsForAllStreamNamesAsync(): Promise<NumbersOfPingsForAllStreamNames> {
  const streamNames = await getAllStreamNamesAsync();
  const { pings } = await captureDataSnapshotAsync();
  const results: NumbersOfPingsForAllStreamNames = {};
  for (const streamName of streamNames) {
    const count = pings.filter((ping) => ping.streamName === streamName).length;
    if (count > 0)
      Object.defineProperty(results, streamName, {
        value: count,
        enumerable: true,
      });
  }

  return results;
}

export async function insertPingAsync({
  notificationTime,
  startTime,
  streamName,
  operationId,
  expiresAt,
}: {
  notificationTime: Date;
  startTime: Date;
  streamName: StreamName;
  operationId?: string;
  expiresAt?: Date;
}): Promise<Ping> {
  return insertJournalPingAsync({
    notificationTime,
    startTime,
    streamName,
    operationId,
    expiresAt,
  });
}

export async function addEndTimeToPingAsync(
  pingId: string,
  endTime: Date,
  expectedOwnerId?: string,
): Promise<Ping> {
  return completeJournalPingAsync(pingId, endTime, expectedOwnerId);
}

export async function getLatestPingAsync(): Promise<Ping | null> {
  const { pings } = await captureDataSnapshotAsync();
  return pings.length ? pings[pings.length - 1] : null;
}

export async function getPingsAsync({
  order = "ASC",
  unuploadedOnly = false,
}: {
  order?: "ASC" | "DESC";
  unuploadedOnly?: boolean;
} = {}): Promise<Ping[]> {
  const { pings } = await captureDataSnapshotAsync({ unuploadedOnly });
  return order === "DESC" ? pings.reverse() : pings;
}

// Returns all pings in the order of `order` until the `untilAsync`
// condition is met.
// The returning pings are always in `order` order.
export async function getPingsUntilAsync(
  untilAsync: (ping: Ping) => Promise<boolean> | boolean,
  order: "ASC" | "DESC",
): Promise<Ping[]> {
  const allPings = await getPingsAsync({ order });
  const resultsPings: Ping[] = [];
  for (const ping of allPings) {
    if (ping.notificationTime > new Date()) {
      // It is almost impossible to get this, because finished pings
      // cannot be in the future.
      continue;
    }
    if (await untilAsync(ping)) {
      // Stops when the condition is met.
      break;
    }
    resultsPings.push(ping);
  }
  return resultsPings;
}

export async function getTodayPingsAsync(): Promise<Ping[]> {
  // Stops when the finished ping was in yesterday.
  const todayPings = await getPingsUntilAsync(
    (ping) => !isToday(ping.notificationTime),
    "DESC",
  );
  todayPings.reverse(); // So that pings are in ascending order.
  return todayPings;
}

export async function getThisWeekPingsAsync(): Promise<Ping[]> {
  // Stops when the finished ping was last week.
  const thisWeekPings = await getPingsUntilAsync(
    async (ping) => !(await isTimeThisWeekAsync(ping.notificationTime)),
    "DESC",
  );
  thisWeekPings.reverse(); // So that pings are in ascending order.
  return thisWeekPings;
}

export function clearAllPingsAsync(): Promise<void> {
  return removeJournalRecordsAsync({ allPings: true });
}
