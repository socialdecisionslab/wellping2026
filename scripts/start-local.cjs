require("./check-environment.cjs");
const { spawn } = require("child_process");
const path = require("path");

// Keep the CLI project-local and suppress account/telemetry/network checks.
const child = spawn(
  process.execPath,
  [
    require.resolve("expo/bin/cli"),
    "start",
    "--offline",
    "--localhost",
    ...process.argv.slice(2),
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      WELLPING_LOCAL_ONLY: "1",
      // Metro disables filesystem watchers in CI mode. This portable
      // runner needs no Watchman; restart it after editing source files.
      CI: "1",
      EXPO_OFFLINE: "1",
      EXPO_NO_TELEMETRY: "1",
      EXPO_NO_DOCTOR: "1",
      EXPO_NO_DEPENDENCY_VALIDATION: "1",
      EXPO_NO_INTERACTIVE: "1",
      EXPO_HOME: path.resolve(__dirname, "../.expo/local-cli"),
    },
  },
);
child.on("exit", (code) => process.exit(code === null ? 1 : code));
child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
