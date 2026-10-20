import { Ping } from "@wellping/study-schemas/lib/types";
import {
  clearJournalDirtyAsync,
  DataRecoveryError,
  getJournalPingIdsAsync,
  markJournalPingDirtyAsync,
} from "../dataJournal";
import { PingsList } from "./pingsList";

export function addToUnuploadedPingsListIfNeededAsync(
  ping: Ping,
): Promise<void> {
  return markJournalPingDirtyAsync(ping.id);
}
export function clearUnuploadedPingsListAsync(): Promise<void> {
  return clearJournalDirtyAsync();
}
/** @deprecated IDs cannot acknowledge a revision. Use acknowledgeDataSnapshotAsync. */
export async function removeFromUnuploadedPingsListAsync(
  toBeRemoved: PingsList,
): Promise<void> {
  if (toBeRemoved.length) throw new DataRecoveryError("UNSAFE_ACKNOWLEDGEMENT");
}
export function getUnuploadedPingsListAsync(): Promise<PingsList> {
  return getJournalPingIdsAsync(true);
}
