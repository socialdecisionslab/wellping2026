import React from "react";
import { Text } from "react-native";
import { render, waitFor, fireEvent } from "@testing-library/react-native";
import RecoveryBoundary from "../components/RecoveryBoundary";
import {
  configureLocalDiagnostics,
  readLocalDiagnostics,
  recordLocalDiagnostic,
} from "../helpers/localDiagnostics";

afterEach(() => configureLocalDiagnostics(false));
test("diagnostics default off, allowlisted, bounded, memory-only and copied", () => {
  recordLocalDiagnostic("handled_operation_failed");
  expect(readLocalDiagnostics()).toEqual({
    enabled: false,
    counters: { handled_operation_failed: 0, render_failed: 0 },
  });
  configureLocalDiagnostics(true);
  for (let i = 0; i < 1200; i++)
    recordLocalDiagnostic("handled_operation_failed");
  recordLocalDiagnostic("SYNTHETIC_SECRET" as never);
  const snapshot = readLocalDiagnostics();
  expect(snapshot.counters.handled_operation_failed).toBe(999);
  snapshot.counters.handled_operation_failed = 0;
  expect(readLocalDiagnostics().counters.handled_operation_failed).toBe(999);
  expect(JSON.stringify(readLocalDiagnostics())).not.toContain(
    "SYNTHETIC_SECRET",
  );
  configureLocalDiagnostics(false);
  expect(readLocalDiagnostics().counters.handled_operation_failed).toBe(0);
});
test("render boundary shows non-destructive recovery without raw error content", async () => {
  configureLocalDiagnostics(true);
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});
  const Broken = (): React.ReactElement => {
    throw new Error("SYNTHETIC_SECRET_RESPONSE");
  };
  try {
    const screen = render(
      <RecoveryBoundary>
        <Broken />
      </RecoveryBoundary>,
    );
    expect(screen.getByText("Unable to display this screen")).toBeTruthy();
    expect(screen.getByText(/Do not uninstall/)).toBeTruthy();
    expect(JSON.stringify(screen.toJSON())).not.toContain(
      "SYNTHETIC_SECRET_RESPONSE",
    );
    expect(readLocalDiagnostics().counters.render_failed).toBe(1);
    await waitFor(() =>
      expect(screen.getByText(/Accepted response saves finished/)).toBeTruthy(),
    );
  } finally {
    spy.mockRestore();
  }
});
test("healthy children are not replaced", () => {
  const screen = render(
    <RecoveryBoundary>
      <Text>Healthy screen</Text>
    </RecoveryBoundary>,
  );
  expect(screen.getByText("Healthy screen")).toBeTruthy();
});

test("render failure retries detached accepted writes and withholds restart guidance until durable", async () => {
  const {
    enqueueSurveyAnswerSaveAsync,
  } = require("../helpers/surveyAnswerWrites");
  let fail = true;
  const write = jest.fn(async () => {
    if (fail) throw new Error("SYNTHETIC_SAVE_SECRET");
  });
  await enqueueSurveyAnswerSaveAsync(
    "synthetic-owner",
    "synthetic-ping",
    write,
  ).catch(() => {});
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});
  const Broken = (): React.ReactElement => {
    throw new Error("synthetic render");
  };
  try {
    const screen = render(
      <RecoveryBoundary>
        <Broken />
      </RecoveryBoundary>,
    );
    await waitFor(() =>
      expect(
        screen.getByText(/Some accepted responses could not be saved/),
      ).toBeTruthy(),
    );
    expect(screen.queryByText(/You may close and reopen/)).toBeNull();
    expect(write).toHaveBeenCalledTimes(2);
    fail = false;
    fireEvent.press(screen.getByText("Retry saving responses"));
    await waitFor(() =>
      expect(screen.getByText(/Accepted response saves finished/)).toBeTruthy(),
    );
    expect(write).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(screen.toJSON())).not.toContain(
      "SYNTHETIC_SAVE_SECRET",
    );
  } finally {
    spy.mockRestore();
  }
});
