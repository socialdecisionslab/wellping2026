const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync, execFileSync } = require("node:child_process");
const yaml = require("js-yaml");
const branches = [
  "main",
  "codex/modernize-mobile-runtime",
  "modernization/mobile-foundation-pr7",
  "modernization/participant-experience-pr8",
];
const reviewedSha = "${{ github.event.pull_request.head.sha || github.sha }}";
const gates = ["android", "ios-simulator", "android-smoke", "ios-smoke"];
const files = ["native-preview", "android-smoke", "simulator-smoke"];
const workflows = Object.fromEntries(files.map((name) => [
  name, yaml.safeLoad(fs.readFileSync(`.github/workflows/${name}.yml`, "utf8")),
]));
function validate(config) {
  const build = config["native-preview"];
  assert.deepEqual(Object.keys(build.on).sort(), ["pull_request", "push", "workflow_dispatch"]);
  for (const event of ["push", "pull_request"]) {
    assert.deepEqual([...build.on[event].branches].sort(), [...branches].sort());
    for (const filter of ["paths", "paths-ignore", "branches-ignore"])
      assert.equal(build.on[event][filter], undefined);
  }
  for (const event of ["opened", "synchronize", "reopened", "ready_for_review", "edited"])
    assert(build.on.pull_request.types.includes(event));
  assert.equal(build.env.REVIEWED_SHA, reviewedSha);
  assert.equal(build.env.WELLPING_LOCAL_ONLY, "1");
  assert.deepEqual(build.permissions, { contents: "read" });
  assert(build.concurrency.group.includes("github.event_name"));
  for (const name of ["android", "ios-simulator"]) {
    const job = build.jobs[name];
    assert.equal(job.if, undefined);
    const checkout = job.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
    assert.equal(checkout.with.ref, "${{ env.REVIEWED_SHA }}");
    assert.equal(checkout.with["persist-credentials"], false);
    assert(job.steps.some((step) => step.run === "bash scripts/native/build-identity.sh record ."));
    const upload = job.steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
    assert.equal(upload.with.name, name === "android" ? "Well-Ping-Local-Android" : "Well-Ping-Local-iOS-Simulator");
    assert.equal(upload.with["if-no-files-found"], "error");
    if (name === "android") {
      assert.equal(upload.with.path, "native-artifact/");
      assert(job.steps.some((step) => step.run?.includes("cp reviewed-sha.txt build-run-id.txt native-artifact/")));
      assert(job.steps.some((step) => step.run?.includes("native-artifact/app-release.apk")));
    } else {
      for (const marker of ["reviewed-sha.txt", "build-run-id.txt"])
        assert(upload.with.path.includes(marker));
    }
  }
  for (const [callerName, file, dependency, artifact] of [
    ["android-smoke", "android-smoke", "android", "Well-Ping-Local-Android"],
    ["ios-smoke", "simulator-smoke", "ios-simulator", "Well-Ping-Local-iOS-Simulator"],
  ]) {
    const caller = build.jobs[callerName];
    assert.equal(caller.needs, dependency);
    assert.equal(caller.uses, `./.github/workflows/${file}.yml`);
    assert.equal(caller.with["reviewed-sha"], reviewedSha);
    assert.equal(caller.if, undefined);
    assert.equal(caller.secrets, undefined);
    const smoke = config[file];
    assert.deepEqual(Object.keys(smoke.on), ["workflow_call"]);
    assert.deepEqual(smoke.on.workflow_call.inputs["reviewed-sha"], { required: true, type: "string" });
    assert.deepEqual(smoke.permissions, { contents: "read" });
    const job = Object.values(smoke.jobs)[0];
    assert.equal(job.env.REVIEWED_SHA, "${{ inputs.reviewed-sha }}");
    const checkout = job.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
    assert.equal(checkout.with.ref, "${{ inputs.reviewed-sha }}");
    assert.equal(checkout.with["persist-credentials"], false);
    const downloadIndex = job.steps.findIndex((step) => step.uses?.startsWith("actions/download-artifact@"));
    assert(downloadIndex >= 0);
    assert.deepEqual(job.steps[downloadIndex].with, { name: artifact, path: "preview" });
    const verifyIndex = job.steps.findIndex((step) => step.run === "bash scripts/native/build-identity.sh verify preview");
    assert(verifyIndex > downloadIndex);
    const launchIndex = job.steps.findIndex((step) =>
      step.uses?.startsWith("reactivecircus/") || step.run === "bash scripts/smoke-ios.sh");
    assert(launchIndex > verifyIndex);
    assert(!JSON.stringify(smoke).includes("gh run download"));
  }
  const aggregate = build.jobs["native-validation"];
  const androidSmoke = config["android-smoke"].jobs["launch-and-resume"];
  assert.equal(androidSmoke["runs-on"], "ubuntu-24.04");
  const accessIndex = androidSmoke.steps.findIndex((step) =>
    step.name === "Grant runner-only emulator acceleration access");
  const preflightIndex = androidSmoke.steps.findIndex((step) =>
    step.name === "Verify existing emulator acceleration access");
  assert(accessIndex > 2 && preflightIndex > accessIndex);
  assert.equal(androidSmoke.steps[accessIndex].run.trim(),
    'if test -c /dev/kvm; then\n  sudo setfacl -m "u:$(id -un):rw" /dev/kvm\nfi');
  assert(androidSmoke.steps[preflightIndex].run.includes('"category":"infrastructure"'));
  assert(androidSmoke.steps[preflightIndex].run.includes("exit 1"));
  assert.equal(aggregate.if, "always()");
  assert.deepEqual([...aggregate.needs].sort(), [...gates].sort());
  assert.equal(aggregate.steps[0].env.RESULTS, "${{ toJSON(needs) }}");
  for (const workflow of Object.values(config)) {
    for (const job of Object.values(workflow.jobs)) {
      assert.equal(job["continue-on-error"], undefined);
      for (const step of job.steps ?? [])
        assert.equal(step["continue-on-error"], undefined);
    }
  }
}
validate(workflows);
const mutations = [
  (config) => { config["android-smoke"].jobs["launch-and-resume"]["runs-on"] = "self-hosted"; },
  (config) => { config["android-smoke"].jobs["launch-and-resume"].steps.splice(3, 1); },
  (config) => { config["android-smoke"].jobs["launch-and-resume"].steps[3].run = "sudo chmod 666 /dev/kvm"; },
  (config) => { config["android-smoke"].jobs["launch-and-resume"].steps[4].run = "true"; },
  (config) => config["native-preview"].on.push.branches.pop(),
  (config) => config["native-preview"].on.pull_request.branches.shift(),
  (config) => { config["native-preview"].on.push.paths = ["src/**"]; },
  (config) => { config["native-preview"].on.pull_request["paths-ignore"] = ["docs/**"]; },
  (config) => { config["native-preview"].jobs.android.steps[0].with.ref = "main"; },
  (config) => { config["native-preview"].jobs["android-smoke"].needs = "ios-simulator"; },
  (config) => { config["native-preview"].jobs["native-validation"].if = "success()"; },
  (config) => { config["native-preview"].jobs["native-validation"].needs.pop(); },
  (config) => { config["android-smoke"].jobs["launch-and-resume"].steps[1].with["run-id"] = "old"; },
  (config) => { config["simulator-smoke"].jobs.launch.steps[2].run = "true"; },
  (config) => { config["native-preview"].jobs.android["continue-on-error"] = true; },
];
for (const mutate of mutations) {
  const changed = structuredClone(workflows);
  mutate(changed);
  assert.throws(() => validate(changed));
}
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wellping-ci-identity-"));
try {
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const env = { ...process.env, REVIEWED_SHA: sha, GITHUB_RUN_ID: "123456" };
  const identity = (mode, overrides = {}) => spawnSync("bash",
    ["scripts/native/build-identity.sh", mode, directory],
    { env: { ...env, ...overrides }, encoding: "utf8" });
  assert.equal(identity("record").status, 0);
  assert.equal(identity("verify").status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, "tested-build.json"), "utf8")),
    { headSha: sha, runId: "123456" });
  assert.notEqual(identity("verify", { REVIEWED_SHA: "0".repeat(40) }).status, 0);
  assert.notEqual(identity("verify", { REVIEWED_SHA: "main" }).status, 0);
  assert.notEqual(identity("verify", { GITHUB_RUN_ID: "123457" }).status, 0);
  fs.writeFileSync(path.join(directory, "reviewed-sha.txt"), "0".repeat(40));
  assert.notEqual(identity("verify").status, 0);
  assert.equal(identity("record").status, 0);
  fs.unlinkSync(path.join(directory, "build-run-id.txt"));
  assert.notEqual(identity("verify").status, 0);
  const aggregate = workflows["native-preview"].jobs["native-validation"].steps[0].run;
  const results = Object.fromEntries(gates.map((name) => [name, { result: "success" }]));
  const runGate = (value) => spawnSync("bash", ["-e", "-o", "pipefail", "-c", aggregate], {
    env: { ...env, RESULTS: JSON.stringify(value), GITHUB_STEP_SUMMARY: path.join(directory, "summary") },
    encoding: "utf8",
  });
  assert.equal(runGate(results).status, 0);
  for (const gate of gates) {
    for (const status of ["failure", "cancelled", "skipped", "timed_out"]) {
      const changed = structuredClone(results);
      changed[gate].result = status;
      assert.notEqual(runGate(changed).status, 0);
    }
  }
  assert.notEqual(runGate({}).status, 0);
  const kvm = workflows["android-smoke"].jobs["launch-and-resume"].steps.find(
    (step) => step.name === "Verify existing emulator acceleration access");
  assert(kvm.run.includes('"category":"infrastructure"'));
  assert(kvm.run.includes("exit 1"));
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
console.log(`PASS: trigger coverage, same-run artifacts, SHA/run rejection, ${mutations.length} configuration mutations and 17 aggregate failure cases.`);
