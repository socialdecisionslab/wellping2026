import React from "react";
import { AppState, Button, Text, View } from "react-native";
import { getJournalSyncSummaryAsync } from "../helpers/dataJournal";

export default function SyncStatus({
  configured,
  uploading,
  failed,
  refreshToken,
  retry,
}: {
  configured: boolean;
  uploading: boolean;
  failed: boolean;
  refreshToken: string;
  retry: () => Promise<void>;
}) {
  const [summary, setSummary] = React.useState<{
    total: number;
    pending: number;
  } | null>(null);
  const [readFailed, setReadFailed] = React.useState(false);
  const [retryFailed, setRetryFailed] = React.useState(false);
  const [retrying, setRetrying] = React.useState(false);
  const [refresh, setRefresh] = React.useState(0);
  React.useEffect(() => {
    let current = true;
    setSummary(null);
    setReadFailed(false);
    getJournalSyncSummaryAsync().then(
      (value) => {
        if (current) setSummary(value);
      },
      () => {
        if (current) setReadFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, [refreshToken, refresh, uploading]);
  React.useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setRefresh((value) => value + 1);
    });
    return () => subscription.remove();
  }, []);
  const busy = uploading || retrying;
  let message: string;
  if (readFailed)
    message =
      "Sync status could not be checked. Keep this app and contact study staff if retry does not help.";
  else if (!summary) message = "Checking saved responses…";
  else if (!configured)
    message =
      "This study has no upload service. Saved responses stay on this device; contact study staff before removing the app.";
  else if (busy)
    message =
      "Uploading saved responses. They remain on this device if the connection is interrupted.";
  else if (summary.pending > 0)
    message = `${failed || retryFailed ? "Sync was not completed. " : ""}${
      summary.pending
    } survey record${
      summary.pending === 1 ? " is" : "s are"
    } saved on this device and waiting to upload. Retry with a connection. Do not uninstall the app.`;
  else if (summary.total > 0)
    message =
      "All currently saved survey records have an upload acknowledgement. This reflects previous uploads, not a fresh verification of the study server. Follow your study team’s instructions before removing the app.";
  else message = "No survey responses have been saved yet.";
  return (
    <View style={{ padding: 16 }}>
      <Text accessibilityRole="header">Saved responses and sync</Text>
      <Text accessibilityLiveRegion="polite">{message}</Text>
      {configured && (
        <Button
          title={busy ? "Syncing…" : "Retry sync"}
          disabled={busy}
          onPress={async () => {
            setRetrying(true);
            setRetryFailed(false);
            try {
              await retry();
            } catch (_) {
              setRetryFailed(true);
            } finally {
              setRetrying(false);
              setRefresh((value) => value + 1);
            }
          }}
        />
      )}
      {!configured && readFailed && (
        <Button
          title="Check saved responses"
          onPress={() => setRefresh((value) => value + 1)}
        />
      )}
    </View>
  );
}
