import React from "react";
import { Button, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import SurveyScreen from "../src/SurveyScreen";
import { openSyntheticSession } from "./session";

type Session = ReturnType<typeof openSyntheticSession> extends Promise<infer T>
  ? T
  : never;

export default function LocalApp() {
  const [session, setSession] = React.useState<Session | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const open = async (startAnother = false) => {
    setError(null);
    try {
      setSession(await openSyntheticSession(startAnother));
    } catch (e) {
      setError(String(e));
    }
  };
  React.useEffect(() => {
    open();
  }, []);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1 }}>
        <Text style={{ padding: 16, fontSize: 18 }}>
          Well Ping — synthetic local test
        </Text>
        <Text style={{ paddingHorizontal: 16 }}>
          No login, notifications, or uploads. Use test answers only.
        </Text>
        {error ? (
          <View>
            <Text accessibilityRole="alert">{error}</Text>
            <Button title="Retry" onPress={() => open()} />
          </View>
        ) : !session ? (
          <Text>Loading local test…</Text>
        ) : session.ping.endTime ? (
          <View style={{ padding: 16 }}>
            <Text>Saved on this test device. No data uploaded.</Text>
            <Button
              title="Start another test survey"
              onPress={() => open(true)}
            />
          </View>
        ) : (
          <SurveyScreen
            key={session.ping.id}
            studyInfo={session.study.studyInfo}
            questions={session.study.streams.synthetic}
            startingQuestionId={
              session.study.studyInfo.streamsStartingQuestionIds.synthetic
            }
            ping={session.ping}
            previousState={session.previousState}
            onFinish={(ping) => setSession({ ...session, ping })}
            setUploadStatusSymbol={() => {}}
          />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
