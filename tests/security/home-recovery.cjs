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
    Object.assign(this.state, typeof next === "function" ? next(this.state) : next);
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
let intervalCallback, notificationCallback, receiptCallback, foregroundCallback;
let removedSubscriptions = 0;
const state = {
  currentQuestionData: { questionId: "synthetic" },
  nextQuestionsDataStack: [],
  answers: {},
};
function load(file, overrides = {}) {
  const exports = {};
  const mocks = {
    react,
    "react-native": {
      AppState: {
        currentState: "active",
        addEventListener: (_event, callback) => {
          foregroundCallback = callback;
          return { remove: () => removedSubscriptions++ };
        },
      },
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
    "expo-notifications": {
      addNotificationReceivedListener: (callback) => {
        receiptCallback = callback;
        return { remove: () => removedSubscriptions++ };
      },
      addNotificationResponseReceivedListener: (callback) => {
        notificationCallback = callback;
        return { remove: () => removedSubscriptions++ };
      },
    },
    "./helpers/notifications": {
      setupNotificationsPermissionAsync: async () => true,
      setNotificationsAsync: async () => {},
      getCurrentNotificationTimeAsync: async () => null,
      clearSentNotificationsAsync: async () => {},
    },
    "./helpers/pings": { getLatestPingAsync: async () => null },
    "./helpers/server": { isUsingFirebase: () => false },
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
      isJournalPingActiveAsync: async () => true,
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
    require: (k) => overrides[k] || mocks[k] || {},
    Date,
    console,
    setInterval: (callback) => {
      intervalCallback = callback;
      return 1;
    },
    clearInterval: () => {
      intervalCallback = null;
    },
  });
  return exports.default;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function preservationCallbackRegressions() {
  const tick = () => new Promise(setImmediate);
  for (const boundary of ["unmount", "restart"]) {
    for (const fails of [false, true]) {
      const pending = deferred();
      let drains = 0;
      const Home = load("src/HomeScreen.tsx", {
        "./helpers/surveyAnswerWrites": {
          waitForPendingSurveySavesAsync: () => {
            drains++;
            return drains === 1 ? pending.promise : Promise.resolve();
          },
        },
      });
      const screen = new Home({ studyInfo: {}, streams: {} });
      screen.homeMounted = true;
      const callbacks = [];
      const setState = screen.setState.bind(screen);
      let writes = 0;
      screen.setState = (next, callback) => {
        writes++;
        setState(next);
        if (callback) callbacks.push(callback);
      };
      let settled = false;
      const preservation = screen.preserveExpiredSurveyAsync();
      void preservation.then(() => { settled = true; });
      await tick();
      assert.equal(drains, 1, "accepted writes drain without a React completion callback");
      assert.equal(settled, false, "preservation still awaits accepted writes");
      let recovery;
      if (boundary === "unmount") screen.componentWillUnmount();
      else recovery = screen.startHomeAsync();
      await tick();
      assert.equal(drains, 1, "recovery cannot bypass pending preservation");
      writes = 0;
      if (fails) pending.reject(Error("SYNTHETIC_SECRET"));
      else pending.resolve();
      await tick();
      assert.equal(settled, true, "discarded callbacks cannot strand preservation");
      assert.equal(screen.preservingExpired, null);
      if (boundary === "unmount") {
        assert.equal(writes, 0, "detached completion never publishes state");
        recovery = screen.componentDidMount();
      }
      await recovery;
      await preservation;
      assert.equal(screen.state.isLoading, false);
      assert.equal(screen.state.startupError, false);
      assert.equal(screen.state.expirySavePending, false);
      assert.equal(screen.state.expirySaveError, false);
      const recovered = JSON.stringify(screen.state);
      for (const callback of callbacks) callback();
      await tick();
      assert.equal(JSON.stringify(screen.state), recovered, "late callbacks cannot change recovery");
      screen.componentWillUnmount();
    }
  }
  console.log("PASS: dropped/deferred preservation callbacks, unmount/restart and successful/failed write recovery.");
}

async function automaticSyncRegressions() {
  const tick = () => new Promise(setImmediate);
  const network = deferred();
  const writes = deferred();
  let uploadCalls = 0;
  let waitForWrites = false;
  let reportStatus;
  const Home = load("src/HomeScreen.tsx", {
    "./helpers/surveyAnswerWrites": {
      waitForPendingSurveySavesAsync: () =>
        waitForWrites ? writes.promise : Promise.resolve(),
    },
    "./helpers/dataUpload": {
      uploadDataAsync: (_study, status) => {
        uploadCalls++;
        reportStatus = status;
        return network.promise;
      },
    },
  });
  const screen = new Home({ studyInfo: {}, streams: {} });
  await screen.componentDidMount();
  await tick();
  assert.equal(uploadCalls, 1, "startup retries retained uploads");
  assert.equal(screen.state.isLoading, false, "offline startup does not await the network");
  intervalCallback();
  await screen.homeWork;
  assert.equal(uploadCalls, 1, "expiration timer does not repeatedly enqueue uploads");
  screen.setState({ appState: "background" });
  foregroundCallback("active");
  await screen.homeWork;
  await tick();
  assert.equal(uploadCalls, 2, "foreground retries without awaiting the older network request");
  waitForWrites = true;
  screen.setState({ appState: "background" });
  foregroundCallback("active");
  await screen.homeWork;
  assert.equal(uploadCalls, 2, "sync waits for accepted response writes");
  screen.componentWillUnmount();
  const detachedState = JSON.stringify(screen.state);
  reportStatus("SYNTHETIC_STALE_STATUS");
  writes.resolve();
  network.reject(Error("SYNTHETIC_SECRET"));
  await tick();
  assert.equal(uploadCalls, 2, "detached save completion cannot dispatch a new upload");
  assert.equal(JSON.stringify(screen.state), detachedState, "detached network completion cannot publish state");
  console.log("PASS: startup/foreground upload retries, nonblocking offline lifecycle, timer deduplication and stale upload fencing.");
}

async function lifecycleRegressions() {
  const tick = () => new Promise(setImmediate);
  let latest = async () => null;
  let permission = async () => true;
  let currentTime = async () => null;
  let resume = async () => state;
  let active = async () => true;
  let schedules = 0;
  let removals = 0;
  const callbacks = [];
  const LifecycleHome = load("src/HomeScreen.tsx", {
    "expo-notifications": {
      addNotificationReceivedListener: (callback) => {
        callbacks.push(callback);
        return { remove: () => removals++ };
      },
      addNotificationResponseReceivedListener: (callback) => {
        callbacks.push(callback);
        return { remove: () => removals++ };
      },
    },
    "./helpers/notifications": {
      setupNotificationsPermissionAsync: () => permission(),
      setNotificationsAsync: async () => { schedules++; },
      getCurrentNotificationTimeAsync: () => currentTime(),
      clearSentNotificationsAsync: async () => {},
    },
    "./helpers/pings": { getLatestPingAsync: () => latest() },
    "./helpers/dataJournal": { isJournalPingActiveAsync: () => active() },
    "./helpers/asyncStorage/pingState": {
      MissingResumeStateError: class extends Error {},
      getPingStateAsync: () => resume(),
    },
  });
  const screen = new LifecycleHome({ studyInfo: {}, streams: {} });
  const latestGate = deferred();
  latest = () => latestGate.promise;
  const initial = screen.componentDidMount();
  await tick();
  assert.equal(intervalCallback, null, "timer waits for initialization");
  callbacks.at(-1)();
  screen.setState({ appState: "background" });
  foregroundCallback("active");
  assert.equal(screen.homeWork, initial, "startup owns the refresh lane");
  assert.equal(schedules, 0);
  const oldTime = new Date("2026-01-01T10:00:00Z");
  const newTime = new Date("2026-01-01T11:00:00Z");
  const refreshGate = deferred();
  let reads = 0;
  currentTime = () => {
    reads++;
    if (reads === 2) return refreshGate.promise;
    return Promise.resolve(reads === 1 ? oldTime : newTime);
  };
  latestGate.resolve(null);
  await tick();
  assert.equal(reads, 2);
  callbacks.at(-1)();
  callbacks.at(-1)();
  refreshGate.resolve(oldTime);
  await initial;
  assert.equal(reads, 3, "events during a read cause one trailing check");
  assert.equal(screen.state.currentNotificationTime, newTime);
  assert.equal(screen.state.isLoading, false);

  for (let attempt = 0; attempt < 2; attempt++) {
    currentTime = async () => { throw Error("SYNTHETIC_SECRET"); };
    callbacks.at(-1)();
    await screen.homeWork;
    assert(screen.state.startupError);
    assert.equal(intervalCallback, null);
    const staleCallback = callbacks.at(-1);
    latest = async () => null;
    currentTime = async () => null;
    await screen.startHomeAsync();
    const timer = intervalCallback;
    staleCallback();
    assert.equal(screen.homeWork, null, "removed listeners cannot queue work");
    assert.equal(intervalCallback, timer);
    assert.equal(screen.state.startupError, false);
  }
  const oldRefresh = deferred();
  currentTime = () => oldRefresh.promise;
  const oldWork = screen.refreshHomeAsync();
  await tick();
  screen.componentWillUnmount();
  let writes = 0;
  const setState = screen.setState.bind(screen);
  screen.setState = (...args) => { writes++; setState(...args); };
  oldRefresh.resolve(newTime);
  await oldWork;
  assert.equal(writes, 0, "late refresh cannot write after unmount");
  assert.equal(intervalCallback, null);

  currentTime = async () => null;
  const permissionGate = deferred();
  let permissions = 0;
  permission = () => ++permissions === 1 ? permissionGate.promise : Promise.resolve(true);
  const oldStartup = screen.componentDidMount();
  await tick();
  const schedulesBefore = schedules;
  screen.componentWillUnmount();
  const restarted = screen.componentDidMount();
  await tick();
  assert.equal(permissions, 1, "replacement initialization waits for old work");
  permissionGate.reject(Error("SYNTHETIC_SECRET"));
  await Promise.all([oldStartup, restarted]);
  assert.equal(schedules, schedulesBefore + 1, "stale startup cannot schedule");
  assert.equal(screen.state.startupError, false, "stale rejection cannot fail recovery");
  assert.equal(typeof intervalCallback, "function");
  screen.componentWillUnmount();

  const resumeGate = deferred();
  permission = async () => true;
  latest = async () => ({ id: "retained", endTime: null, notificationTime: oldTime });
  currentTime = async () => oldTime;
  resume = () => resumeGate.promise;
  const restoring = screen.componentDidMount();
  await tick();
  screen.componentWillUnmount();
  writes = 0;
  resumeGate.resolve(state);
  await restoring;
  assert.equal(writes, 0, "late resume read cannot resurrect a survey");
  assert.equal(intervalCallback, null);

  const activeGate = deferred();
  let activeReads = 0;
  active = () => {
    activeReads++;
    return activeGate.promise;
  };
  const checkingActive = screen.componentDidMount();
  await tick();
  screen.componentWillUnmount();
  writes = 0;
  activeGate.resolve(false);
  await checkingActive;
  assert.equal(activeReads, 1, "stale inactive result cannot launch a second journal read");
  assert.equal(writes, 0);
  active = async () => true;

  latest = async () => { throw Error("SYNTHETIC_SECRET"); };
  for (let attempt = 0; attempt < 2; attempt++) {
    await screen.componentDidMount();
    assert(screen.state.startupError);
    assert.equal(intervalCallback, null);
  }
  latest = async () => null;
  await screen.startHomeAsync();
  assert.equal(screen.state.startupError, false);
  const pendingSave = deferred();
  drain = () => pendingSave.promise;
  const saving = screen.preserveExpiredSurveyAsync();
  await tick();
  screen.componentWillUnmount();
  writes = 0;
  pendingSave.resolve();
  await saving;
  assert.equal(writes, 0, "old save completion cannot change a later lifecycle");
  drain = async () => {};
  await screen.componentDidMount();
  assert.equal(screen.state.expirySavePending, false);
  assert.equal(screen.expiryTransitionRequested, false);
  let readyEventSent = false;
  let readyReads = 0;
  currentTime = async () => ++readyReads < 3 ? oldTime : newTime;
  screen.setState = (next, callback) => {
    setState(next, callback);
    if (next.isLoading === false && !next.startupError && !readyEventSent) {
      readyEventSent = true;
      callbacks.at(-1)();
    }
  };
  await screen.startHomeAsync();
  await tick();
  assert.equal(readyReads, 3, "an event at task completion is not lost before finally");
  assert.equal(screen.state.currentNotificationTime, newTime);
  screen.componentWillUnmount();
  assert.equal(removals, callbacks.length, "every notification subscription is removed once");
  class MissingResumeStateError extends Error {}
  const answerRead = deferred();
  const MissingHome = load("src/HomeScreen.tsx", {
    "./helpers/asyncStorage/pingState": {
      MissingResumeStateError,
      getPingStateAsync: async () => { throw new MissingResumeStateError(); },
    },
    "./helpers/asyncStorage/answersPingIdsQuestionIdsList": {
      getAnswersPingIdsQuestionIdsListAsync: () => answerRead.promise,
    },
  });
  const missing = new MissingHome({ studyInfo: {}, streams: {} });
  const failedRestore = missing.restorePingAsync({ id: "retained", endTime: null });
  await tick();
  answerRead.reject(Error("SYNTHETIC_SECRET"));
  await failedRestore;
  assert(missing.state.resumeError, "failed ownership/resume evidence stays fail-closed");
  const staleRestore = missing.restorePingAsync({ id: "late", endTime: null });
  missing.componentWillUnmount();
  await staleRestore;
  assert.equal(missing.state.currentPing.id, "retained");
  console.log("PASS: startup serialization, trailing notification checks, repeated failure/retry, stale startup/refresh/resume fencing and subscription cleanup.");
}

async function authLifecycleRegressions() {
  let onAuth, credentialRead;
  let logins = 0, warnings = 0, unsubscribed = 0;
  const AuthHome = load("src/HomeScreen.tsx", {
    "firebase/auth": {
      onAuthStateChanged: (_auth, callback) => {
        onAuth = callback;
        return () => { unsubscribed++; };
      },
    },
    "./helpers/server": { isUsingFirebase: () => true },
    "./helpers/firebase": {
      firebaseInitialized: () => true,
      getFirebaseAuth: () => ({}),
      firebaseLoginAsync: async () => { logins++; },
    },
    "./helpers/secureStore/user": { secureGetUserAsync: () => credentialRead.promise },
    "./helpers/debug": {
      HOME_SCREEN_DEBUG_VIEW_SYMBOLS: { UPLOAD: { INITIAL: "" } },
      alertWithShareButtonContainingDebugInfoAsync: async (message) => {
        assert(!message.includes("SYNTHETIC_SECRET"));
        warnings++;
      },
    },
  });
  const screen = new AuthHome({ studyInfo: {}, streams: {} });
  await screen.componentDidMount();
  credentialRead = deferred();
  const stale = onAuth(null);
  screen.componentWillUnmount();
  credentialRead.resolve({ username: "synthetic" });
  await stale;
  assert.equal(logins, 0, "late credential reads cannot start authentication");
  await onAuth({ uid: "stale-user" });
  assert.equal(screen.state.firebaseUser, null);
  await screen.componentDidMount();
  credentialRead = deferred();
  const failed = onAuth(null);
  credentialRead.reject(Error("SYNTHETIC_SECRET"));
  await failed;
  assert.equal(warnings, 1, "credential-read errors are handled and sanitized");
  screen.componentWillUnmount();
  assert.equal(unsubscribed, 2);
  console.log("PASS: stale authentication callbacks and credential-read rejection recovery.");
}

async function resumeRetryRegressions() {
  const tick = () => new Promise(setImmediate);
  const oldTime = new Date("2026-01-01T10:00:00Z");
  const nextTime = new Date("2026-01-01T11:00:00Z");
  for (const order of ["resume-first", "expiry-first"]) {
    for (const outcome of ["success", "failure"]) {
      const resumeGate = deferred();
      const expiryGate = deferred();
      let active = true, resumeReads = 0, timeReads = 0;
      let time = oldTime;
      const RetryHome = load("src/HomeScreen.tsx", {
        "./helpers/asyncStorage/pingState": {
          MissingResumeStateError: class extends Error {},
          getPingStateAsync: () => { resumeReads++; return resumeGate.promise; },
        },
        "./helpers/dataJournal": { isJournalPingActiveAsync: async () => active },
        "./helpers/notifications": {
          getCurrentNotificationTimeAsync: () => {
            timeReads++;
            return order === "expiry-first" && timeReads === 1
              ? expiryGate.promise : Promise.resolve(time);
          },
          clearSentNotificationsAsync: async () => {},
        },
      });
      const screen = new RetryHome({ studyInfo: {}, streams: {} });
      const ping = { id: "retained", endTime: null, notificationTime: oldTime };
      screen.homeMounted = true;
      screen.setState({
        currentPing: ping, currentNotificationTime: oldTime,
        resumeError: true, storedPingStateAsync: state, isLoading: false,
      });
      const retry = screen.render().children.find(
        (child) => child?.props?.title === "Retry recovery",
      ).props.onPress;
      if (order === "resume-first") {
        retry();
        await tick();
        assert.equal(resumeReads, 1);
        active = false;
        time = nextTime;
        screen.refreshHomeAsync();
        await tick();
        assert.equal(timeReads, 0, "refresh must wait for the pending resume read");
        if (outcome === "success") resumeGate.resolve(state);
        else resumeGate.reject(Error("SYNTHETIC_SECRET"));
      } else {
        screen.refreshHomeAsync();
        await tick();
        retry();
        assert.equal(resumeReads, 0, "retry waits for the pending expiration check");
        active = false;
        time = nextTime;
        expiryGate.resolve(nextTime);
      }
      await screen.homeWork;
      assert.equal(screen.state.currentPing, null, `${order}/${outcome}: no resurrection`);
      assert.equal(screen.state.resumeError, false, "obsolete resume error is cleared");
      assert.equal(screen.state.storedPingStateAsync, null);
      assert(screen.state.expiredIncomplete);
      assert(!JSON.stringify(screen.render()).includes("Saved progress could not be recovered"));
      assert.equal(resumeReads, order === "resume-first" ? 1 : 0);
      screen.componentWillUnmount();
    }
  }
  for (const outcome of ["success", "failure"]) {
    const pending = deferred();
    const RetryHome = load("src/HomeScreen.tsx", {
      "./helpers/asyncStorage/pingState": {
        MissingResumeStateError: class extends Error {},
        getPingStateAsync: () => pending.promise,
      },
    });
    const screen = new RetryHome({ studyInfo: {}, streams: {} });
    const ping = { id: "old", endTime: null };
    const replacement = { id: "replacement", endTime: null };
    screen.setState({ currentPing: ping });
    const restoring = screen.restorePingAsync(ping);
    screen.setState({ currentPing: replacement, resumeError: false });
    if (outcome === "success") pending.resolve(state);
    else pending.reject(Error("SYNTHETIC_SECRET"));
    await restoring;
    assert.equal(screen.state.currentPing, replacement);
    assert.equal(screen.state.resumeError, false);
  }
  console.log("PASS: resume/expiry completion orders, failed resume after expiry, superseded ping fencing and recovery-screen cleanup.");
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
  home.homeMounted = true;
  home.setState({ currentNotificationTime: null });
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
  const eventHome = new Home({ studyInfo: {}, streams: {} });
  eventHome.checkIfPingHasExpiredAsync = async () => {};
  await eventHome.componentDidMount();
  let rejectRefresh;
  let refreshCalls = 0;
  eventHome.checkIfPingHasExpiredAsync = () => {
    refreshCalls++;
    return new Promise((_resolve, reject) => {
      rejectRefresh = reject;
    });
  };
  const retainedPing = { id: "synthetic-active", endTime: null };
  eventHome.setState({ appState: "background", currentPing: retainedPing });
  foregroundCallback("active");
  intervalCallback();
  notificationCallback();
  receiptCallback();
  await Promise.resolve();
  assert.equal(refreshCalls, 1, "overlapping lifecycle checks are coalesced");
  const refreshing = eventHome.homeWork;
  rejectRefresh(Error("SYNTHETIC_SECRET"));
  await refreshing;
  assert(eventHome.state.startupError, "callback failures enter recovery");
  assert.equal(eventHome.state.currentPing, retainedPing);
  assert.equal(removedSubscriptions, 3);
  assert.equal(intervalCallback, null);
  const recoveryView = eventHome.render();
  assert(!JSON.stringify(recoveryView).includes("SYNTHETIC_SECRET"));
  assert(JSON.stringify(recoveryView).includes("Nothing has been deleted"));
  eventHome.checkIfPingHasExpiredAsync = async () => {};
  recoveryView.children
    .find((child) => child?.props?.title === "Retry recovery")
    .props.onPress();
  await eventHome.homeWork;
  assert.equal(eventHome.state.startupError, false);
  assert.equal(eventHome.state.isLoading, false);
  assert.equal(typeof intervalCallback, "function");
  eventHome.componentWillUnmount();
  assert.equal(removedSubscriptions, 6);
  await preservationCallbackRegressions();
  await automaticSyncRegressions();
  await lifecycleRegressions();
  await authLifecycleRegressions();
  await resumeRetryRegressions();
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
    "PASS: completed-ping display, recovery retry, safe upload outcomes, failed logout retains session, lifecycle failure recovery and coalescing.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
