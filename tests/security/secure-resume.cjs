// Offline regression tests: synthetic in-memory records, never a study backend.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const crypto = require("node:crypto");
const ts = require("typescript");
const path = require("node:path");
const ROOT = path.join(__dirname, "../..");
const sources = new Map();
function load(file, mocks) {
  if (!sources.has(file)) {
    sources.set(
      file,
      ts.transpileModule(fs.readFileSync(path.join(ROOT, file), "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          // VM mocks explicitly expose default exports; keep this contract across TS versions.
          esModuleInterop: false,
          target: ts.ScriptTarget.ES2020,
        },
      }).outputText,
    );
  }
  const exports = {};
  vm.runInNewContext(sources.get(file), {
    exports,
    console,
    setTimeout,
    Date,
    Promise,
    require(key) {
      if (key in mocks) return mocks[key];
      throw Error("Unexpected dependency " + key);
    },
  });
  return exports;
}
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const state = {
  currentQuestionData: { questionId: "q", extraData: {} },
  nextQuestionsDataStack: [],
  answers: {
    q: {
      pingId: "p",
      questionId: "q",
      preferNotToAnswer: null,
      data: { value: ["🔐".repeat(1800)] },
      date: "2026-10-17T00:00:00.000Z",
    },
  },
  isInTransition: false,
};
function fixture({ local = false } = {}) {
  const secure = new Map(),
    plain = new Map(),
    events = [],
    durableAnswers = new Map();
  let fault = null,
    user = { username: "synthetic-a", loginDate: 10 };
  const scope = local
    ? "WELLPING_LOCAL-installation.study"
    : "installation.study";
  const studyPrefix = local ? "LOCAL_ONLY:study/" : "study/";
  const indexKey = `${
    local ? "LOCAL_ONLY:" : ""
  }@WELLPING:legacyResumeQuarantineIndex.v1`;
  const sourceKey = `${studyPrefix}PingsState:p`;
  async function mutate(op, key, value, commit) {
    const event = { op, key, value };
    events.push(event);
    if (fault) await fault(event, "before");
    commit();
    if (fault) await fault(event, "after");
  }
  const mocks = {
    "expo-secure-store": {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
      async getItemAsync(key) {
        return secure.has(key) ? secure.get(key) : null;
      },
      async setItemAsync(key, value) {
        assert(
          Buffer.byteLength(value) <= 2048,
          "every secure write fits the legacy native limit",
        );
        await mutate("secure.set", key, value, () => secure.set(key, value));
      },
      async deleteItemAsync(key) {
        await mutate("secure.delete", key, undefined, () => secure.delete(key));
      },
    },
    "react-native-uuid": { default: { v4: crypto.randomUUID } },
    "expo-crypto": {
      CryptoDigestAlgorithm: { SHA256: "sha256" },
      async digestStringAsync(_, value) {
        return hash(value);
      },
    },
    "@react-native-async-storage/async-storage": {
      default: {
        async getItem(key) {
          return plain.has(key) ? plain.get(key) : null;
        },
        async setItem(key, value) {
          await mutate("plain.set", key, value, () => plain.set(key, value));
        },
        async removeItem(key) {
          await mutate("plain.delete", key, undefined, () => plain.delete(key));
        },
        async getAllKeys() {
          return [...plain.keys()];
        },
      },
    },
    "../asyncStorage/asyncStorageConfig": {
      ASYNC_STORAGE_WELLPING_PREFIX: `${local ? "LOCAL_ONLY:" : ""}@WELLPING:`,
    },
    "./secureStore": {
      async getSSKeyAsync() {
        return scope;
      },
    },
    "../secureStore/secureStore": {
      async getSSKeyAsync() {
        return scope;
      },
    },
    "./asyncStorage": {
      async getASKeyAsync(key = "") {
        return studyPrefix + key;
      },
    },
    "../dataJournal": {
      DataRecoveryError: class extends Error {
        constructor(code) {
          super(code);
          this.code = code;
        }
      },
      async withOpenDataSessionAsync(expectedOwnerId, operation) {
        if (!user || expectedOwnerId !== hash(JSON.stringify(user)))
          throw Error("Owner changed");
        return operation();
      },
      async getJournalPingIdsAsync() {
        return ["p"];
      },
      async captureCurrentDataOwnerAsync() {
        if (!user) throw Error("No owner");
        return {
          ...user,
          id: hash(JSON.stringify(user)),
          secureNamespace: scope,
        };
      },
      async assertDataOwnerAsync(expected) {
        if (!user || expected.id !== hash(JSON.stringify(user)))
          throw Error("Owner changed");
      },
      async getDataOwnerAsync() {
        if (!user) throw Error("No owner");
        return {
          ...user,
          id: hash(JSON.stringify(user)),
          secureNamespace: scope,
        };
      },
      async getResumeAnswersAsync(pingId, expectedOwnerId) {
        if (!user || expectedOwnerId !== hash(JSON.stringify(user)))
          throw Error("Owner changed");
        return [...durableAnswers.values()].filter(
          (answer) => answer.pingId === pingId,
        );
      },
    },
  };
  function boot() {
    const chunks = load("src/helpers/secureStore/chunkedValue.ts", mocks);
    const quarantine = load(
      "src/helpers/secureStore/legacyResumeQuarantine.ts",
      { ...mocks, "./chunkedValue": chunks },
    );
    const resume = load("src/helpers/asyncStorage/pingState.ts", {
      ...mocks,
      "../secureStore/chunkedValue": chunks,
      "../secureStore/legacyResumeQuarantine": quarantine,
    });
    return { chunks, quarantine, resume };
  }
  return {
    secure,
    plain,
    events,
    durableAnswers,
    sourceKey,
    indexKey,
    studyPrefix,
    scope,
    boot,
    setFault(value) {
      fault = value;
    },
    setUser(value) {
      user = value;
    },
    resumeKey(pingId = "p") {
      return `${local ? "WELLPING_LOCAL-" : ""}resume.v1.${hash(
        JSON.stringify([scope, user.username, user.loginDate, pingId]),
      )}`;
    },
  };
}
const snapshot = (map) => JSON.stringify([...map.entries()]);
async function manifestValidation() {
  const good = { id: crypto.randomUUID(), count: 1, digest: hash("saved") };
  const badVersions = [
    null,
    [],
    {},
    "x",
    1,
    true,
    { ...good, id: "-" },
    { ...good, id: good.id.replace(/-/g, "") },
    { ...good, id: good.id.toUpperCase() },
    { ...good, id: "11111111-1111-4111-1111-111111111111" },
    { ...good, count: 0 },
    { ...good, count: -1 },
    { ...good, count: 1.5 },
    { ...good, count: 100001 },
    { ...good, count: "1" },
    { ...good, count: null },
    { ...good, digest: "0".repeat(63) },
    { ...good, digest: "z".repeat(64) },
    { ...good, digest: 1 },
    { ...good, version: 1 },
    { id: good.id, count: 1 },
  ];
  const malformed = [
    "",
    " ",
    "{",
    "null",
    "[]",
    "{}",
    '""',
    '"text"',
    "false",
    "0",
    JSON.stringify({ version: 1, current: good }),
    JSON.stringify({ unexpected: good }),
    JSON.stringify({ current: good, pending: good }),
    ...badVersions.flatMap((value) => [
      JSON.stringify({ current: value }),
      JSON.stringify({ pending: value }),
    ]),
  ];
  for (const raw of malformed) {
    for (const operation of [
      "readChunkedValue",
      "writeChunkedValue",
      "clearChunkedValue",
    ]) {
      const f = fixture(),
        { chunks } = f.boot();
      f.secure.set("manifest", raw);
      f.secure.set(`manifest.${good.id}.0`, "saved");
      const before = snapshot(f.secure);
      await assert.rejects(
        chunks[operation]("manifest", "replacement"),
        chunks.SecureStorageIntegrityError,
      );
      assert.equal(
        snapshot(f.secure),
        before,
        `${operation} preserves malformed manifest and chunks`,
      );
      assert.equal(f.events.length, 0);
    }
  }
  const f = fixture(),
    { chunks } = f.boot();
  assert.equal(await chunks.readChunkedValue("missing"), null);
  f.secure.set("pending", JSON.stringify({ pending: good }));
  await assert.rejects(
    chunks.readChunkedValue("pending"),
    chunks.UncommittedChunkedValueError,
  );
  f.secure.set("corrupt", JSON.stringify({ current: good }));
  f.secure.set(`corrupt.${good.id}.0`, "wrong");
  for (const operation of [
    "readChunkedValue",
    "writeChunkedValue",
    "clearChunkedValue",
  ])
    await assert.rejects(
      chunks[operation]("corrupt", "replacement"),
      chunks.SecureStorageIntegrityError,
    );
  assert.equal(f.secure.get(`corrupt.${good.id}.0`), "wrong");
  console.log(
    "PASS: strict manifest rejection, null-only absence, pending-only recovery, corrupted committed preservation.",
  );
}
async function interruptedChunks() {
  const oldValue = JSON.stringify(state),
    newValue = "new🔐".repeat(700);
  for (const operation of ["write", "clear"]) {
    const baseline = fixture();
    let { chunks } = baseline.boot();
    await chunks.writeChunkedValue("test", oldValue);
    baseline.events.length = 0;
    await (operation === "write"
      ? chunks.writeChunkedValue("test", newValue)
      : chunks.clearChunkedValue("test"));
    const total = baseline.events.length;
    for (const phase of ["before", "after"]) {
      for (let step = 1; step <= total; step++) {
        const f = fixture();
        ({ chunks } = f.boot());
        await chunks.writeChunkedValue("test", oldValue);
        let count = 0;
        f.setFault(async (_event, currentPhase) => {
          if (currentPhase === phase && ++count === step)
            throw Error("simulated process interruption");
        });
        await assert.rejects(
          operation === "write"
            ? chunks.writeChunkedValue("test", newValue)
            : chunks.clearChunkedValue("test"),
        );
        f.setFault(null);
        ({ chunks } = f.boot());
        if (operation === "write") {
          const saved = await chunks.readChunkedValue("test");
          assert(
            [oldValue, newValue].includes(saved),
            "interrupted update retains a verified committed version",
          );
          await chunks.writeChunkedValue("test", newValue);
          assert.equal(await chunks.readChunkedValue("test"), newValue);
        }
        await chunks.clearChunkedValue("test");
        assert.equal(
          f.secure.size,
          0,
          "interrupted deletion is restartable, no stranded chunks",
        );
      }
    }
  }
  for (const operation of ["write", "clear"]) {
    const f = fixture();
    const { chunks } = f.boot();
    await chunks.writeChunkedValue("test", oldValue);
    const originalManifest = f.secure.get("test");
    let manifestWrites = 0;
    let stagedManifest;
    f.setFault(async (event, phase) => {
      if (
        phase !== "after" ||
        event.op !== "secure.set" ||
        event.key !== "test"
      )
        return;
      manifestWrites++;
      if (operation === "write" && manifestWrites === 1)
        stagedManifest = event.value;
      if (operation === "clear" || manifestWrites === 2)
        f.secure.set(
          "test",
          operation === "clear" ? originalManifest : stagedManifest,
        );
    });
    await assert.rejects(
      operation === "write"
        ? chunks.writeChunkedValue("test", newValue)
        : chunks.clearChunkedValue("test"),
    );
    assert.equal(
      await chunks.readChunkedValue("test"),
      oldValue,
      "unverified commit/tombstone cannot delete old committed data",
    );
    f.setFault(null);
    await chunks.clearChunkedValue("test");
    assert.equal(f.secure.size, 0);
  }
  const unconfirmedDelete = fixture();
  const deleteChunks = unconfirmedDelete.boot().chunks;
  await deleteChunks.writeChunkedValue("test", oldValue);
  let removedValue;
  unconfirmedDelete.setFault(async (event, phase) => {
    if (event.op !== "secure.delete") return;
    if (phase === "before")
      removedValue = unconfirmedDelete.secure.get(event.key);
    else unconfirmedDelete.secure.set(event.key, removedValue);
  });
  await assert.rejects(deleteChunks.clearChunkedValue("test"));
  assert(
    unconfirmedDelete.secure.has("test"),
    "cleanup keeps its durable manifest until deletion is verified",
  );
  unconfirmedDelete.setFault(null);
  await unconfirmedDelete.boot().chunks.clearChunkedValue("test");
  assert.equal(unconfirmedDelete.secure.size, 0);
  console.log(
    "PASS: before/after failures at every chunk update and deletion boundary, restart recovery, Unicode chunk sizes.",
  );
}
async function legacyQuarantine() {
  for (const local of [false, true]) {
    const rawValues = [
      "",
      " ",
      "{bad json",
      "null",
      "[]",
      "{}",
      "\u0000\ud800\udfff",
      JSON.stringify(state),
      '{ "malformed": "🔐' + "x".repeat(2000),
    ];
    for (const raw of rawValues) {
      const f = fixture({ local });
      f.plain.set(f.sourceKey, raw);
      let { resume, quarantine } = f.boot();
      await assert.rejects(
        resume.getPingStateAsync("p"),
        resume.LegacyResumeRecoveryError,
      );
      assert(!f.plain.has(f.sourceKey));
      const keys = await quarantine.listLegacyResumeQuarantineAsync();
      assert.equal(keys.length, 1);
      assert.equal(
        (await quarantine.readLegacyResumeQuarantineAsync(keys[0])).value,
        raw,
      );
      assert.equal(
        (await quarantine.readLegacyResumeQuarantineAsync(keys[0])).sourceKey,
        f.sourceKey,
      );
      assert(keys[0].startsWith(local ? "WELLPING_LOCAL-legacy" : "legacy"));
      assert.equal(
        f.plain.size,
        1,
        "only opaque durable recovery index remains in plaintext",
      );
      ({ resume, quarantine } = f.boot());
      f.setUser({ username: "different-participant", loginDate: 999999 });
      await assert.rejects(
        resume.getPingStateAsync("p"),
        resume.LegacyResumeRecoveryError,
      );
      await resume.clearAllPingStatesAsync();
      assert.equal(
        (await quarantine.readLegacyResumeQuarantineAsync(keys[0])).value,
        raw,
        "logout cleanup preserves unowned recovery records",
      );
    }
  }
  const raw =
    '{ "original": "' + "🔐".repeat(950) + '", "invalid": undefined }';
  const baseline = fixture();
  baseline.plain.set(baseline.sourceKey, raw);
  await baseline
    .boot()
    .quarantine.quarantineLegacyResumeAsync(baseline.sourceKey);
  for (const phase of ["before", "after"]) {
    for (let step = 1; step <= baseline.events.length; step++) {
      const f = fixture();
      f.plain.set(f.sourceKey, raw);
      let { quarantine } = f.boot(),
        count = 0;
      f.setFault(async (_event, currentPhase) => {
        if (currentPhase === phase && ++count === step)
          throw Error("simulated process interruption");
      });
      await assert.rejects(quarantine.quarantineLegacyResumeAsync(f.sourceKey));
      f.setFault(null);
      ({ quarantine } = f.boot());
      if (!f.plain.has(f.sourceKey)) {
        const keys = await quarantine.listLegacyResumeQuarantineAsync();
        assert.equal(keys.length, 1);
        assert.equal(
          (await quarantine.readLegacyResumeQuarantineAsync(keys[0])).value,
          raw,
          "no source removal before discoverable verified encrypted copy",
        );
      } else assert.equal(f.plain.get(f.sourceKey), raw);
      await quarantine.quarantineLegacyResumeAsync(f.sourceKey);
      assert(!f.plain.has(f.sourceKey));
      const keys = await quarantine.listLegacyResumeQuarantineAsync();
      assert.equal(
        keys.length,
        1,
        "restart retry reuses the deterministic recovery key",
      );
      assert.equal(
        (await quarantine.readLegacyResumeQuarantineAsync(keys[0])).value,
        raw,
      );
    }
  }
  for (const invalidIndex of [
    "",
    "null",
    "{}",
    "[1]",
    '["not-an-opaque-key"]',
  ]) {
    const f = fixture();
    f.plain.set(f.sourceKey, raw);
    f.plain.set(f.indexKey, invalidIndex);
    await assert.rejects(
      f.boot().quarantine.quarantineLegacyResumeAsync(f.sourceKey),
    );
    assert.equal(f.plain.get(f.sourceKey), raw);
    assert.equal(f.events.length, 0);
  }
  const f = fixture();
  f.plain.set(f.sourceKey, raw);
  // Simulate a non-durable index write: returning success is not enough.
  f.setFault(async (event, phase) => {
    if (
      phase === "after" &&
      event.op === "plain.set" &&
      event.key === f.indexKey
    )
      f.plain.delete(event.key);
  });
  await assert.rejects(
    f.boot().quarantine.quarantineLegacyResumeAsync(f.sourceKey),
  );
  assert.equal(f.plain.get(f.sourceKey), raw);
  assert.equal(f.secure.size, 0);
  f.setFault(null);
  // Source replacement during copying cannot be mistaken for the copied source.
  f.setFault(async (event, phase) => {
    if (
      phase === "after" &&
      event.op === "secure.set" &&
      event.key.endsWith(".0")
    )
      f.plain.set(f.sourceKey, "changed source");
  });
  await assert.rejects(
    f.boot().quarantine.quarantineLegacyResumeAsync(f.sourceKey),
  );
  assert.equal(f.plain.get(f.sourceKey), "changed source");
  f.setFault(null);
  const { quarantine } = f.boot();
  await quarantine.quarantineLegacyResumeAsync(f.sourceKey);
  const keys = await quarantine.listLegacyResumeQuarantineAsync();
  const recovered = await Promise.all(
    keys.map(
      async (key) =>
        (
          await quarantine.readLegacyResumeQuarantineAsync(key)
        ).value,
    ),
  );
  assert.deepEqual(
    recovered.sort(),
    [raw, "changed source"].sort(),
    "different source generations are preserved separately",
  );
  const damaged = fixture();
  damaged.plain.set(damaged.sourceKey, raw);
  const damagedRecovery = damaged.boot().quarantine;
  await damagedRecovery.quarantineLegacyResumeAsync(damaged.sourceKey);
  const damagedKey = (
    await damagedRecovery.listLegacyResumeQuarantineAsync()
  )[0];
  const damagedManifest = JSON.parse(damaged.secure.get(damagedKey));
  damaged.secure.set(
    `${damagedKey}.${damagedManifest.current.id}.0`,
    "corrupted bytes",
  );
  damaged.plain.set(damaged.sourceKey, raw);
  const preserved = snapshot(damaged.secure);
  await assert.rejects(
    damagedRecovery.quarantineLegacyResumeAsync(damaged.sourceKey),
  );
  assert.equal(
    damaged.plain.get(damaged.sourceKey),
    raw,
    "unverified encrypted copy never authorizes plaintext removal",
  );
  assert.equal(
    snapshot(damaged.secure),
    preserved,
    "damaged committed quarantine is not overwritten",
  );
  const loggedOut = fixture();
  loggedOut.plain.set(loggedOut.sourceKey, raw);
  const loggedOutRecovery = loggedOut.boot().quarantine;
  await loggedOutRecovery.quarantineLegacyResumeAsync(loggedOut.sourceKey);
  loggedOut.setUser(null);
  const loggedOutKeys =
    await loggedOutRecovery.listLegacyResumeQuarantineAsync();
  assert.equal(
    (await loggedOutRecovery.readLegacyResumeQuarantineAsync(loggedOutKeys[0]))
      .value,
    raw,
    "inventory remains readable with no active session",
  );
  console.log(
    "PASS: exact malformed/ambiguous legacy quarantine, global discovery after logout, local isolation, all interruption boundaries, index verification, changed-source preservation.",
  );
}
async function resumeBehavior() {
  const fenced = fixture();
  fenced.plain.set(
    fenced.sourceKey,
    "unowned legacy data must remain untouched",
  );
  const fencedResume = fenced.boot().resume;
  for (const operation of [
    () => fencedResume.getPingStateAsync("p", "old-owner"),
    () => fencedResume.storePingStateAsync("p", state, "old-owner"),
    () => fencedResume.clearPingStateAsync("p", "old-owner"),
  ]) {
    await assert.rejects(
      operation(),
      (error) => error.code === "OWNER_CHANGED",
    );
    assert.equal(
      fenced.events.length,
      0,
      "owner mismatch precedes resume/quarantine mutations",
    );
  }
  const f = fixture();
  let { resume, quarantine, chunks } = f.boot();
  await assert.rejects(
    resume.getPingStateAsync("p"),
    resume.MissingResumeStateError,
  );
  await Promise.all([
    resume.storePingStateAsync("p", { ...state, isInTransition: true }),
    resume.storePingStateAsync("p", state),
  ]);
  assert.equal(
    JSON.stringify(await resume.getPingStateAsync("p")),
    JSON.stringify(state),
  );
  const newer = {
    ...state.answers.q,
    questionId: "q.dynamic",
    data: { value: ["durable latest"] },
  };
  f.durableAnswers.set("q.dynamic", newer);
  assert.equal(
    (await resume.getPingStateAsync("p")).answers["q.dynamic"].data.value[0],
    "durable latest",
  );
  f.durableAnswers.clear();
  f.setUser({ username: "synthetic-b", loginDate: 20 });
  await assert.rejects(
    resume.getPingStateAsync("p"),
    resume.MissingResumeStateError,
  );
  f.setUser({ username: "synthetic-a", loginDate: 10 });
  f.plain.set(f.sourceKey, "unowned old plaintext");
  await resume.storePingStateAsync("p", state);
  const recoveryKeys = await quarantine.listLegacyResumeQuarantineAsync();
  assert.equal(recoveryKeys.length, 1);
  await resume.clearPingStateAsync("p");
  await assert.rejects(
    resume.getPingStateAsync("p"),
    resume.LegacyResumeRecoveryError,
  );
  await resume.clearAllPingStatesAsync();
  assert.equal(
    (await quarantine.readLegacyResumeQuarantineAsync(recoveryKeys[0])).value,
    "unowned old plaintext",
  );
  assert.equal(f.plain.size, 1);
  const missing = fixture();
  ({ resume, chunks } = missing.boot());
  await resume.storePingStateAsync("p", state);
  await chunks.clearChunkedValue(missing.resumeKey());
  await assert.rejects(
    resume.getPingStateAsync("p"),
    chunks.SecureStorageIntegrityError,
  );
  const malformed = fixture();
  malformed.plain.set(`${malformed.studyPrefix}secureResumeIndex.v1`, "{}");
  await assert.rejects(malformed.boot().resume.storePingStateAsync("p", state));
  assert.equal(malformed.secure.size, 0);
  const changed = fixture();
  const oldKey = changed.resumeKey();
  let releaseWrite;
  const blockedWrite = new Promise((resolve) => {
    releaseWrite = resolve;
  });
  let startedWrite;
  const writeStarted = new Promise((resolve) => {
    startedWrite = resolve;
  });
  let blockOnce = true;
  changed.setFault(async (event, phase) => {
    if (phase === "before" && event.op === "secure.set" && blockOnce) {
      blockOnce = false;
      startedWrite();
      await blockedWrite;
    }
  });
  const changedResume = changed.boot().resume;
  const first = changedResume.storePingStateAsync("p", state);
  const firstRejection = assert.rejects(first, /Owner changed/);
  await writeStarted;
  const queued = changedResume.storePingStateAsync("p", state);
  const queuedRejection = assert.rejects(queued, /Owner changed/);
  changed.setUser({ username: "new-owner", loginDate: 123 });
  const newKey = changed.resumeKey();
  releaseWrite();
  await Promise.all([firstRejection, queuedRejection]);
  assert(
    changed.secure.has(oldKey),
    "in-flight snapshot remains in its captured owner namespace",
  );
  assert(
    !changed.secure.has(newKey),
    "queued old-owner snapshot is never assigned to the new owner",
  );
  console.log(
    "PASS: typed absence versus legacy/damage, serialized writes, session isolation, durable-answer reconciliation, quarantine-safe overwrite/cleanup.",
  );
}
(async () => {
  await manifestValidation();
  await interruptedChunks();
  await legacyQuarantine();
  await resumeBehavior();
  let pending = ["p"],
    pings = [],
    deleted = 0,
    auth = 0,
    expired = false,
    failActivityRead = false,
    pendingClose = null;
  const owner = {
    id: "synthetic-owner",
    studyId: "synthetic-study",
    secureNamespace: "synthetic.",
  };
  class DataRecoveryError extends Error {
    constructor(code) {
      super(code);
      this.code = code;
    }
  }
  const users = load("src/helpers/users.ts", {
    "./dataJournal": {
      DataRecoveryError,
      async getVerifiedPendingLogoutAsync() {
        return pendingClose;
      },
      async closeDataSessionAsync() {
        if (failActivityRead) throw Error("activity unavailable");
        if (pending.length)
          throw new DataRecoveryError("PENDING_RESEARCH_DATA");
        if (pings.some((ping) => ping.endTime === null && !expired))
          throw new DataRecoveryError("ACTIVE_RESEARCH_DATA");
        pendingClose = owner;
        return owner;
      },
      async completeDataLogoutAsync(handle) {
        assert.equal(handle, owner);
        pendingClose = null;
      },
    },
    "./surveyAnswerWrites": { async waitForPendingSurveySavesAsync() {} },
    "@react-native-async-storage/async-storage": {
      default: {
        async removeItem() {
          deleted++;
        },
        async getItem() {
          return null;
        },
      },
    },
    "./asyncStorage/asyncStorageConfig": {
      ASYNC_STORAGE_WELLPING_PREFIX: "synthetic:",
    },
    "./asyncStorage/studyFile": {
      async clearCurrentStudyFileAsync() {
        deleted++;
      },
      async getCurrentStudyFileAsync() {
        return null;
      },
    },
    "expo-notifications": { async cancelAllScheduledNotificationsAsync() {} },
    "./beiwe": {},
    "./firebase": {
      firebaseInitialized() {
        return true;
      },
      async firebaseLogoutAndDeleteAppAsync() {
        auth++;
      },
    },
    "./secureStore/user": {
      async secureClearUserAsync(handle) {
        assert.equal(handle, owner);
        deleted++;
      },
    },
    "./server": {},
  });
  await assert.rejects(users.logoutAsync());
  assert.equal(deleted, 0);
  assert.equal(auth, 0);
  pending = [];
  pings = [{ id: "synthetic-ping", endTime: null }];
  await assert.rejects(users.logoutAsync());
  assert.equal(deleted, 0);
  assert.equal(auth, 0);
  failActivityRead = true;
  await assert.rejects(users.logoutAsync(), /activity unavailable/);
  assert.equal(
    deleted,
    0,
    "an unreadable activity guard cannot permit cleanup",
  );
  assert.equal(auth, 0);
  failActivityRead = false;
  pings = [{ id: "synthetic-ping", endTime: new Date() }];
  await users.logoutAsync();
  assert.equal(auth, 1);
  assert.equal(
    deleted,
    4,
    "logout keeps owner-isolated encrypted research records",
  );
  pings = [{ id: "synthetic-expired-ping", endTime: null }];
  expired = true;
  await users.logoutAsync();
  assert.equal(
    auth,
    2,
    "an expired archived ping does not trap the old session",
  );
  assert.equal(
    deleted,
    8,
    "logout removes scheduling/session/config only, not research records",
  );
  assert.equal(
    pings[0].endTime,
    null,
    "expiration never fabricates completion",
  );
  console.log(
    "PASS: fail-closed logout preserves pending/active records and activity errors; expired archived records remain incomplete.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
// Mount the actual component with dependency stubs to simulate a restart after
// the terminal snapshot was saved but before ping.endTime was durably written.
(async () => {
  let savedPing = { id: "terminal", endTime: null },
    completed = 0,
    endWrites = 0,
    endAttempts = 0,
    clears = 0,
    snapshotWrites = 0,
    retry;
  const ownerId = "synthetic-owner";
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const terminal = {
    ...state,
    currentQuestionData: { questionId: null, extraData: {} },
    answers: { q: { ...state.answers.q, pingId: "terminal" } },
  };
  let savedResume = clone(terminal);
  let failSnapshot = true,
    failEnd = true;
  const stubs = {
    "lodash/cloneDeepWith": { default: require("lodash/cloneDeepWith") },
    "lodash/cloneDeep": { default: clone },
    react: {
      default: {
        Component: class {
          constructor(props) {
            this.props = props;
          }
          setState(update, callback) {
            const next =
              typeof update === "function"
                ? update(this.state, this.props)
                : update;
            this.state = { ...this.state, ...next };
            if (callback) callback();
          }
        },
      },
    },
    "react-native": {
      StyleSheet: {
        create(value) {
          return value;
        },
      },
      Dimensions: {
        get() {
          return { height: 800, width: 400 };
        },
      },
      Alert: {
        alert(_title, _body, buttons) {
          retry = buttons[0].onPress;
        },
      },
    },
    "./helpers/dataJournal": {
      async getDataOwnerAsync() {
        return { id: ownerId };
      },
      async getJournalPingExpiryAsync(id, expectedOwnerId) {
        assert.equal(id, savedPing.id);
        assert.equal(expectedOwnerId, ownerId);
        return null;
      },
    },
    "./helpers/surveyAnswerWrites": {
      async waitForSurveyAnswerSavesAsync(expectedOwnerId, id) {
        assert.equal(expectedOwnerId, ownerId);
        assert.equal(id, savedPing.id);
        return false;
      },
    },
    "./helpers/asyncStorage/pingState": {
      async getPingStateAsync(id, expectedOwnerId) {
        assert.equal(id, savedPing.id);
        assert.equal(expectedOwnerId, ownerId);
        assert(
          savedResume,
          "startup rereads an actual surviving resume record",
        );
        return clone(savedResume);
      },
      async storePingStateAsync(id, value, expectedOwnerId) {
        assert.equal(id, savedPing.id);
        assert.equal(expectedOwnerId, ownerId);
        if (failSnapshot) throw Error("snapshot disk full");
        snapshotWrites++;
        savedResume = clone(value);
      },
      async clearPingStateAsync(id, expectedOwnerId) {
        assert.equal(id, savedPing.id);
        assert.equal(expectedOwnerId, ownerId);
        assert(
          savedPing.endTime,
          "terminal resume cannot be removed before durable completion",
        );
        clears++;
        savedResume = null;
      },
    },
    "./helpers/secureStore/ping": {
      async secureGetPingAsync(id, expectedOwnerId) {
        assert.equal(id, savedPing.id);
        assert.equal(expectedOwnerId, ownerId);
        return savedPing;
      },
    },
    "./helpers/pings": {
      async addEndTimeToPingAsync(id, date, expectedOwnerId) {
        assert.equal(id, savedPing.id);
        assert.equal(
          expectedOwnerId,
          ownerId,
          "completion remains bound to the mounting owner",
        );
        endAttempts++;
        if (failEnd) throw Error("completion disk full");
        endWrites++;
        savedPing = { ...savedPing, endTime: date };
        return savedPing;
      },
    },
  };
  const exports = {};
  const terminalExports = {};
  vm.runInNewContext(ts.transpileModule(
    fs.readFileSync(path.join(__dirname, "../../src/helpers/terminalCompletion.ts"), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
  ).outputText, { exports: terminalExports, require: () => ({}), Date });
  stubs["./helpers/terminalCompletion"] = terminalExports;
  const source = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, "../../src/SurveyScreen.tsx"), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        // VM mocks explicitly expose default exports; keep this contract across TS versions.
        esModuleInterop: false,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.React,
      },
    },
  ).outputText;
  vm.runInNewContext(source, {
    exports,
    require(key) {
      return stubs[key] || {};
    },
    Date,
    console,
  });
  async function waitUntil(predicate, description) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (predicate()) return;
      await new Promise(setImmediate);
    }
    assert.fail(`Timed out waiting for ${description}`);
  }
  const props = () => ({
    previousState: clone(terminal),
    ping: savedPing,
    questions: {},
    onFinish() {
      completed++;
    },
  });
  const screen = new exports.default(props());
  screen.componentDidMount();
  await waitUntil(() => typeof retry === "function", "initial snapshot retry");
  assert.equal(completed, 0);
  assert.equal(clears, 0);
  assert.equal(
    endAttempts,
    0,
    "completion is gated on verified initial snapshot readiness",
  );
  assert.equal(snapshotWrites, 0);
  failSnapshot = false;
  const retrySnapshot = retry;
  retry = undefined;
  retrySnapshot();
  await waitUntil(
    () => typeof retry === "function",
    "terminal completion retry",
  );
  assert.equal(snapshotWrites, 1);
  assert.equal(endAttempts, 1);
  assert.equal(completed, 0);
  assert.equal(clears, 0, "failed completion preserves terminal resume");
  assert(savedResume);
  failEnd = false;
  retry();
  await waitUntil(() => completed === 1, "terminal completion after retry");
  assert.equal(endWrites, 1);
  assert.equal(clears, 1);
  assert.equal(savedResume, null);
  await screen.finishTerminalResume();
  assert.equal(completed, 1, "completion is idempotent in mounted instance");
  assert.equal(clears, 1);
  screen.componentWillUnmount();
  const priorEnd = savedPing.endTime;
  // Independent crash checkpoint: endTime committed but terminal cleanup did not.
  savedResume = clone(terminal);
  const restarted = new exports.default(props());
  restarted.componentDidMount();
  await waitUntil(
    () => completed === 2,
    "remount with existing durable end time",
  );
  assert.equal(endWrites, 1, "existing end time must not be rewritten");
  assert.equal(endAttempts, 2, "remount skips completion mutation entirely");
  assert.equal(savedPing.endTime, priorEnd);
  assert.equal(snapshotWrites, 2);
  assert.equal(clears, 2);
  assert.equal(savedResume, null);
  restarted.componentWillUnmount();
  console.log(
    "PASS: initial snapshot readiness, owner-bound terminal remount recovery, failed completion retry, existing end-time preservation.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
