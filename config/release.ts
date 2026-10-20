import Constants from "expo-constants";

const release = Constants.expoConfig?.extra?.wellpingRelease;
export const RELEASE = release as
  | {
      environment: "staging" | "production";
      protocol: "wellping-v1";
      studyUrl: string;
      beiweUrl: string;
      supportEmail: string;
    }
  | undefined;
