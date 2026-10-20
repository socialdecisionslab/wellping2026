import { Ping, PingId } from "@wellping/study-schemas/lib/types";
import {
  getJournalPingAsync,
  removeJournalRecordsAsync,
  storeJournalPingAsync,
} from "../dataJournal";

export async function secureStorePingAsync(ping: Ping): Promise<void> {
  await storeJournalPingAsync(ping);
}
export function secureGetPingAsync(
  pingId: PingId,
  expectedOwnerId?: string,
): Promise<Ping | null> {
  return getJournalPingAsync(pingId, expectedOwnerId);
}
export function secureRemovePingAsync(pingId: PingId): Promise<void> {
  return removeJournalRecordsAsync({ pingId });
}
