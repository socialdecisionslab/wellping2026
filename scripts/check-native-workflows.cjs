// Offline configuration regression: every exact-head smoke request needs a build.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const yaml = require("js-yaml");
const read = (name) =>
  yaml.safeLoad(fs.readFileSync(`.github/workflows/${name}.yml`, "utf8"));
const build = read("native-preview");
for (const name of ["android-smoke", "simulator-smoke"]) {
  const smoke = read(name);
  for (const branch of smoke.on.push.branches) {
    assert(
      build.on.push.branches.includes(branch),
      `${name}: build does not run for ${branch}`,
    );
  }
  for (const path of smoke.on.push.paths) {
    assert(
      build.on.push.paths.includes(path),
      `${name}: no exact-commit native build when only ${path} changes`,
    );
  }
  const steps = Object.values(smoke.jobs).flatMap((job) => job.steps);
  const download = steps.find((step) => step.run?.includes("gh run download"));
  assert(
    download?.run.includes(".head_sha == env.GITHUB_SHA"),
    `${name}: select exact commit`,
  );
  assert(
    download.run.includes('= "$GITHUB_SHA"'),
    `${name}: verify artifact commit`,
  );
  assert.equal(smoke.permissions.contents, "read");
  assert.equal(smoke.permissions.actions, "read");
}
console.log(
  "PASS: native build trigger coverage and exact-commit artifact checks.",
);
