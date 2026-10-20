import AsyncStorage from "@react-native-async-storage/async-storage";
import { StudyFileSchema } from "@wellping/study-schemas/lib/schemas/StudyFile";
import { StreamsSchema } from "@wellping/study-schemas/lib/schemas/Stream";
import {
  StudyInfoSchema,
  ExtraDataSchema,
} from "@wellping/study-schemas/lib/schemas/StudyFile";
import {
  StudyFile,
  Streams,
  StudyInfo,
  ExtraData,
} from "@wellping/study-schemas/lib/types";

import {
  LOCAL_STORAGE_PREFIX,
  IS_LOCAL_DEVELOPMENT,
} from "../../../config/local";
import { logAndThrowError } from "../debug";

const STUDY_INFO_KEY = `${LOCAL_STORAGE_PREFIX}currentStudyFile_StudyInfo`;
const STREAMS_KEY = `${LOCAL_STORAGE_PREFIX}currentStudyFile_Streams`;
const EXTRA_DATA_KEY = `${LOCAL_STORAGE_PREFIX}currentStudyFile_ExtraData`;

const COMMITTED_STUDY_KEY = `${LOCAL_STORAGE_PREFIX}currentStudyFile.v2`;

async function committedStudy(): Promise<StudyFile | null> {
  const value = await AsyncStorage.getItem(COMMITTED_STUDY_KEY);
  return value === null ? null : StudyFileSchema.parse(JSON.parse(value));
}

/** Read all sections from one committed generation. Legacy records are read-only. */
export async function getCurrentStudyFileSnapshotAsync(): Promise<StudyFile> {
  const current = await committedStudy();
  if (current) return current;
  const [info, streams, extra] = await Promise.all([
    AsyncStorage.getItem(STUDY_INFO_KEY),
    AsyncStorage.getItem(STREAMS_KEY),
    AsyncStorage.getItem(EXTRA_DATA_KEY),
  ]);
  if (info === null || streams === null || extra === null)
    throw new Error("No complete study configuration is available.");
  return StudyFileSchema.parse({
    studyInfo: JSON.parse(info),
    streams: JSON.parse(streams),
    extraData: JSON.parse(extra),
  });
}

export async function storeCurrentStudyFileAsync(studyFile: StudyFile) {
  // One record is the commit boundary. A failed replacement cannot leave a mix
  // of old info, new streams, and old extra data. Legacy keys remain read-only.
  const validated = StudyFileSchema.parse(studyFile);
  const previous = await getCurrentStudyInfoAsync();
  if (
    !IS_LOCAL_DEVELOPMENT &&
    previous &&
    (previous.id !== validated.studyInfo.id ||
      JSON.stringify(previous.server) !==
        JSON.stringify(validated.studyInfo.server))
  ) {
    throw new Error(
      "Changing study identity or backend requires a new enrollment.",
    );
  }
  await AsyncStorage.setItem(COMMITTED_STUDY_KEY, JSON.stringify(validated));
}

export async function clearCurrentStudyFileAsync() {
  try {
    await AsyncStorage.removeItem(STUDY_INFO_KEY);
    await AsyncStorage.removeItem(STREAMS_KEY);
    await AsyncStorage.removeItem(EXTRA_DATA_KEY);
    await AsyncStorage.removeItem(COMMITTED_STUDY_KEY);
  } catch (error) {
    logAndThrowError(error);
  }
}

export async function getCurrentStudyInfoAsync(): Promise<StudyInfo | null> {
  try {
    const committed = await committedStudy();
    if (committed) return committed.studyInfo;
    const value = await AsyncStorage.getItem(STUDY_INFO_KEY);
    if (value == null) {
      return null;
    }
    const studyInfo: StudyInfo = StudyInfoSchema.parse(JSON.parse(value));
    return studyInfo;
  } catch (error) {
    // Preserve unreadable records for recovery; never erase on a read failure.
    logAndThrowError(error);
  }
}

export async function getCurrentStreamsAsync(): Promise<Streams | null> {
  try {
    const committed = await committedStudy();
    if (committed) return committed.streams;
    const value = await AsyncStorage.getItem(STREAMS_KEY);
    if (value == null) {
      return null;
    }
    const streams: Streams = StreamsSchema.parse(JSON.parse(value));
    return streams;
  } catch (error) {
    // Preserve unreadable records for recovery; never erase on a read failure.
    logAndThrowError(error);
  }
}

export async function getCurrentExtraDataAsync(): Promise<ExtraData | null> {
  try {
    const committed = await committedStudy();
    if (committed) return committed.extraData;
    const value = await AsyncStorage.getItem(EXTRA_DATA_KEY);
    if (value == null) {
      return null;
    }
    const extraData: ExtraData = ExtraDataSchema.parse(JSON.parse(value));
    return extraData;
  } catch (error) {
    // Preserve unreadable records for recovery; never erase on a read failure.
    logAndThrowError(error);
  }
}
