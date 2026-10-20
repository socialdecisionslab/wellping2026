module.exports = ({ config }) => {
  const environment = process.env.WELLPING_RELEASE_ENV;
  if (environment) {
    if (
      !["staging", "production"].includes(environment) ||
      process.env.WELLPING_LOCAL_ONLY === "1"
    ) {
      throw new Error(
        "Select exactly one local, staging, or production build environment.",
      );
    }
    const required = (key) => {
      const value = process.env[key]?.trim();
      if (!value) throw new Error(`Missing release configuration: ${key}`);
      return value;
    };
    if (
      required("WELLPING_BACKEND_PROTOCOL") !== "wellping-v1" ||
      required("WELLPING_BACKEND_CONTRACT_APPROVED") !== "1"
    ) {
      throw new Error(
        "The backend maintainer must approve and implement the wellping-v1 contract before release builds.",
      );
    }
    const https = (key) => {
      const value = required(key);
      const url = new URL(value);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        /[\\\s]/.test(value)
      )
        throw new Error(`Invalid HTTPS endpoint: ${key}`);
      return value.replace(/\/$/, "");
    };
    const studyUrl = https("WELLPING_STUDY_URL");
    const beiweUrl = https("WELLPING_BEIWE_URL");
    const identifier = (key) => {
      const value = required(key);
      if (
        !/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(value) ||
        [
          "app.wellping",
          "app.wellping.local",
          "edu.stanford.ssnl.wellping",
        ].includes(value)
      )
        throw new Error(`A lab-controlled identifier is required: ${key}`);
      return value + (environment === "staging" ? ".staging" : "");
    };
    const supportEmail = required("WELLPING_SUPPORT_EMAIL");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail))
      throw new Error("Invalid study support email.");
    const projectId = required("WELLPING_EAS_PROJECT_ID");
    if (!/^[a-f0-9-]{36}$/i.test(projectId))
      throw new Error("Invalid EAS project ID.");
    return {
      ...config,
      name: environment === "staging" ? "Well Ping Staging" : "Well Ping",
      owner: required("WELLPING_EXPO_OWNER"),
      slug: required("WELLPING_EXPO_SLUG"),
      updates: { enabled: false },
      extra: {
        wellpingRelease: {
          environment,
          protocol: "wellping-v1",
          studyUrl,
          beiweUrl,
          supportEmail,
        },
        eas: { projectId },
      },
      ios: {
        ...config.ios,
        bundleIdentifier: identifier("WELLPING_IOS_BUNDLE_ID"),
        associatedDomains: [],
      },
      android: {
        ...config.android,
        package: identifier("WELLPING_ANDROID_PACKAGE"),
        intentFilters: [],
        allowBackup: false,
      },
    };
  }
  if (process.env.WELLPING_LOCAL_ONLY !== "1") return config;

  return {
    ...config,
    name: "Well Ping Local",
    slug: "wellping-local",
    owner: undefined,
    scheme: "wellping-local",
    updates: { ...config.updates, enabled: false },
    extra: { ...config.extra, wellpingLocalOnly: true },
    ios: {
      ...config.ios,
      bundleIdentifier: "app.wellping.local",
      associatedDomains: [],
    },
    android: {
      ...config.android,
      package: "app.wellping.local",
      intentFilters: [],
    },
  };
};
