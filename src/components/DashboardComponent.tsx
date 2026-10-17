import { StudyInfo } from "@wellping/study-schemas/lib/types";
import { setStatusBarStyle } from "expo-status-bar";
import { User as FirebaseUser } from "firebase/auth";
import React from "react";
import { Text, View } from "react-native";
import { WebView } from "react-native-webview";

import { getInstallationIDAsync } from "../helpers/debug";
import {
  assertSafeDashboardTemplate,
  isSameHttpsOrigin,
} from "../helpers/networkSafety";
import {
  getPingsAsync,
  getThisWeekPingsAsync,
  getTodayPingsAsync,
} from "../helpers/pings";
import { secureGetUserAsync } from "../helpers/secureStore/user";

const TIMEZONE_OFFSET_PLACEHOLDER = "__TIMEZONE_OFFSET__";
const INSTALLATION_ID_PLACEHOLDER = "__INSTALLATION_ID__";
const STUDY_ID_PLACEHOLDER = "__STUDY_ID__";
const STUDY_VERSION_PLACEHOLDER = "__STUDY_VERSION__";
const USERNAME_PLACEHOLDER = "__USERNAME__";
const PINGS_COMPLETED_OVERALL_PLACEHOLDER = "__PINGS_COMPLETED_OVERALL__";
const PINGS_COMPLETED_THIS_WEEK_PLACEHOLDER = "__PINGS_COMPLETED_THIS_WEEK__";
const PINGS_COMPLETED_TODAY_PLACEHOLDER = "__PINGS_COMPLETED_TODAY__";
export async function getDashboardUrlAsync(
  studyInfo: StudyInfo,
  firebaseUser: FirebaseUser | null,
): Promise<string | null> {
  if (studyInfo.dashboardURL === undefined) {
    return null;
  }

  let dashboardUrl = studyInfo.dashboardURL;
  assertSafeDashboardTemplate(dashboardUrl);

  if (dashboardUrl.includes(TIMEZONE_OFFSET_PLACEHOLDER)) {
    const timezoneOffset = new Date().getTimezoneOffset();
    dashboardUrl = dashboardUrl
      .split(TIMEZONE_OFFSET_PLACEHOLDER)
      .join(`${timezoneOffset}`);
  }

  if (dashboardUrl.includes(INSTALLATION_ID_PLACEHOLDER)) {
    dashboardUrl = dashboardUrl
      .split(INSTALLATION_ID_PLACEHOLDER)
      .join(encodeURIComponent(await getInstallationIDAsync()));
  }

  if (dashboardUrl.includes(STUDY_ID_PLACEHOLDER)) {
    dashboardUrl = dashboardUrl
      .split(STUDY_ID_PLACEHOLDER)
      .join(encodeURIComponent(studyInfo.id));
  }

  if (dashboardUrl.includes(STUDY_VERSION_PLACEHOLDER)) {
    dashboardUrl = dashboardUrl
      .split(STUDY_VERSION_PLACEHOLDER)
      .join(
        encodeURIComponent(studyInfo.version ?? "STUDY_VERSION_NOT_SPECIFIED"),
      );
  }

  if (dashboardUrl.includes(USERNAME_PLACEHOLDER)) {
    let username = "N/A";
    const user = await secureGetUserAsync();
    if (user) {
      username = user.username;
    }
    dashboardUrl = dashboardUrl
      .split(USERNAME_PLACEHOLDER)
      .join(encodeURIComponent(username));
  }

  if (dashboardUrl.includes(PINGS_COMPLETED_OVERALL_PLACEHOLDER)) {
    const numberOfPingsCompletedOverall = (await getPingsAsync()).length;
    dashboardUrl = dashboardUrl
      .split(PINGS_COMPLETED_OVERALL_PLACEHOLDER)
      .join(`${numberOfPingsCompletedOverall}`);
  }

  if (dashboardUrl.includes(PINGS_COMPLETED_THIS_WEEK_PLACEHOLDER)) {
    const numberOfPingsCompletedThisWeek = (await getThisWeekPingsAsync())
      .length;
    dashboardUrl = dashboardUrl
      .split(PINGS_COMPLETED_THIS_WEEK_PLACEHOLDER)
      .join(`${numberOfPingsCompletedThisWeek}`);
  }

  if (dashboardUrl.includes(PINGS_COMPLETED_TODAY_PLACEHOLDER)) {
    const numberOfPingsCompletedToday = (await getTodayPingsAsync()).length;
    dashboardUrl = dashboardUrl
      .split(PINGS_COMPLETED_TODAY_PLACEHOLDER)
      .join(`${numberOfPingsCompletedToday}`);
  }

  if (!isSameHttpsOrigin(dashboardUrl, studyInfo.dashboardURL)) {
    throw new Error("Dashboard configuration is invalid.");
  }
  return dashboardUrl;
}

interface DashboardComponentProps {
  studyInfo: StudyInfo;
  firebaseUser: FirebaseUser | null;
}
const DashboardComponent: React.FunctionComponent<DashboardComponentProps> = ({
  studyInfo,
  firebaseUser,
}) => {
  const [failed, setFailed] = React.useState(false);
  const [url, setUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
    let active = true;
    setUrl(null);
    setFailed(false);
    async function setDashboardUrlAsync() {
      try {
        const dashboardUrl = await getDashboardUrlAsync(
          studyInfo,
          firebaseUser,
        );
        if (active) setUrl(dashboardUrl);
      } catch {
        if (active) setFailed(true);
      }
    }
    setDashboardUrlAsync();
    return () => {
      active = false;
    };
  }, [studyInfo, firebaseUser]);

  if (studyInfo.dashboardURL === undefined) {
    return <></>;
  }

  return (
    <View style={{ flex: 1, marginTop: 20, marginHorizontal: 20 }}>
      {url ? (
        <WebView
          source={{ uri: url }}
          cacheEnabled={false}
          // Route every scheme through the callback; disallowed origins in the
          // WebView whitelist can otherwise be handed to the external OS browser.
          originWhitelist={["*"]}
          onShouldStartLoadWithRequest={(request) =>
            isSameHttpsOrigin(request.url, url)
          }
          mixedContentMode="never"
          allowFileAccess={false}
          setSupportMultipleWindows={false}
          style={{ width: "50%", height: 100 }}
          // TODO: Use `autoManageStatusBarEnabled` after https://github.com/react-native-community/react-native-webview/pull/914 is in Expo
          // https://github.com/react-native-community/react-native-webview/issues/735#issuecomment-629073261
          onNavigationStateChange={(navState) => {
            setStatusBarStyle("dark");
          }}
        />
      ) : (
        <Text style={{ textAlign: "center", fontSize: 16 }}>
          {failed
            ? "Dashboard unavailable. Contact the study team."
            : "Loading..."}
        </Text>
      )}
    </View>
  );
};

export default DashboardComponent;
