import Constants from "expo-constants";

// Only the explicit local runner sets this flag; __DEV__ alone is not isolation.
export const IS_LOCAL_DEVELOPMENT =
  Constants.manifest?.extra?.wellpingLocalOnly === true;

export const LOCAL_STORAGE_PREFIX = IS_LOCAL_DEVELOPMENT ? "LOCAL_ONLY:" : "";
