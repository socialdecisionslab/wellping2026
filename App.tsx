import "./src/helpers/global";

import { StatusBar } from "expo-status-bar";
import React from "react";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import RecoveryBoundary from "./src/components/RecoveryBoundary";
import RootScreen from "./src/RootScreen";

export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1 }}>
        <RecoveryBoundary>
          <RootScreen />
        </RecoveryBoundary>
        <StatusBar style="dark" />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
