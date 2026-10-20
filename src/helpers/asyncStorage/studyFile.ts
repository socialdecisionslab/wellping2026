import AsyncStorage from "@react-native-async-storage/async-storage";
import { StudyFileSchema } from "@wellping/study-schemas/lib/schemas/StudyFile";
import {
  StudyFile,
  Streams,
  StudyInfo,
  ExtraData,
} from "@wellping/study-schemas/lib/types";
import { withDataJournalLockAsync } from "../dataJournal";
import { LOCAL_STORAGE_PREFIX } from "../../../config/local";

const KEY = `${LOCAL_STORAGE_PREFIX}currentStudyFile.v2`;
const LEGACY = ["StudyInfo", "Streams", "ExtraData"].map(
  (part) => `${LOCAL_STORAGE_PREFIX}currentStudyFile_${part}`,
);

/** A single replacement prevents mixed questionnaire/configuration revisions. */
export async function storeCurrentStudyFileAsync(studyFile: StudyFile) {
  const study = StudyFileSchema.parse(studyFile);
  await withDataJournalLockAsync(() =>
    AsyncStorage.setItem(KEY, JSON.stringify({ version: 2, study })),
  );
}

export async function clearCurrentStudyFileAsync() {
  // Commit a tombstone first: interrupted legacy cleanup must not resurrect it.
  await withDataJournalLockAsync(async () => {
    await AsyncStorage.setItem(
      KEY,
      JSON.stringify({ version: 2, study: null }),
    );
    for (const key of LEGACY) await AsyncStorage.removeItem(key);
  });
}

export async function getCurrentStudyFileAsync(): Promise<StudyFile | null> {
  const raw = await AsyncStorage.getItem(KEY);
  if (raw !== null) {
    const envelope = JSON.parse(raw);
    if (!envelope || envelope.version !== 2 || !("study" in envelope))
      throw new Error(
        "Saved study configuration needs recovery; data preserved.",
      );
    return envelope.study === null
      ? null
      : StudyFileSchema.parse(envelope.study);
  }
  const parts = await Promise.all(
    LEGACY.map((key) => AsyncStorage.getItem(key)),
  );
  if (parts.every((part) => part === null)) return null;
  if (parts.some((part) => part === null))
    throw new Error("Saved study configuration is incomplete; data preserved.");
  return StudyFileSchema.parse({
    studyInfo: JSON.parse(parts[0]!),
    streams: JSON.parse(parts[1]!),
    extraData: JSON.parse(parts[2]!),
  });
}
export async function getCurrentStudyInfoAsync(): Promise<StudyInfo | null> {
  return (await getCurrentStudyFileAsync())?.studyInfo ?? null;
}
export async function getCurrentStreamsAsync(): Promise<Streams | null> {
  return (await getCurrentStudyFileAsync())?.streams ?? null;
}
export async function getCurrentExtraDataAsync(): Promise<ExtraData | null> {
  return (await getCurrentStudyFileAsync())?.extraData ?? null;
}
