import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import SyncStatus from "../components/SyncStatus";
import { getJournalSyncSummaryAsync } from "../helpers/dataJournal";
jest.mock("../helpers/dataJournal", () => ({
  getJournalSyncSummaryAsync: jest.fn(),
}));
const read = getJournalSyncSummaryAsync as jest.Mock;
const props = {
  configured: true,
  uploading: false,
  failed: false,
  refreshToken: "initial",
  retry: jest.fn().mockResolvedValue(undefined),
};
beforeEach(() => {
  jest.clearAllMocks();
  read.mockResolvedValue({ total: 2, pending: 2 });
});
test("pending offline responses have visible retry and no removal permission", async () => {
  render(<SyncStatus {...props} />);
  expect(
    await screen.findByText(
      /2 survey records are saved on this device and waiting to upload/,
    ),
  ).toBeTruthy();
  expect(screen.getByText(/Do not uninstall/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Retry sync" })).toBeEnabled();
});
test("retry reads durable acknowledgement rather than assuming network success", async () => {
  render(<SyncStatus {...props} />);
  await screen.findByText(/waiting to upload/);
  fireEvent.press(screen.getByRole("button", { name: "Retry sync" }));
  await waitFor(() => expect(props.retry).toHaveBeenCalledTimes(1));
  expect(await screen.findByText(/waiting to upload/)).toBeTruthy();
  expect(screen.queryByText(/have an upload acknowledgement/)).toBeNull();
  read.mockResolvedValue({ total: 2, pending: 0 });
  fireEvent.press(screen.getByRole("button", { name: "Retry sync" }));
  expect(await screen.findByText(/have an upload acknowledgement/)).toBeTruthy();
});
test("failure, uploading and no-service states are distinct", async () => {
  const { rerender } = render(<SyncStatus {...props} failed />);
  await screen.findByText(/Sync was not completed/);
  rerender(<SyncStatus {...props} uploading />);
  await screen.findByText(/Uploading saved responses/);
  expect(screen.getByRole("button", { name: "Syncing…" })).toBeDisabled();
  rerender(<SyncStatus {...props} configured={false} />);
  await screen.findByText(/no upload service/);
  expect(screen.queryByRole("button", { name: "Retry sync" })).toBeNull();
});
test("status read failure is not mistaken for successful upload", async () => {
  read.mockRejectedValue(new Error("private synthetic detail"));
  render(<SyncStatus {...props} />);
  await screen.findByText(/could not be checked/);
  expect(screen.queryByText(/private synthetic detail/)).toBeNull();
  expect(screen.queryByText(/have an upload acknowledgement/)).toBeNull();
});
test("a stale summary cannot overwrite a newer revision refresh", async () => {
  let old: (value: { total: number; pending: number }) => void = () => {};
  read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        old = resolve;
      }),
  );
  const { rerender } = render(<SyncStatus {...props} />);
  rerender(<SyncStatus {...props} refreshToken="changed" />);
  await screen.findByText(/waiting to upload/);
  await act(async () => {
    old({ total: 2, pending: 0 });
  });
  expect(screen.queryByText(/have an upload acknowledgement/)).toBeNull();
});

test("a rejected retry stays pending with a helpful failure message", async () => {
  render(
    <SyncStatus
      {...props}
      retry={jest.fn().mockRejectedValue(new Error("private"))}
    />,
  );
  await screen.findByText(/waiting to upload/);
  fireEvent.press(screen.getByRole("button", { name: "Retry sync" }));
  await screen.findByText(/Sync was not completed/);
  expect(screen.getByRole("button", { name: "Retry sync" })).toBeEnabled();
  expect(screen.queryByText(/have an upload acknowledgement/)).toBeNull();
});
