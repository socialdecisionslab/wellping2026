/* Offline synthetic regression checks; no real credentials or network calls. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "../..");
function load(file, mocks = {}) {
  const code = ts.transpileModule(
    fs.readFileSync(path.join(root, file), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React,
      },
    },
  ).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    require: (name) => {
      if (name in mocks) return mocks[name];
      if (name.endsWith("/networkSafety") || name === "./networkSafety")
        return safety;
      if (name === "url") return require("url");
      return {};
    },
    fetch: (...args) => fetchMock(...args),
    console,
    setTimeout,
  });
  return exports;
}
let fetchMock = () => {
  throw Error("Unexpected fetch");
};
const safety = load("src/helpers/networkSafety.ts");
(async () => {
  for (const url of [
    "http://example.com",
    "https://user:pass@example.com",
    "https://example.com\\@evil.com",
    "https://example.com\n",
    "javascript:alert(1)",
  ]) {
    assert.throws(() => safety.getHttpsOrigin(url));
  }
  assert.equal(
    safety.isSameHttpsOrigin(
      "https://example.com:443/a",
      "https://example.com/b",
    ),
    true,
  );
  assert.equal(
    safety.isSameHttpsOrigin(
      "https://example.com.evil/a",
      "https://example.com/b",
    ),
    false,
  );
  assert.equal(
    safety.isSameHttpsOrigin(
      "https://example.com:444/a",
      "https://example.com/b",
    ),
    false,
  );
  for (const suffix of [
    "?x=__PASSWORD_HASH__",
    "?x=__FIREBASE_ID_TOKEN__",
    "/__LOGIN_SESSION_ID__",
    "?x=%5F%5FPASSWORD_HASH%5F%5F",
    "?password=literal",
  ]) {
    assert.throws(() =>
      safety.assertSafeDashboardTemplate("https://example.com/" + suffix),
    );
  }
  safety.assertSafeDashboardTemplate("https://example.com/?study=__STUDY_ID__");
  const dashboard = load("src/components/DashboardComponent.tsx", {
    "../helpers/secureStore/user": {
      secureGetUserAsync: async () => ({ username: "a&token=injected" }),
    },
  });
  assert.equal(
    await dashboard.getDashboardUrlAsync(
      {
        dashboardURL: "https://example.com/?u=__USERNAME__&s=__STUDY_ID__",
        id: "x/y",
      },
      null,
    ),
    "https://example.com/?u=a%26token%3Dinjected&s=x%2Fy",
  );
  await assert.rejects(
    dashboard.getDashboardUrlAsync(
      { dashboardURL: "https://example.com/?x=__PASSWORD_HASH__" },
      null,
    ),
  );
  let ended;
  const syntheticUser = {
    username: "demo",
    password: "SECRET",
    loginDate: "2026-01-01T00:00:00.000Z",
  };
  const syntheticPayload = {
    user: { username: "demo", loginSessionId: "SYNTHETIC_SESSION" },
    pings: [],
    answers: [],
  };
  const beiwe = load("src/helpers/beiwe.ts", {
    "./dataJournal": {
      withDataJournalLockAsync: async (operation) => operation(),
    },
    "react-native": { Platform: { OS: "android" } },
    "./helpers": {
      getHashedPasswordAsync: async () => "SYNTHETIC_SECRET",
      base64ToBase64URL: (x) => x,
    },
    "./loginSession": {
      getLoginSessionIDAsync: async () => "SYNTHETIC_SESSION",
    },
    "./studyFile": {
      getStudyInfoAsync: async () => ({ id: "synthetic-study" }),
    },
    "./secureStore/user": {
      secureGetUserAsync: async () => ({ ...syntheticUser }),
    },
    "./server": {
      getBeiweServerConfig: () => ({ serverUrl: "https://example.com" }),
    },
  });
  for (const status of [302, 401, 403, 500]) {
    let requested = false;
    fetchMock = async () => {
      requested = true;
      return { status, json: async () => ({}) };
    };
    await assert.rejects(
      beiwe.beiweUploadDataForUserAsync(
        syntheticPayload,
        syntheticUser,
        () => {},
        (x) => (ended = x),
      ),
      (error) => !/SECRET|SESSION|https:/.test(error.message),
    );
    assert.ok(ended);
    assert(requested, "status rejection must exercise the network boundary");
  }
  fetchMock = async () => {
    throw Error("https://example.com/?password=SECRET");
  };
  await assert.rejects(
    beiwe.beiweLoginAsync({ username: "demo", password: "SECRET" }),
    (error) => !/SECRET|https:/.test(error.message),
  );
  fetchMock = async (_, options) => {
    assert.equal(options.redirect, "error");
    return { status: 200, json: async () => ({ ok: true }) };
  };
  assert.equal(
    (
      await beiwe.beiweUploadDataForUserAsync(
        syntheticPayload,
        syntheticUser,
        () => {},
        () => {},
      )
    ).ok,
    true,
  );
  const study = load("src/helpers/studyFile.ts", {
    "../../config/studyWhitelist": {
      STUDY_FILE_URL_PREFIXES_WHITELIST: ["https://example.com/"],
    },
    "expo-crypto": {
      CryptoDigestAlgorithm: { SHA256: "sha256" },
      CryptoEncoding: { BASE64: "base64" },
      digestStringAsync: async () => "SYNTHETIC_HASH",
    },
  });
  await assert.rejects(
    study.downloadStudyFileAsync({
      url: study.WELLPING_LOCAL_DEBUG_URL,
      username: "synthetic",
      password: "test-only",
    }),
    /debug study entry is disabled/,
  );
  await assert.rejects(
    study.downloadStudyFileAsync({
      url: "http://example.com/test",
      username: "demo",
      password: "SECRET",
    }),
  );
  await assert.rejects(
    study.downloadStudyFileAsync({
      url: "https://example.com.evil/test",
      username: "demo",
      password: "SECRET",
    }),
  );
  fetchMock = async () => {
    throw Error("https://example.com/?password=SECRET");
  };
  await assert.rejects(
    study.downloadStudyFileAsync({
      url: "https://example.com/test",
      username: "demo",
      password: "SECRET",
    }),
    (error) => !/SECRET|https:/.test(error.message),
  );
  fetchMock = async () => ({ status: 302 });
  await assert.rejects(
    study.downloadStudyFileAsync({
      url: "https://example.com/test",
      username: "demo",
      password: "SECRET",
    }),
  );
  fetchMock = async (_, options) => {
    assert.equal(options.redirect, "error");
    return {
      status: 200,
      text: async () => "{}",
      headers: { get: () => "application/json" },
    };
  };
  assert.equal(
    await study.downloadStudyFileAsync({
      url: "https://example.com/test",
      username: "demo",
      password: "SECRET",
    }),
    "{}",
  );
  console.log("Network boundary checks passed (synthetic offline tests).");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
