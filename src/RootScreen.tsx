import { StudyFile } from "@wellping/study-schemas/lib/types";
import React from "react";
import { Button, Text, View } from "react-native";

import HomeScreen from "./HomeScreen";
import { clearCurrentStudyFileAsync } from "./helpers/asyncStorage/studyFile";
import {
  storeTempStudyFileAsync,
  getTempStudyFileAsync,
  clearTempStudyFileAsync,
} from "./helpers/asyncStorage/tempStudyFile";
import {
  getCriticalProblemTextForUser,
  alertWithShareButtonContainingDebugInfoAsync,
  getNonCriticalProblemTextForUser,
} from "./helpers/debug";
import {
  isVerifiedPendingEnrollmentAsync,
  completePendingEnrollmentAsync,
} from "./helpers/failedEnrollment";
import { validateAndInitializeFirebaseWithConfig } from "./helpers/firebase";
import { secureGetUserAsync, User } from "./helpers/secureStore/user";
import { isUsingFirebase } from "./helpers/server";
import {
  getStudyFileAsync,
  downloadStudyFileAsync,
  parseAndStoreStudyFileAsync,
  studyFileExistsAsync,
} from "./helpers/studyFile";
import { logoutAsync } from "./helpers/users";
import LoadingScreen from "./screens/LoadingScreen";
import LoginScreen, {
  ParamDownloadAndParseStudyFileAsync,
} from "./screens/LoginScreen";
import StudyFileErrorScreen from "./screens/StudyFileErrorScreen";

interface RootScreenProps {}

interface RootScreenState {
  userInfo: User | null;
  isLoading: boolean;
  studyFileErrorText: string | null;
  survey?: StudyFile;
  recoveryError?: boolean;
  updateWarning?: boolean;
}

export default class RootScreen extends React.Component<
  RootScreenProps,
  RootScreenState
