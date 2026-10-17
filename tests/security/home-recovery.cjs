// Synthetic component checks; no native APIs, storage, or network.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
class Component {
  constructor(props) {
    this.props = props;
  }
  setState(next, callback) {
    Object.assign(this.state, next);
    if (callback) callback();
  }
}
const react = {
  default: {
    Component,
    createElement: (type, props, ...children) => ({ type, props, children }),
  },
};
let resumeReads = 0,
  resumeFails = true,
  uploadFails = false,
  logoutFails = true,
  alert;
let drain = async () => {};
const state = {
  currentQuestionData: { questionId: "synthetic" },
  nextQuestionsDataStack: [],
  answers: {},
};
function load(file) {
  const exports = {};
  const mocks = {
    react,
    "react-native": {
      AppState: { currentState: "active" },
      View: "View",
      Text: "Text",
      Button: "Button",
      Alert: {
        alert: (...args) => {
          alert = args;
        },
      },
    },
    "./helpers/asyncStorage/pingState": {
      MissingResumeStateError: class extends Error {},
      async getPingStateAsync() {
        resumeReads++;
        if (resumeFails) throw Error("SYNTHETIC_SECRET");
        return state;
      },
    },
    "./helpers/debug": {
      HOME_SCREEN_DEBUG_VIEW_SYMBOLS: { UPLOAD: { INITIAL: "" } },
    },
    "./helpers/styles": { styles: {} },
    "date-fns": { format: () => "synthetic date" },
    "./helpers/studyFile": {
      getStudyEndDate: () => new Date("2000-01-02"),
      getStudyStartDate: () => new Date("2000-01-01"),
    },
    "./helpers/surveyAnswerWrites": {
      waitForPendingSurveySavesAsync: () => drain(),
    },
    "./helpers/dataUpload": {
      async uploadDataAsync() {
        if (uploadFails) throw Error("SYNTHETIC_SECRET");
        return { private: "SYNTHETIC_SECRET" };
      },
    },
    "./helpers/dataJournal": {
      async getVerifiedPendingLogoutAsync() {
        return null;
      },
    },
    "./helpers/users": {
      async logoutAsync() {
        if (logoutFails) throw Error("Pending responses");
      },
    },
  };
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      // VM mocks explicitly expose default exports; keep this contract across TS versions.
      esModuleInterop: false,
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    require: (k) => mocks[k] || {},
    Date,
    console,
  });
  return exports.default;
}
(async () => {
  const Home = load("src/HomeScreen.tsx");
  const home = new Home({ studyInfo: {}, streams: {} });
  home.setState({ isLoading: false, currentNotificationTime: new Date() });
  await home.restorePingAsync({ id: "finished", endTime: new Date() });
  assert.equal(resumeReads, 0, "completed ping does not read deleted resume");
  assert(JSON.stringify(home.render()).includes("Thank you for completing"));
  home.setState({ currentNotificationTime: null });
  const endedView = home.render();
  const endedText = JSON.stringify(endedView);
  assert(!endedText.includes("you may now uninstall"));
  assert(endedText.includes("Keep the"));
  assert(
    endedText.includes("refreshToken"),
    "sync control remains available after study end",
  );
  home.setState({ currentNotificationTime: new Date() });
  await home.restorePingAsync({ id: "incomplete", endTime: null });
  assert(home.state.resumeError);
  const view = home.render();
  assert(JSON.stringify(view).includes("Your data has not been deleted"));
  resumeFails = false;
  view.children
    .find((child) => child?.props?.title === "Retry recovery")
    .props.onPress();
  await new Promise(setImmediate);
  assert.equal(home.state.resumeError, false);
  assert.equal(home.state.storedPingStateAsync, state);
  await home._forceUploadAllDataAsync();
  assert.equal(alert[0], "Data uploaded");
  assert(!JSON.stringify(alert).includes("SYNTHETIC_SECRET"));
  uploadFails = true;
  await home._forceUploadAllDataAsync();
  assert.equal(alert[0], "Upload failed");
  assert(!JSON.stringify(alert).includes("SYNTHETIC_SECRET"));
  let release;
  drain = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const preserving = home.preserveExpiredSurveyAsync();
  assert(home.state.expirySavePending);
  assert(JSON.stringify(home.render()).includes("keep the app open"));
  await Promise.resolve();
  release();
  await preserving;
  assert.equal(home.state.currentPing, null);
  assert(home.state.expiredIncomplete);
  drain = async () => {
    throw Error("SYNTHETIC_SECRET");
  };
  await home.preserveExpiredSurveyAsync();
  assert(home.state.expirySaveError);
  assert(JSON.stringify(home.render()).includes("could not be saved yet"));
  assert(!JSON.stringify(home.render()).includes("SYNTHETIC_SECRET"));
  drain = async () => {};
  await home.preserveExpiredSurveyAsync();
  assert.equal(home.state.expirySaveError, false);
  const activePing = { id: "still-active", endTime: null };
  home.setState({ currentPing: activePing, expiredIncomplete: false });
  drain = async () => {
    throw Error("SYNTHETIC_SECRET");
  };
  await home._uploadUnuploadedDataAndRemoveFromThemIfSuccessfulAsync();
  assert(home.state.expirySaveError);
  drain = async () => {};
  await home.retryPendingSurveySavesAsync();
  assert.equal(
    home.state.currentPing,
    activePing,
    "generic save retry must not expire an active survey",
  );
  assert.equal(home.state.expiredIncomplete, false);
  const Root = load("src/RootScreen.tsx");
  const root = new Root({});
  root.setState({
    userInfo: { username: "synthetic" },
    survey: { synthetic: true },
  });
  await assert.rejects(root.logoutFnAsync());
  assert.equal(root.state.userInfo.username, "synthetic");
  logoutFails = false;
  await root.logoutFnAsync();
  assert.equal(root.state.userInfo, null);
  console.log(
    "PASS: completed-ping display, recovery retry, safe upload outcomes, failed logout retains session.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
