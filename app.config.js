module.exports = ({ config }) => {
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
