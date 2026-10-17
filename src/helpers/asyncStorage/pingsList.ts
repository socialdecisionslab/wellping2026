// Compatibility API. Indices now live in the owner-bound secure journal.
import { Ping, PingId } from "@wellping/study-schemas/lib/types";
import {
  getJournalPingIdsAsync,
  removeJournalRecordsAsync,
  storeJournalPingAsync,
} from "../dataJournal";

export type PingsList = PingId[];
export async function addToPingsListIfNeededAsync(ping: Ping): Promise<void> {
  await storeJournalPingAsync(ping);
}
/** Clear bodies and indices together; an index-only delete would orphan data. */
export function clearPingsListAsync(): Promise<void> {
  return removeJournalRecordsAsync({ allPings: true });
}
export function getPingsListAsync(): Promise<PingsList> {
  return getJournalPingIdsAsync();
}
