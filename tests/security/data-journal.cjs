// Offline, synthetic storage only. No participant data or backend is accessed.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "../..");
const compiled = new Map();
const now = new Date("2026-10-17T10:00:00Z");
const plainCopy = (value) => JSON.parse(JSON.stringify(value));
function fixture(seed) {
  const secure = new Map(seed?.secure || []),
    plain = new Map(seed?.plain || []);
  let user = {
    username: "participant-a",
    password: "synthetic",
    loginDate: 100,
  };
  let installationId = "installation-1",
    studyId = "study-1",
    mutation = 0,
    failAt = 0,
    failAfter = true;
  const mutates = async (fn) => {
    mutation++;
    if (mutation === failAt && !failAfter)
      throw Error("synthetic process interruption");
    fn();
    if (mutation === failAt && failAfter)
      throw Error("synthetic process interruption");
  };
  let dropSet = null,
    dropDelete = null;
  const ss = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
    async getItemAsync(k) {
      assert.match(k, /^[A-Za-z0-9_.-]+$/);
      return secure.get(k) ?? null;
    },
    async setItemAsync(k, v) {
      if (dropSet?.(k, v)) return;
      assert.match(k, /^[A-Za-z0-9_.-]+$/);
      assert(
        Buffer.byteLength(v) <= 2048,
        "SecureStore records must remain below 2 KiB",
      );
      return mutates(() => secure.set(k, v));
    },
    async deleteItemAsync(k) {
      if (dropDelete?.(k)) return;
      return mutates(() => secure.delete(k));
    },
  };
  const as = {
    async getItem(k) {
      return plain.get(k) ?? null;
    },
    async getAllKeys() {
      return [...plain.keys()];
    },
    async setItem(k, v) {
      return mutates(() => plain.set(k, v));
    },
    async removeItem(k) {
      return mutates(() => plain.delete(k));
    },
  };
  const mocks = {
    "../../config/local": { IS_LOCAL_DEVELOPMENT: false },
    "./asyncStorage/studyFile": {
      async getCurrentStudyInfoAsync() {
        return studyId === "unavailable-config" ? null : { id: studyId };
      },
    },
    "./asyncStorage/asyncStorageConfig": {
      ASYNC_STORAGE_WELLPING_PREFIX: "@WELLPING:",
    },
    "expo-secure-store": ss,
    "@react-native-async-storage/async-storage": { default: as },
    "expo-crypto": {
      CryptoDigestAlgorithm: { SHA256: "sha256" },
      async digestStringAsync(_, value) {
        return crypto.createHash("sha256").update(value).digest("hex");
      },
    },
    "react-native-uuid": { default: { v4: crypto.randomUUID } },
    "./asyncStorage/asyncStorage": {
      async getASKeyAsync(k = "") {
        return `@WELLPING:Study_${studyId}/` + k;
      },
    },
    "./debug": {
      async getInstallationIDAsync() {
        return installationId;
      },
    },
    "./secureStore/secureStore": {
      async getSSKeyAsync(k = "") {
        return `WELLPING-${installationId}-Study_${studyId}.` + k;
      },
    },
    "./secureStore/user": {
      async secureGetUserAsync() {
        return user === null ? null : { ...user };
      },
    },
    "./studyFile": {
      async getStudyInfoAsync() {
        return { id: studyId };
      },
    },
  };
  let cache;
  function load(file) {
    const full = path.resolve(root, file);
    if (cache.has(full)) return cache.get(full);
    if (!compiled.has(full))
      compiled.set(
        full,
        ts.transpileModule(fs.readFileSync(full, "utf8"), {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            // VM mocks explicitly expose default exports; keep this contract across TS versions.
            esModuleInterop: false,
            target: ts.ScriptTarget.ES2020,
          },
        }).outputText,
      );
    const exports = {};
    cache.set(full, exports);
    vm.runInNewContext(
      compiled.get(full),
      {
        exports,
        Date,
        Promise,
        console,
        setTimeout,
        require(name) {
          if (name in mocks) return mocks[name];
          if (name.startsWith("@wellping/")) return require(name);
          if (name.startsWith("."))
            return load(
              path.relative(root, path.resolve(path.dirname(full), name)) +
                ".ts",
            );
          throw Error("Unexpected dependency " + name);
        },
      },
      { filename: full },
    );
    return exports;
  }
  const api = {
    secure,
    plain,
    dropSet(fn) {
      dropSet = fn;
    },
    dropDelete(fn) {
      dropDelete = fn;
    },
    restart() {
      cache = new Map();
      return load("src/helpers/dataJournal.ts");
    },
    chunk() {
      return load("src/helpers/secureStore/chunkedValue.ts");
    },
    fail(at, after = true) {
      mutation = 0;
      failAt = at;
      failAfter = after;
    },
    stopFailing() {
      failAt = 0;
    },
    mutationCount() {
      return mutation;
    },
    seed() {
      return { secure: [...secure], plain: [...plain] };
    },
    setUser(value) {
      user = value;
    },
    setInstallation(value) {
      installationId = value;
    },
    setStudy(value) {
      studyId = value;
    },
    load,
  };
  api.journal = api.restart();
  return api;
}
const insertion = (overrides = {}) => ({
  notificationTime: new Date(now.getTime() - 1000),
  startTime: new Date(now),
  streamName: "mood",
  ...overrides,
});
const answer = (pingId = "mood1", value = "first", q = "question") => ({
  pingId,
  questionId: q,
  data: { value: [value] },
  preferNotToAnswer: null,
  date: new Date(now),
});
async function snapshot(f) {
  return f.journal.captureDataSnapshotAsync();
}
async function expectRecovery(action, code) {
  await assert.rejects(
    action,
    (e) => e.name === "DataRecoveryError" && (!code || e.code === code),
  );
}
async function mutationMatrix(name, seed, operation, verify) {
  const normal = fixture(seed);
  normal.fail(0);
  await operation(normal.journal);
  const count = normal.mutationCount();
  assert(count > 0);
  for (const after of [false, true]) {
    for (let cut = 1; cut <= count; cut++) {
      const f = fixture(seed);
      f.fail(cut, after);
      await assert.rejects(
        operation(f.journal),
        undefined,
        `${name}: interruption ${after ? "after" : "before"} ${cut}`,
      );
      f.stopFailing();
      f.journal = f.restart();
      await verify(f);
      assert(
        ![...f.secure.keys()].some(
          (key) => key.endsWith(".head") || key.includes(".wal."),
        ),
        `${name}: successful recovery cleans WAL`,
      );
    }
  }
  console.log(`PASS: ${name}, ${count * 2} before/after mutation restarts`);
}
(async () => {
  await mutationMatrix(
    "initial owner and ping commit",
    undefined,
    (j) => j.insertJournalPingAsync(insertion({ operationId: "start-1" })),
    async (f) => {
      const result = await snapshot(f);
      assert(result.pings.length === 0 || result.pings.length === 1);
      const ping = await f.journal.insertJournalPingAsync(
        insertion({ operationId: "start-1" }),
      );
      assert.equal(ping.id, "mood1");
      assert.equal((await snapshot(f)).pings.length, 1);
    },
  );
  const base = fixture();
  await base.journal.insertJournalPingAsync(
    insertion({ operationId: "start-1" }),
  );
  const pingOnlySeed = base.seed();
  await base.journal.storeJournalAnswerAsync(answer());
  const seed = base.seed();
  const unicode = "🔒漢字🧪é".repeat(600);
  await mutationMatrix(
    "first large Unicode answer",
    pingOnlySeed,
    (j) => j.storeJournalAnswerAsync(answer("mood1", "🔐".repeat(1800))),
    async (f) => {
      const result = await snapshot(f);
      assert(result.answers.length === 0 || result.answers.length === 1);
      if (result.answers.length)
        assert.equal(result.answers[0].data.value[0], "🔐".repeat(1800));
    },
  );
  await mutationMatrix(
    "large Unicode answer replacement",
    seed,
    (j) => j.storeJournalAnswerAsync(answer("mood1", unicode)),
    async (f) => {
      const result = await snapshot(f);
      assert.equal(result.pings.length, 1);
      assert.equal(result.answers.length, 1);
      assert(["first", unicode].includes(result.answers[0].data.value[0]));
      assert.deepEqual(
        plainCopy(await f.journal.getJournalPingIdsAsync(true)),
        ["mood1"],
      );
      assert(
        ![...f.plain.values()].some(
          (v) => v.includes("🔒") || v.includes("first"),
        ),
        "plaintext storage contains no answers",
      );
    },
  );
  await mutationMatrix(
    "terminal completion",
    seed,
    (j) => j.completeJournalPingAsync("mood1", new Date(now.getTime() + 1000)),
    async (f) => {
      const ping = await f.journal.completeJournalPingAsync(
        "mood1",
        new Date(now.getTime() + 1000),
      );
      const prior = ping.endTime.getTime();
      const repeated = await f.journal.completeJournalPingAsync(
        "mood1",
        new Date(now.getTime() + 2000),
      );
      assert.equal(repeated.endTime.getTime(), prior);
    },
  );
  await mutationMatrix(
    "revision acknowledgement",
    seed,
    async (j) =>
      j.acknowledgeDataSnapshotAsync(await j.captureDataSnapshotAsync()),
    async (f) => {
      const result = await snapshot(f);
      assert.equal(result.answers[0].data.value[0], "first");
      await f.journal.acknowledgeDataSnapshotAsync(result);
      assert.equal((await f.journal.getJournalPingIdsAsync(true)).length, 0);
      const repeated = await f.journal.insertJournalPingAsync(
        insertion({
          operationId: "start-1",
          startTime: new Date(now.getTime() + 5000),
          notificationTime: new Date(now.getTime() + 3000),
        }),
      );
      assert.equal(repeated.id, "mood1", "ack retains insertion idempotency");
    },
  );
  await mutationMatrix(
    "explicit record removal",
    seed,
    (j) => j.removeJournalRecordsAsync({ allPings: true }),
    async (f) => {
      const result = await snapshot(f);
      assert(result.pings.length === 0 || result.pings.length === 1);
      assert.equal(result.answers.length, result.pings.length);
      await f.journal.removeJournalRecordsAsync({ allPings: true });
      assert.equal((await snapshot(f)).pings.length, 0);
    },
  );
  const concurrent = fixture(seed);
  const captured = await snapshot(concurrent);
  await Promise.all([
    concurrent.journal.storeJournalAnswerAsync(answer("mood1", "second", "q2")),
    concurrent.journal.storeJournalAnswerAsync(answer("mood1", "third", "q3")),
    concurrent.journal.acknowledgeDataSnapshotAsync(captured),
  ]);
  assert.equal((await snapshot(concurrent)).answers.length, 3);
  assert.equal(
    (await concurrent.journal.getJournalPingIdsAsync(true)).length,
    1,
    "old upload cannot clear newer answers",
  );
  assert.deepEqual(
    plainCopy(await concurrent.journal.getJournalSyncSummaryAsync()),
    { total: 1, pending: 1 },
    "participant status must report newer unsent revision",
  );
  const fresh = await snapshot(concurrent);
  await concurrent.journal.acknowledgeDataSnapshotAsync(fresh);
  assert.equal(
    (await concurrent.journal.getJournalPingIdsAsync(true)).length,
    0,
  );
  assert.deepEqual(
    plainCopy(await concurrent.journal.getJournalSyncSummaryAsync()),
    { total: 1, pending: 0 },
    "only durable acknowledgement clears pending status",
  );
  await concurrent.journal.storeJournalAnswerAsync(
    answer("mood1", "fourth", "q4"),
  );
  assert.equal(
    (await concurrent.journal.getJournalPingIdsAsync(true)).length,
    1,
    "new answer re-dirties acknowledged ping",
  );
  const many = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      concurrent.journal.insertJournalPingAsync(
        insertion({
          notificationTime: new Date(now.getTime() + i),
          streamName: "mood",
        }),
      ),
    ),
  );
  assert.equal(
    new Set(many.map((p) => p.id)).size,
    12,
    "concurrent index allocation cannot collide",
  );
  const streamPrefix = await concurrent.journal.insertJournalPingAsync(
    insertion({ streamName: "mood1" }),
  );
  assert(
    !many.some((p) => p.id === streamPrefix.id),
    "ambiguous stream-name prefixes must not collide",
  );
  const mutable = answer("mood1", "original", "immutable");
  const save = concurrent.journal.storeJournalAnswerAsync(mutable);
  mutable.data.value[0] = "changed";
  mutable.date.setTime(0);
  await save;
  assert.equal(
    (await concurrent.journal.getJournalAnswerAsync("mood1", "immutable")).data
      .value[0],
    "original",
  );
  const mutableStart = insertion({ streamName: "immutable" });
  const start = concurrent.journal.insertJournalPingAsync(mutableStart);
  mutableStart.startTime.setTime(0);
  mutableStart.notificationTime.setTime(0);
  const inserted = await start;
  assert.equal(inserted.startTime.getTime(), now.getTime());
  await concurrent.journal.storeJournalAnswerAsync(
    answer("mood1", "dynamic", "q[0]"),
  );
  assert.equal(
    (await concurrent.journal.getJournalAnswerAsync("mood1", "q[0]")).data
      .value[0],
    "dynamic",
  );
  const expectedOwner = (await snapshot(concurrent)).owner.id;
  assert(
    (await concurrent.journal.getResumeAnswersAsync("mood1", expectedOwner))
      .length >= 5,
  );
  await expectRecovery(
    () => concurrent.journal.getResumeAnswersAsync("mood1", "0".repeat(64)),
    "OWNER_CHANGED",
  );
  console.log(
    "PASS: competing updates/allocation, immutable arguments, dirty revisions, completion and insertion idempotency",
  );
  const isolated = fixture(seed);
  const original = await snapshot(isolated);
  isolated.setUser({
    username: "participant-b",
    password: "synthetic",
    loginDate: 200,
  });
  assert.equal((await snapshot(isolated)).pings.length, 0);
  await expectRecovery(
    () => isolated.journal.acknowledgeDataSnapshotAsync(original),
    "OWNER_CHANGED",
  );
  await isolated.journal.insertJournalPingAsync(insertion());
  isolated.setUser({
    username: "participant-a",
    password: "synthetic",
    loginDate: 100,
  });
  assert.equal((await snapshot(isolated)).answers[0].data.value[0], "first");
  isolated.setInstallation("installation-2");
  assert.equal((await snapshot(isolated)).pings.length, 0);
  isolated.setStudy("study-2");
  assert.equal((await snapshot(isolated)).pings.length, 0);
  console.log(
    "PASS: participant/session/study/installation isolation and archived-owner preservation",
  );
  const legacy = fixture();
  legacy.plain.set("@WELLPING:Study_study-1/pingsList", '["mood1"]');
  const legacyBefore = legacy.seed();
  await expectRecovery(() => snapshot(legacy), "LEGACY_OWNERSHIP_UNVERIFIED");
  assert.deepEqual(legacy.seed(), legacyBefore);
  const legacyBody = fixture();
  legacyBody.secure.set(
    "WELLPING-installation-1-Study_study-1.ping.mood1",
    "old-unowned-record",
  );
  await expectRecovery(
    () => legacyBody.journal.insertJournalPingAsync(insertion()),
    "LEGACY_OWNERSHIP_UNVERIFIED",
  );
  assert.equal(
    legacyBody.secure.get("WELLPING-installation-1-Study_study-1.ping.mood1"),
    "old-unowned-record",
  );
  const noOwner = fixture(seed);
  const ownerKey = [...noOwner.secure.keys()].find((k) => k.endsWith(".owner"));
  noOwner.secure.delete(ownerKey);
  const beforeMissingOwner = noOwner.seed();
  await expectRecovery(() => snapshot(noOwner), "MISSING_OWNER_MANIFEST");
  assert.deepEqual(noOwner.seed(), beforeMissingOwner);
  const absentBody = fixture(seed);
  const primary = [...absentBody.secure.keys()].find((k) =>
    /\.a\.[a-f0-9]{64}$/.test(k),
  );
  absentBody.secure.delete(primary);
  await expectRecovery(() => snapshot(absentBody), "MISSING_INDEXED_ANSWER");
  const orphan = fixture(seed);
  const owner = await orphan.journal.getDataOwnerAsync();
  const orphanKey = `${owner.secureNamespace}dataJournal.v1.${
    owner.id
  }.a.${crypto
    .createHash("sha256")
    .update(JSON.stringify(["mood1", "orphan"]))
    .digest("hex")}`;
  await orphan.chunk().writeChunkedValue(
    orphanKey,
    JSON.stringify({
      version: 1,
      ownerId: owner.id,
      kind: "answer",
      value: JSON.stringify(answer("mood1", "preserve me", "orphan")),
    }),
  );
  const orphanBefore = orphan.seed();
  await expectRecovery(
    () =>
      orphan.journal.storeJournalAnswerAsync(
        answer("mood1", "overwrite", "orphan"),
      ),
    "ORPHAN_ANSWER",
  );
  assert.deepEqual(orphan.seed(), orphanBefore);
  const corrupt = fixture(seed);
  const currentOwner = await corrupt.journal.getDataOwnerAsync();
  const headKey = `${currentOwner.secureNamespace}dataJournal.v1.${currentOwner.id}.head`;
  for (const raw of [
    "",
    "null",
    "[]",
    "{}",
    "{",
    JSON.stringify({ state: "ready", id: "../../outside" }),
  ]) {
    corrupt.secure.set(headKey, raw);
    const before = corrupt.seed();
    await expectRecovery(() => snapshot(corrupt));
    assert.deepEqual(corrupt.seed(), before);
  }
  console.log(
    "PASS: legacy fail-closed ownership, missing manifests/bodies, orphan and malformed WAL preservation",
  );
  for (const state of ["preparing", "ready", "applied"]) {
    for (const payload of ["null", "[]", "{}", '"not a transaction"']) {
      const malformed = fixture(seed);
      const owner = await malformed.journal.getDataOwnerAsync();
      const base = `${owner.secureNamespace}dataJournal.v1.${owner.id}`;
      const indexRaw = await malformed
        .chunk()
        .readChunkedValue(`${base}.index`);
      const index = JSON.parse(indexRaw);
      const id = crypto.randomUUID();
      const hash = (v) => crypto.createHash("sha256").update(v).digest("hex");
      const head = {
        version: 1,
        id,
        ownerId: owner.id,
        state,
        sequence: index.sequence + (state === "applied" ? 0 : 1),
        digest: hash(payload),
        indexDigest: hash(indexRaw),
      };
      await malformed.chunk().writeChunkedValue(`${base}.wal.${id}`, payload);
      malformed.secure.set(`${base}.head`, JSON.stringify(head));
      const before = malformed.seed();
      await expectRecovery(() => snapshot(malformed));
      assert.deepEqual(
        malformed.seed(),
        before,
        `malformed ${state} WAL preserved`,
      );
    }
  }
  // Find a crash after ready but before application, then interrupt every recovery mutation.
  let interrupted;
  for (let cut = 1; cut < 100 && !interrupted; cut++) {
    const f = fixture(seed);
    f.fail(cut);
    try {
      await f.journal.storeJournalAnswerAsync(
        answer("mood1", "replay-new", "replay"),
      );
    } catch {}
    const headRaw = [...f.secure.entries()].find(([k]) =>
      k.endsWith(".head"),
    )?.[1];
    if (headRaw && JSON.parse(headRaw).state === "ready")
      interrupted = f.seed();
  }
  assert(interrupted, "ready WAL fixture discovered");
  await mutationMatrix(
    "repeated recovery interruption",
    interrupted,
    (j) => j.recoverDataJournalAsync(),
    async (f) => {
      const result = await snapshot(f);
      assert.equal(
        result.answers.find((a) => a.questionId === "replay").data.value[0],
        "replay-new",
      );
      assert.equal(
        result.answers.find((a) => a.questionId === "question").data.value[0],
        "first",
      );
    },
  );
  const expiry = fixture();
  const expiryInput = insertion({
    operationId: "expiry-window",
    expiresAt: new Date(now.getTime() + 1000),
  });
  const expiring = await expiry.journal.insertJournalPingAsync(expiryInput);
  expiryInput.expiresAt.setTime(0);
  expiry.journal = expiry.restart();
  assert.equal(
    await expiry.journal.isJournalPingActiveAsync(
      expiring.id,
      new Date(now.getTime() + 1000),
    ),
    true,
  );
  assert.equal(
    await expiry.journal.isJournalPingActiveAsync(
      expiring.id,
      new Date(now.getTime() + 1001),
    ),
    false,
  );
  assert(
    !Object.keys((await snapshot(expiry)).pings[0]).includes("expiresAt"),
    "protocol expiry is private journal metadata, not an upload schema change",
  );
  const atBoundary = {
    ...answer(expiring.id, "accepted at boundary", "boundary"),
    date: new Date(now.getTime() + 1000),
  };
  await expiry.journal.storeJournalAnswerAsync(atBoundary);
  await expectRecovery(
    () =>
      expiry.journal.storeJournalAnswerAsync({
        ...atBoundary,
        data: { value: ["too late"] },
        date: new Date(now.getTime() + 1001),
      }),
    "PING_EXPIRED",
  );
  await expectRecovery(
    () =>
      expiry.journal.completeJournalPingAsync(
        expiring.id,
        new Date(now.getTime() + 1001),
      ),
    "PING_EXPIRED",
  );
  await expiry.journal.completeJournalPingAsync(
    expiring.id,
    new Date(now.getTime() + 1000),
  );
  assert.equal(
    (
      await expiry.journal.completeJournalPingAsync(
        expiring.id,
        new Date(now.getTime() + 2000),
      )
    ).endTime.getTime(),
    now.getTime() + 1000,
    "idempotent completion preserves original protocol time",
  );
  await expectRecovery(
    () =>
      expiry.journal.insertJournalPingAsync(
        insertion({
          streamName: "late",
          startTime: new Date(now.getTime() + 1001),
          expiresAt: new Date(now.getTime() + 1000),
        }),
      ),
    "PING_EXPIRED",
  );
  const unknown = await expiry.journal.insertJournalPingAsync(
    insertion({ streamName: "unknown" }),
  );
  assert.equal(
    await expiry.journal.isJournalPingActiveAsync(
      unknown.id,
      new Date(now.getTime() + 999999999),
    ),
    true,
    "unknown expiry fails closed",
  );
  const stale = fixture(seed);
  const oldOwner = (await snapshot(stale)).owner.id;
  stale.setUser({
    username: "participant-b",
    password: "synthetic",
    loginDate: 200,
  });
  const beforeOldInsertion = stale.seed();
  const beforeOldInsertionMutations = stale.mutationCount();
  await expectRecovery(
    () =>
      stale.journal.insertJournalPingAsync(
        insertion({ expectedOwnerId: oldOwner }),
      ),
    "OWNER_CHANGED",
  );
  assert.deepEqual(
    stale.seed(),
    beforeOldInsertion,
    "stale insertion preserves all previous records and creates no new owner archive",
  );
  assert.equal(
    stale.mutationCount(),
    beforeOldInsertionMutations,
    "expected owner is checked before any journal write",
  );
  await stale.journal.insertJournalPingAsync(insertion());
  const beforeStale = stale.seed();
  await expectRecovery(
    () =>
      stale.journal.storeJournalAnswerAsync(
        answer("mood1", "old UI data"),
        oldOwner,
      ),
    "OWNER_CHANGED",
  );
  await expectRecovery(
    () => stale.journal.completeJournalPingAsync("mood1", now, oldOwner),
    "OWNER_CHANGED",
  );
  assert.deepEqual(
    stale.seed(),
    beforeStale,
    "stale owner writes cannot adopt colliding IDs or mutate new owner data",
  );
  const race = fixture(seed);
  const switchOwner = race.journal.withDataJournalLockAsync(async () =>
    race.setUser({
      username: "participant-b",
      password: "synthetic",
      loginDate: 200,
    }),
  );
  const queuedOldAnswer = race.journal.storeJournalAnswerAsync(
    answer("mood1", "must not adopt"),
  );
  await switchOwner;
  await expectRecovery(() => queuedOldAnswer, "ANSWER_WITHOUT_PING");
  race.setUser({
    username: "participant-a",
    password: "synthetic",
    loginDate: 100,
  });
  assert.equal((await snapshot(race)).answers[0].data.value[0], "first");
  console.log(
    "PASS: malformed preparing/ready/applied payloads, repeated recovery crashes, bracket IDs and owner-fenced resume reads",
  );
  console.log(
    "PASS: durable protocol expiry, conservative unknown expiry and stale-owner insertion/answer/completion fences",
  );
  const closable = fixture(seed);
  await closable.journal.completeJournalPingAsync("mood1", now);
  await closable.journal.acknowledgeDataSnapshotAsync(await snapshot(closable));
  const closingSeed = closable.seed();
  await mutationMatrix(
    "durable session close and logout receipt",
    closingSeed,
    (j) => j.closeDataSessionAsync(),
    async (f) => {
      const handle = await f.journal.closeDataSessionAsync();
      assert.equal(await f.journal.isDataSessionClosedAsync(), true);
      await expectRecovery(
        () => f.journal.storeJournalAnswerAsync(answer("mood1", "too late")),
        "SESSION_CLOSED",
      );
      await expectRecovery(
        () => f.journal.completeJournalPingAsync("mood1", now),
        "SESSION_CLOSED",
      );
      assert.equal(
        (await f.journal.getVerifiedPendingLogoutAsync()).id,
        handle.id,
      );
      f.setUser(null);
      assert.equal(
        (await f.journal.getVerifiedPendingLogoutAsync()).id,
        handle.id,
        "receipt verifies without active user",
      );
      f.setStudy("unavailable-config");
      assert.equal(
        (await f.journal.getVerifiedPendingLogoutAsync()).id,
        handle.id,
        "receipt verifies without current study configuration",
      );
      await f.journal.completeDataLogoutAsync(handle);
      assert.equal(await f.journal.getVerifiedPendingLogoutAsync(), null);
    },
  );
  const pendingData = fixture(seed);
  await expectRecovery(
    () => pendingData.journal.closeDataSessionAsync(),
    "PENDING_RESEARCH_DATA",
  );
  await pendingData.journal.acknowledgeDataSnapshotAsync(
    await snapshot(pendingData),
  );
  await expectRecovery(
    () => pendingData.journal.closeDataSessionAsync(),
    "ACTIVE_RESEARCH_DATA",
  );
  const newLogin = fixture(closingSeed);
  await newLogin.journal.closeDataSessionAsync();
  await newLogin.journal.withDataJournalLockAsync(() =>
    newLogin.journal.clearPendingDataLogoutBeforeLoginInsideLockAsync(),
  );
  newLogin.setUser({ username: "new", password: "synthetic", loginDate: 500 });
  newLogin.setUser(null);
  assert.equal(
    await newLogin.journal.getVerifiedPendingLogoutAsync(),
    null,
    "lost new-user data cannot be classified as an old logout",
  );
  console.log(
    "PASS: close gate, no-user/no-config teardown receipt and new-login pointer clearing",
  );
  const noReady = fixture(seed);
  noReady.dropSet(
    (key, value) =>
      key.endsWith(".head") && JSON.parse(value).state === "ready",
  );
  await expectRecovery(
    () =>
      noReady.journal.storeJournalAnswerAsync(
        answer("mood1", "not yet durable", "no_ready"),
      ),
    "SECURE_WRITE_NOT_DURABLE",
  );
  noReady.dropSet(null);
  assert.equal(
    (await snapshot(noReady)).answers.length,
    1,
    "silent ready no-op never reports a saved answer",
  );
  const noPointer = fixture(closingSeed);
  noPointer.secure.set(
    "WELLPING-installation-1-Study_study-1.user",
    JSON.stringify({
      username: "participant-a",
      password: "synthetic",
      loginDate: 100,
    }),
  );
  noPointer.dropSet((key) => key.endsWith("dataJournal.v1.logout"));
  await expectRecovery(
    () => noPointer.journal.closeDataSessionAsync(),
    "SECURE_WRITE_NOT_DURABLE",
  );
  noPointer.dropSet(null);
  noPointer.journal = noPointer.restart();
  const recoveredClose =
    await noPointer.journal.getVerifiedPendingLogoutAsync();
  assert(
    recoveredClose,
    "startup replays closed-index-before-pointer WAL without bootstrapping",
  );
  noPointer.secure.delete("WELLPING-installation-1-Study_study-1.user");
  noPointer.setUser(null);
  noPointer.setStudy("unavailable-config");
  noPointer.dropDelete((key) => key.endsWith("dataJournal.v1.logout"));
  await expectRecovery(
    () => noPointer.journal.completeDataLogoutAsync(recoveredClose),
    "LOGOUT_POINTER_NOT_CLEARED",
  );
  noPointer.dropDelete(null);
  await noPointer.journal.completeDataLogoutAsync(recoveredClose);
  const malformedUser = fixture(closingSeed);
  await malformedUser.journal.closeDataSessionAsync();
  malformedUser.secure.set(
    "WELLPING-installation-1-Study_study-1.user",
    "null",
  );
  await expectRecovery(
    () => malformedUser.journal.getVerifiedPendingLogoutAsync(),
    "LOGOUT_OWNER_MISMATCH",
  );
  console.log(
    "PASS: silent ready/pointer no-ops detected, startup close-WAL replay, malformed user never treated as absent",
  );
  console.log("All data journal synthetic reliability checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
