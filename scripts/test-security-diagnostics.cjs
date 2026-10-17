const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert/strict");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
function load(file, mocks) {
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
    require(n) {
      if (n in mocks) return mocks[n];
      throw Error("Unexpected import: " + n);
    },
    setTimeout,
    console: {
      error() {
        throw Error("Raw log emitted");
      },
    },
  });
  return exports;
}
(async () => {
  let shared, alert;
  const debug = load("src/helpers/debug.ts", {
    "@react-native-async-storage/async-storage": {},
    "expo-constants": { default: {} },
    "expo-device": {},
    "expo-application": {},
    "react-native-uuid": {},
    "react-native": {
      Share: {
        share: async (x) => {
          shared = x;
        },
      },
      Alert: {
        alert: (...args) => {
          alert = args;
        },
      },
    },
    "./asyncStorage/asyncStorageConfig": {},
  });
  const secret = "SYNTHETIC_SECRET_RESPONSE_CANARY";
  debug.logError(new Error(secret));
  assert(!debug.getCriticalProblemTextForUser(secret).includes(secret));
  assert(!debug.getNonCriticalProblemTextForUser(secret).includes(secret));
  await debug.shareDebugTextAsync(secret);
  assert(!JSON.stringify(shared).includes(secret));
  await debug.alertWithShareButtonContainingDebugInfoAsync(secret, secret);
  assert(!JSON.stringify(alert).includes(secret));
  const babel = require("@babel/core");
  const code = babel.transformSync(
    `console.log('${secret}'); console['error']('${secret}');`,
    {
      configFile: false,
      babelrc: false,
      plugins: [require("./babel-strip-console.cjs")],
    },
  ).code;
  assert(!code.includes(secret));
  for (const file of ["src/HomeScreen.tsx"]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert(!/const DebugView/.test(source));
    assert(!/onLongPress=.*displayDebugView/.test(source));
    assert(
      !/LOCAL DEBUG SURVEY|showDebugSurvey|Share all answers|Reset pings\/app/.test(
        source,
      ),
    );
  }
  let dequeued = false;
  const upload = load("src/helpers/dataUpload.ts", {
    "./beiwe": {},
    "./firebase": {},
    "./dataJournal": {
      captureDataSnapshotAsync: async () => ({
        owner: { username: "fixture", loginSessionId: "synthetic-session" },
        user: { username: "fixture" },
        pings: [{ id: "fixture" }],
        answers: [],
      }),
      assertDataOwnerAsync: async () => {},
      acknowledgeDataSnapshotAsync: async () => {
        dequeued = true;
      },
    },
    "./studyFile": { getStudyInfoAsync: async () => ({ server: {} }) },
    "./server": { isUsingFirebase: () => false, isUsingBeiwe: () => false },
    "./debug": {
      getUserInstallationInfoAsync: async () => ({ synthetic: true }),
      HOME_SCREEN_DEBUG_VIEW_SYMBOLS: {
        UPLOAD: { UPLOADING: "~", INITIAL: "" },
      },
    },
  });
  await assert.rejects(
    upload.uploadDataAsync({ server: {} }, () => {}, {
      unuploadedOnly: false,
    }),
    /No upload server/,
  );
  assert.equal(dequeued, false);
  console.log(
    "PASS: diagnostics, release log canary, debug UI removal, no-server queue preservation",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
