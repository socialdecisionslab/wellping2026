import React from "react";
import { Button, Text, View } from "react-native";
import { recordLocalDiagnostic } from "../helpers/localDiagnostics";
import { waitForPendingSurveySavesAsync } from "../helpers/surveyAnswerWrites";

/** Contains render failures without displaying thrown content. Framework/native
 * error reporting is separate and is not disabled by this boundary.
 * Never clears storage, resets enrollment, or remounts an interrupted survey.
 */
export default class RecoveryBoundary extends React.Component<
  React.PropsWithChildren,
  { failed: boolean; saveState: "saving" | "failed" | "drained" }
> {
  state: { failed: boolean; saveState: "saving" | "failed" | "drained" } = {
    failed: false,
    saveState: "saving",
  };
  private active = true;
  private retrying = false;
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    recordLocalDiagnostic("render_failed");
    void this.drainAcceptedWrites();
  }
  componentDidMount() {
    this.active = true;
  }
  componentWillUnmount() {
    this.active = false;
  }
  private drainAcceptedWrites = async () => {
    if (this.retrying) return;
    this.retrying = true;
    if (this.active) this.setState({ saveState: "saving" });
    try {
      await waitForPendingSurveySavesAsync();
      if (this.active) this.setState({ saveState: "drained" });
    } catch (_) {
      if (this.active) this.setState({ saveState: "failed" });
    } finally {
      this.retrying = false;
    }
  };
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: "center" }}>
        <Text accessibilityRole="header">Unable to display this screen</Text>
        <Text>Do not uninstall the app or clear its data.</Text>
        <Text accessibilityLiveRegion="polite">
          {this.state.saveState === "saving"
            ? "Finishing accepted response saves. Keep the app open."
            : this.state.saveState === "failed"
            ? "Some accepted responses could not be saved. Keep the app open, retry saving, and contact the study staff if this continues."
            : "Accepted response saves finished. You may close and reopen the app. Check your latest response and survey position after reopening; screen recovery is not guaranteed. Contact the study staff if this continues."}
        </Text>
        {this.state.saveState === "failed" && (
          <Button
            title="Retry saving responses"
            onPress={this.drainAcceptedWrites}
          />
        )}
      </View>
    );
  }
}
