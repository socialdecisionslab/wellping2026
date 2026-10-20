export type UploadRevisions = Record<
  string,
  { revision: number; studyVersion: string | null }
>;
import { Answer } from "@wellping/study-schemas/lib/answerTypes";
import { Ping } from "@wellping/study-schemas/lib/types";

import { UserInstallationInfo } from "./debug";

export type UserData = {
  username: string;
  loginSessionId: string;
  installation: UserInstallationInfo;
};

export interface UploadData {
  user: UserData;
  studyId?: string;
  revisions?: UploadRevisions;
  receipt?: string;
}
export interface AllData extends UploadData {
  pings: Ping[];
  answers: Answer[];
}
export interface UnuploadedData extends UploadData {
  unuploadedPings: Ping[];
  unuploadedAnswers: Answer[];
}

export enum UploadDataType {
  ALL_DATA,
  UNUPLOADED_DATA,
}
export function getUploadDataType(uploadData: UploadData): UploadDataType {
  if ("unuploadedAnswers" in uploadData) {
    return UploadDataType.UNUPLOADED_DATA;
  } else {
    return UploadDataType.ALL_DATA;
  }
}
