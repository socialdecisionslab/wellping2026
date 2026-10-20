import AsyncStorage from "@react-native-async-storage/async-storage";
import { getASKeyAsync } from "./asyncStorage/asyncStorage";
import {
  addToUnuploadedPingsListIfNeededAsync,
  removeFromUnuploadedPingsListAsync,
} from "./asyncStorage/unuploadedPingsList";
import { getStudyInfoAsync } from "./studyFile";
import type { Ping } from "@wellping/study-schemas/lib/types";

export type PingRevision = { revision: number; studyVersion: string };
export type UploadRevisions = Record<string, PingRevision>;
const KEY = "uploadRevisions.v1";

export async function getUploadRevisionsAsync(): Promise<UploadRevisions> {
  const raw = await AsyncStorage.getItem(await getASKeyAsync(KEY));
  const revisions = raw === null ? {} : JSON.parse(raw);
  if (
    !revisions ||
    typeof revisions !== "object" ||
    Array.isArray(revisions) ||
    Object.values(revisions).some(
      (v: any) =>
        !v ||
        !Number.isSafeInteger(v.revision) ||
        v.revision < 1 ||
        typeof v.studyVersion !== "string",
    )
  ) {
    throw new Error("Invalid upload revisions; data preserved.");
  }
  return revisions;
}

/** Caller holds dataLock. Dirty state is durable before response data changes. */
export async function markPingDirtyAsync(pingId: string) {
  const revisions = await getUploadRevisionsAsync();
  const previous = revisions[pingId];
  const next = (previous?.revision || 0) + 1;
  if (!Number.isSafeInteger(next))
    throw new Error("Upload revision exhausted.");
  await AsyncStorage.setItem(
    await getASKeyAsync(KEY),
    JSON.stringify({
      ...revisions,
      [pingId]: {
        revision: next,
        studyVersion:
          previous?.studyVersion ??
          ((await getStudyInfoAsync()).version || "legacy-unversioned"),
      },
    }),
  );
  await addToUnuploadedPingsListIfNeededAsync({ id: pingId } as Ping);
}

/** Caller holds dataLock. Never acknowledge a newer local edit. */
export async function acknowledgeRevisionsAsync(
  sent: UploadRevisions,
  pingIds: string[],
) {
  const current = await getUploadRevisionsAsync();
  await removeFromUnuploadedPingsListAsync(
    pingIds.filter(
      (id) => sent[id] && current[id]?.revision === sent[id].revision,
    ),
  );
}

export async function clearUploadRevisionsAsync() {
  await AsyncStorage.removeItem(await getASKeyAsync(KEY));
}