> {
  constructor(props: RootScreenProps) {
    super(props);

    this.state = {
      userInfo: null,
      isLoading: true,
      studyFileErrorText: null,
    };
  }

  async parseStudyFileAsync(rawJsonString: string): Promise<boolean> {
    const parseErrorMessage = await parseAndStoreStudyFileAsync(rawJsonString, {
      freshEnrollment: true,
    });
    if (parseErrorMessage !== null) {
      this.setState({
        isLoading: false,
        studyFileErrorText: parseErrorMessage,
      });
      return false;
    }
    return true;
  }

  /**
   * Returns `false` if the downloading or the parsing process is unsuccessful.
   * Returns `true` otherwise.
   *
   * Notice that if `isRedownload` is true, the function still returns `true`
   * in case of downloading failure (but not parsing failure).
   */
  async downloadAndParseStudyFileAsync({
    url,
    user,
    isRedownload,
    handleNetworkErrorAsync,
  }: ParamDownloadAndParseStudyFileAsync): Promise<boolean> {
    let rawJsonString: string;
    try {
      rawJsonString = await downloadStudyFileAsync({
        url,
        username: user.username,
        password: user.password,
      });
    } catch (e) {
      let downloadErrorMessage: string;
      if (e instanceof Error) {
        downloadErrorMessage = `**${e.name}**\n${e.message}`;
      } else {
        downloadErrorMessage =
          "Unable to load the study. Please check your connection or contact study staff.";
      }
      const errorMessage =
        `Failed to download study data! Possible network failure. ` +
        `Please try again later.\n\n${downloadErrorMessage}`;
      await handleNetworkErrorAsync(errorMessage);

      if (!isRedownload) {
        return false;
      } else {
        // If it is re-download, we act as if nothing happens because at least
        // the user can continue to fill the valid version they have right now.
        return true;
      }
    }

    if (isRedownload) {
      // Store it in temp storage first, parse it next time.
      await storeTempStudyFileAsync(rawJsonString);
      return true;
    }

    return this.parseStudyFileAsync(rawJsonString);
  }

  /**
   * Loads and parse the study file from the temp study file Async Storage.
   * Returns `true` if there is no error (or no temp study file).
   * Returns `false` otherwise.
   */
  async loadTempStudyFileAsync(): Promise<boolean> {
    const tempStudyFile = await getTempStudyFileAsync();
    if (tempStudyFile === null) {
      return true;
    }
    const error = await parseAndStoreStudyFileAsync(tempStudyFile);
    if (error === null) await clearTempStudyFileAsync();
    this.setState({ updateWarning: error !== null });
    // A rejected update must not prevent use of the last complete valid study.
    return true;
  }

  startup: Promise<void> | null = null;
  componentDidMount() {
    if (this.startup) return this.startup;
    this.startup = this.initializeAsync()
      .catch(() => {
        this.setState({ isLoading: false, recoveryError: true });
      })
      .finally(() => {
        this.startup = null;
      });
    return this.startup;
  }

  async initializeAsync() {
    if (await studyFileExistsAsync()) {
      const stored = await getStudyFileAsync();
      const savedUser = await secureGetUserAsync();
      if (!savedUser) {
        if (await isVerifiedPendingEnrollmentAsync(stored)) {
          this.setState({ userInfo: null, isLoading: false });
          return;
        }
        throw new Error("Saved session requires recovery.");
      }
      await completePendingEnrollmentAsync();
      if (!(await this.loadTempStudyFileAsync())) {
        return;
      }

      const survey = await getStudyFileAsync();

      if (isUsingFirebase(survey.studyInfo)) {
        try {
          validateAndInitializeFirebaseWithConfig(survey.studyInfo);
        } catch (_) {
          throw new Error("Study backend configuration requires recovery.");
        }
      }

      const user = await secureGetUserAsync();
      if (user === null) throw new Error("Saved session requires recovery.");

      // Do it in background because there isn't any urgency to redownload.
      void this.downloadAndParseStudyFileAsync({
        url: survey.studyInfo.studyFileURL,
        user,
        isRedownload: true,
        handleNetworkErrorAsync: async () => {
          // No need to handle network error.
          // Just do it next time.
        },
      }).catch(() => undefined);

      this.setState({ userInfo: user, survey });
    }

    this.setState({ isLoading: false });
  }

  async logoutFnAsync() {
    // Keep the active session visible if safe logout refuses pending data.
    await logoutAsync();
    this.setState({ userInfo: null, survey: undefined });
  }

  render() {
    const { isLoading, userInfo, studyFileErrorText } = this.state;
    if (this.state.recoveryError) {
      return (
        <View style={{ padding: 24 }}>
          <Text accessibilityRole="alert">
            Saved study data needs recovery. Nothing has been deleted. Retry or
            contact study staff; do not reinstall the app.
          </Text>
          <Button
            title="Retry recovery"
            onPress={() => {
              this.setState({ recoveryError: false, isLoading: true });
              void this.componentDidMount();
            }}
          />
        </View>
      );
    }
    if (isLoading) {
      return <LoadingScreen />;
    }

    if (studyFileErrorText) {
      return <StudyFileErrorScreen errorText={studyFileErrorText} />;
    }

    if (userInfo === null) {
      // The user hasn't logged in.
      return (
        <LoginScreen
          downloadAndParseStudyFileAsync={async (...parameter) => {
            return await this.downloadAndParseStudyFileAsync(...parameter);
          }}
          loggedInAsync={async (user) => {
            this.setState({
              userInfo: user,
              survey: await getStudyFileAsync(),
            });
          }}
        />
      );
    }

    if (this.state.survey == null) {
      return (
        <Text>
          {getCriticalProblemTextForUser("this.state.survey == null")}
        </Text>
      );
    }

    return (
      <>
        {this.state.updateWarning && (
          <Text accessibilityRole="alert">
            A study update could not be applied. Your saved study is still
            active; contact study staff.
          </Text>
        )}
        <HomeScreen
          studyInfo={this.state.survey.studyInfo}
          streams={this.state.survey.streams}
          logout={async () => {
            await this.logoutFnAsync();
          }}
        />
      </>
    );
  }
}
