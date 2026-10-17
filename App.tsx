import "./src/helpers/global";

import { StatusBar } from "expo-status-bar";
import React from "react";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import RootScreen from "./src/RootScreen";

// TODO: USE https://github.com/carloscuesta/react-native-error-boundary
// once https://github.com/expo/expo/issues/6598 is solved.

export default function App() {
  return (
    <SafeAreaProvider>
    <SafeAreaView style={{ flex: 1 }}>
      <RootScreen />
      {/* eslint-disable-next-line react/style-prop-object */}
      <StatusBar style="dark" />
    </SafeAreaView>
    </SafeAreaProvider>
  );
}
