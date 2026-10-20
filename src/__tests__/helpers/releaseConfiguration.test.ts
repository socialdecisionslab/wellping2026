const configureRelease = require("../../../app.config");
const base = require("../../../app.json").expo;
const releaseEnv = {
  WELLPING_RELEASE_ENV: "staging",
  WELLPING_BACKEND_PROTOCOL: "wellping-v1",
  WELLPING_BACKEND_CONTRACT_APPROVED: "1",
  WELLPING_STUDY_URL: "https://study.invalid/config",
  WELLPING_BEIWE_URL: "https://beiwe.invalid",
  WELLPING_SUPPORT_EMAIL: "support@study.invalid",
  WELLPING_EAS_PROJECT_ID: "00000000-0000-4000-8000-000000000000",
  WELLPING_EXPO_OWNER: "synthetic-lab",
  WELLPING_EXPO_SLUG: "synthetic-study",
  WELLPING_IOS_BUNDLE_ID: "edu.synthetic.wellping",
  WELLPING_ANDROID_PACKAGE: "edu.synthetic.wellping",
};
let saved: NodeJS.ProcessEnv;
beforeEach(() => {
  saved = { ...process.env };
  Object.assign(process.env, releaseEnv);
  delete process.env.WELLPING_LOCAL_ONLY;
});
afterEach(() => {
  process.env = saved;
});
test("staging is separately identified, signed for devices, and has no OTA", () => {
  const config = configureRelease({ config: base });
  expect(config.ios.bundleIdentifier).toBe("edu.synthetic.wellping.staging");
  expect(config.android.package).toBe("edu.synthetic.wellping.staging");
  expect(config.updates.enabled).toBe(false);
  expect(config.extra.wellpingRelease.protocol).toBe("wellping-v1");
});
test.each(Object.keys(releaseEnv).filter((k) => k !== "WELLPING_RELEASE_ENV"))(
  "missing %s blocks the build",
  (key) => {
    delete process.env[key];
    expect(() => configureRelease({ config: base })).toThrow();
  },
);
test.each([
  "http://study.invalid",
  "https://name:secret@study.invalid",
  "https://study.invalid?password=secret",
])("unsafe endpoint blocks the build: %s", (url) => {
  process.env.WELLPING_STUDY_URL = url;
  expect(() => configureRelease({ config: base })).toThrow();
});
test("historical identifiers and mixing local/release mode are rejected", () => {
  process.env.WELLPING_IOS_BUNDLE_ID = "app.wellping";
  expect(() => configureRelease({ config: base })).toThrow();
  process.env.WELLPING_LOCAL_ONLY = "1";
  expect(() => configureRelease({ config: base })).toThrow();
});
