import { RELEASE } from "./release";
export const CONFIG = {
  LOGIN_CODE_SEPARATOR: "-",
  DEFAULT_STUDY_FILE_URL:
    RELEASE?.studyUrl ??
    "https://wellping.communitiesproject.stanfordsnl.org/studyFile",
};
