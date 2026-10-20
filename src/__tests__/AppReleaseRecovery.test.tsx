import React from "react";
import { render, waitFor } from "@testing-library/react-native";
import App from "../../App";

let mockRelease: unknown = null;
let mockRootFails = false;
jest.mock("../../config/release", () => ({
  get RELEASE() {
    return mockRelease;
  },
}));
jest.mock("../helpers/global", () => ({}));
jest.mock("expo-status-bar", () => ({ StatusBar: () => null }));
jest.mock("react-native-safe-area-context", () => {
  const { View } = require("react-native");
  return { SafeAreaProvider: View, SafeAreaView: View };
});
jest.mock("../RootScreen", () => {
  const React = require("react");
  const { Text } = require("react-native");
  return () => {
    if (mockRootFails) throw new Error("SYNTHETIC_RENDER_SECRET");
    return React.createElement(Text, null, "Study app");
  };
});

const originalDevelopmentMode = __DEV__;
beforeEach(() => {
  (global as any).__DEV__ = false;
  mockRelease = null;
  mockRootFails = false;
});
afterEach(() => {
  (global as any).__DEV__ = originalDevelopmentMode;
});

test("unconfigured production builds remain blocked after adding recovery", () => {
  const screen = render(<App />);
  expect(screen.getByText(/This build is not ready for enrollment/)).toBeTruthy();
  expect(screen.queryByText("Study app")).toBeNull();
});

test("configured production builds can enter the study app", () => {
  mockRelease = { protocol: "wellping-v1" };
  const screen = render(<App />);
  expect(screen.getByText("Study app")).toBeTruthy();
});

test("local development remains available without release configuration", () => {
  (global as any).__DEV__ = true;
  const screen = render(<App />);
  expect(screen.getByText("Study app")).toBeTruthy();
});

test("configured app render failures reach non-destructive recovery", async () => {
  mockRelease = { protocol: "wellping-v1" };
  mockRootFails = true;
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    const screen = render(<App />);
    expect(screen.getByText("Unable to display this screen")).toBeTruthy();
    expect(screen.getByText(/Do not uninstall/)).toBeTruthy();
    expect(JSON.stringify(screen.toJSON())).not.toContain("SYNTHETIC_RENDER_SECRET");
    await waitFor(() =>
      expect(screen.getByText(/Accepted response saves finished/)).toBeTruthy(),
    );
  } finally {
    spy.mockRestore();
  }
});
