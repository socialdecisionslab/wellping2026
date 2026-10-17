import {
  Ping,
  StreamName,
  Streams,
  StudyInfo,
} from "@wellping/study-schemas/lib/types";
import { format, getDay } from "date-fns";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import {
  onAuthStateChanged as firebaseOnAuthStateChanged,
  Unsubscribe as FirebaseUnsubscribe,
  User as FirebaseUser,
} from "firebase/auth";
import React from "react";
import {
  Alert,
  AppState,
  AppStateStatus,
  Button,
  Text,
  View,
} from "react-native";
import DashboardComponent from "./components/DashboardComponent";
import { getAnswersPingIdsQuestionIdsListAsync } from "./helpers/asyncStorage/answersPingIdsQuestionIdsList";
import { dequeueFuturePingIfAny } from "./helpers/asyncStorage/futurePings";
import { getPingsListAsync } from "./helpers/asyncStorage/pingsList";
import { getPingStateAsync } from "./helpers/asyncStorage/pingState";
import {
  addToUnuploadedPingsListIfNeededAsync,
  getUnuploadedPingsListAsync,
  removeFromUnuploadedPingsListAsync,
} from "./helpers/asyncStorage/unuploadedPingsList";
import { getUnuploadedDataAsync, uploadDataAsync } from "./helpers/dataUpload";
import {
  alertWithShareButtonContainingDebugInfoAsync,
  getNonCriticalProblemTextForUser,
  HOME_SCREEN_DEBUG_VIEW_SYMBOLS,
} from "./helpers/debug";
import {
  firebaseInitialized,
  firebaseLoginAsync,
  getFirebaseAuth,
} from "./helpers/firebase";
import {
  clearSentNotificationsAsync,
  getCurrentNotificationTimeAsync,
  setNotificationsAsync,
  setupNotificationsPermissionAsync,
} from "./helpers/notifications";
import {
  getLatestPingAsync,
  getTodayPingsAsync,
  insertPingAsync,
} from "./helpers/pings";
import { secureGetUserAsync } from "./helpers/secureStore/user";
import { DataUploadServerResponse, isUsingFirebase } from "./helpers/server";
import { getStudyEndDate, getStudyStartDate } from "./helpers/studyFile";
import { styles } from "./helpers/styles";
import LoadingScreen from "./screens/LoadingScreen";
import SurveyScreen, { SurveyScreenState } from "./SurveyScreen";

interface HomeScreenProps {
  studyInfo: StudyInfo;
  streams: Streams;
  logout: () => Promise<void>;
}

interface HomeScreenState {
  appState: AppStateStatus;
  time: Date;
  allowsNotifications: boolean;
  currentNotificationTime: Date | null;
  currentPing: Ping | null;
  isLoading: boolean;
  storedPingStateAsync: SurveyScreenState | null;
  uploadStatusSymbol: string;

  /**
   * Only used for the upload process after a ping has been completed.
   */
  afterFinishingPing_isUploading: boolean;

  /**
   * For when Firebase server is used.
   *
   * If Firebase server is not used, it is always `null`.
   */
  firebaseUser: FirebaseUser | null;

  resumeError: boolean;
}

export default class HomeScreen extends React.Component<
  HomeScreenProps,
  HomeScreenState
> {
  interval!: ReturnType<typeof setInterval>;

  constructor(props: HomeScreenProps) {
    super(props);

    this.state = {
      appState: AppState.currentState,
      time: new Date(),
      allowsNotifications: true,
      currentNotificationTime: null,
      currentPing: null,
      isLoading: true,
      resumeError: false,
      storedPingStateAsync: null,
      uploadStatusSymbol: HOME_SCREEN_DEBUG_VIEW_SYMBOLS.UPLOAD.INITIAL,
      firebaseUser: null,
      afterFinishingPing_isUploading: false,
    };
  }

  async checkIfPingHasExpiredAsync() {
    const previousNotificationTime = this.state.currentNotificationTime;

    const currentNotificationTime = await getCurrentNotificationTimeAsync();
    this.setState({ time: new Date(), currentNotificationTime });

    // Because we cannot compare data directly, we have to compare the time with
    // `getTime`.
    // https://stackoverflow.com/a/7244571/2603230
    const previousNotificationTimeNumber =
      previousNotificationTime && previousNotificationTime.getTime();
    const currentNotificationTimeNumber =
      currentNotificationTime && currentNotificationTime.getTime();
    if (currentNotificationTimeNumber !== previousNotificationTimeNumber) {
      // It means that the previous ping has ended. We are either in between
      // two pings or in a new ping. So we can reset `currentPing` state.
      this.setState({ currentPing: null });
    }

    await clearSentNotificationsAsync();
  }

  _handleAppStateChange = (nextAppState: AppStateStatus) => {
    if (
      this.state.appState.match(/inactive|background/) &&
      nextAppState === "active"
    ) {
      // App has come to the foreground.
      this.checkIfPingHasExpiredAsync();
    }
    this.setState({ appState: nextAppState });
  };

  notificationResponseReceivedListener: ReturnType<typeof Notifications.addNotificationResponseReceivedListener> | null = null;
  appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
  unregisterAuthObserver: FirebaseUnsubscribe | null = null;
  async restorePingAsync(ping: Ping) {
    try {
      const storedPingStateAsync = ping.endTime
        ? null
        : await getPingStateAsync(ping.id);
      this.setState({
        storedPingStateAsync,
        currentPing: ping,
        resumeError: false,
      });
    } catch (_) {
      this.setState({ currentPing: ping, resumeError: true });
    }
  }

  async componentDidMount() {
    const { studyInfo } = this.props;

    const allowsNotifications = await setupNotificationsPermissionAsync();
    if (!allowsNotifications) {
      this.setState({ allowsNotifications: false });
    }

    await setNotificationsAsync();

    // Check if the current notification expires.
    this.interval = setInterval(async () => {
      await this.checkIfPingHasExpiredAsync();
    }, 30 * 1000);
    // Do this initially too.
    await this.checkIfPingHasExpiredAsync();

    this.notificationResponseReceivedListener =
      Notifications.addNotificationResponseReceivedListener(async () => {
        await this.checkIfPingHasExpiredAsync();
      });

    this.appStateSubscription = AppState.addEventListener("change", this._handleAppStateChange);

    const latestPing = await getLatestPingAsync();
    //console.warn(latestStartedPing);
    const currentNotificationTime = await getCurrentNotificationTimeAsync();
    if (
      latestPing &&
      currentNotificationTime &&
      latestPing.notificationTime.getTime() ===
        currentNotificationTime.getTime()
    ) {
      await this.restorePingAsync(latestPing);
    }

    if (isUsingFirebase(studyInfo) && firebaseInitialized()) {
      this.unregisterAuthObserver = firebaseOnAuthStateChanged(
        getFirebaseAuth(),
        async (firebaseUser) => {
          if (firebaseUser) {
            // The user is signed in to Firebase.
            // Notice that Firebase Authentication sessions are long lived,
            // meaning that the user is still signed in even if e.g. there is
            // no Internet.
            // As such, we can safely show alert in `else` branch.
            // See https://firebase.google.com/docs/auth/admin/manage-sessions.
            this.setState({ firebaseUser });
          } else {
            // The user is not signed in to Firebase.

            // We will try to log in the user again first.
            const localStoredUser = await secureGetUserAsync();
            if (localStoredUser === null) {
              await alertWithShareButtonContainingDebugInfoAsync(
                "Not logged in locally!",
                "Error",
              );
              return;
            }

            try {
              await firebaseLoginAsync(localStoredUser);
              // If the login is successful, this `onAuthStateChanged` callback
              // will be called again, so we don't have to do anything here.
            } catch (e) {
              await alertWithShareButtonContainingDebugInfoAsync(
                // I'm pretty sure Internet has nothing to do with this, but
                // we will still tell user to connect to the Internet just in
                // case.
                `Firebase login failed!\nNo data will be uploaded.\n\n` +
                  `Please make sure you are connected to the Internet and ` +
                  `then try restarting the app. If this error persists, ` +
                  `please contact the research staff.`,
                "Warning",
              );
            }
          }
        },
        async (e) => {
          // Unsure when will this be called.
          await alertWithShareButtonContainingDebugInfoAsync(
            `onAuthStateChanged error: ${e}`,
          );
        },
      );
    }

    this.setState({ isLoading: false });

    if (studyInfo.specialAlertOnLaunch) {
      Alert.alert(
        studyInfo.specialAlertOnLaunch.title,
        studyInfo.specialAlertOnLaunch.message,
        [
          {
            text: studyInfo.specialAlertOnLaunch.buttonText,
            style: "cancel",
          },
        ],
      );
    }
  }

  componentWillUnmount() {
    clearInterval(this.interval);

    this.appStateSubscription?.remove();

    if (this.unregisterAuthObserver) {
      this.unregisterAuthObserver();
    }

    if (this.notificationResponseReceivedListener) {
      this.notificationResponseReceivedListener.remove();
    }
  }

  async startSurveyAsync() {
    await new Promise<void>((resolve) =>
      this.setState({ isLoading: true }, resolve),
    );

    const studyInfo = this.props.studyInfo;

    const todayWeekday = getDay(new Date());
    const todayPings = await getTodayPingsAsync();

    const pingsList = await getPingsListAsync();
    const newPingNth = pingsList.length + 1;

    let newStreamName: StreamName;
    if (todayPings.length >= studyInfo.pingsFrequency.length) {
      await alertWithShareButtonContainingDebugInfoAsync(
        getNonCriticalProblemTextForUser(
          `todayPings.length (${todayPings.length}) >= ${studyInfo.pingsFrequency.length}`,
        ),
      );

      newStreamName = studyInfo.streamInCaseOfError;
    } else if (
      studyInfo.streamsForNthPings &&
      studyInfo.streamsForNthPings[`${newPingNth}`]
    ) {
      newStreamName = studyInfo.streamsForNthPings[`${newPingNth}`];
    } else {
      newStreamName = studyInfo.streamsOrder[todayWeekday][todayPings.length];

      if (
        !(studyInfo.streamsNotReplacedByFollowupStream || []).includes(
          newStreamName,
        )
      ) {
        const futurePingIfAny = await dequeueFuturePingIfAny();
        if (futurePingIfAny) {
          newStreamName = futurePingIfAny.streamName;
        }
      }
    }

    await this._startSurveyTypeAsync(newStreamName);

    // TODO: should this be after setNotificationsAsync?
    await new Promise<void>((resolve) =>
      this.setState({ isLoading: false }, resolve),
    );

    // So that the notification text ("n pings left") can be updated.
    await setNotificationsAsync();
  }

  async _uploadUnuploadedDataAndRemoveFromThemIfSuccessfulAsync({
    doAfterResponseAsync = async (_) => {},
    doAfterErrorAsync = async (_) => {},
    doFinally = () => {},
  }: {
    doAfterResponseAsync?: (
      response: DataUploadServerResponse,
    ) => Promise<void>;
    doAfterErrorAsync?: (error: any) => Promise<void>;
    doFinally?: () => void;
  } = {}) {
    const { studyInfo } = this.props;
    // We need to store `prevUnuploaded` beforehand because unuploaded pings list
    // might be changed during we are doing `uploadDataAsync`. And we don't want
    // to remove the newly added pings that we haven't uploaded.
    const prevUnuploaded = await getUnuploadedPingsListAsync();
    const prevData = await getUnuploadedDataAsync();
    uploadDataAsync(studyInfo, this.setUploadStatusSymbol, {
      unuploadedOnly: true,
      // We do this to avoid the data being modified before being uploaded.
      prefetchedData: prevData,
    })
      .then(async (response) => {
        // We have to use `.then` here because we don't want to block.
        await removeFromUnuploadedPingsListAsync(prevUnuploaded);
        await doAfterResponseAsync(response);
      })
      .catch(async (e) => {
        // There's some error in uploading.
        // Do nothing (keep the unuploaded pings list unmodified).

        await doAfterErrorAsync(e);
      })
      .finally(() => {
        doFinally();
      });
  }

  async _startSurveyTypeAsync(streamName: StreamName) {
    // Upload and clear old unuploaded pings.
    await this._uploadUnuploadedDataAndRemoveFromThemIfSuccessfulAsync();

    // Create new ping.
    const { currentNotificationTime } = this.state;
    const newPing = await insertPingAsync({
      notificationTime: currentNotificationTime!,
      startTime: new Date(),
      streamName,
    });

    // Add this ping to unuploaded pings list.
    await addToUnuploadedPingsListIfNeededAsync(newPing);

    this.setState({
      currentPing: newPing,
      storedPingStateAsync: null,
    });
  }

  setUploadStatusSymbol = (symbol: string) => {
    this.setState({ uploadStatusSymbol: symbol });
  };

  async _forceUploadAllDataAsync() {
    try {
      await uploadDataAsync(this.props.studyInfo, this.setUploadStatusSymbol, {
        unuploadedOnly: false,
      });
      Alert.alert("Data uploaded", "Your data was uploaded successfully.");
    } catch (_) {
      Alert.alert(
        "Upload failed",
        "Your data remains on this device. Please try again or contact study staff.",
      );
    }
  }

  render() {
    const { studyInfo, streams } = this.props;

    const {
      allowsNotifications,
      currentNotificationTime,
      currentPing,
      firebaseUser,
      isLoading,
    } = this.state;

    if (this.state.resumeError) {
      return (
        <View style={{ padding: 24 }}>
          <Text>
            Saved progress could not be recovered securely. Your data has not
            been deleted. Please retry or contact study staff.
          </Text>
          <Button
            title="Retry recovery"
            onPress={() => {
              if (this.state.currentPing)
                void this.restorePingAsync(this.state.currentPing);
            }}
          />
        </View>
      );
    }

    if (isLoading) {
      return <LoadingScreen />;
    }

    // Diagnostics and data-export controls are intentionally absent from the app.
    const ExtraView = (
      <View>
        {!allowsNotifications && (
          <Text>
            Please allow notifications if you would like study reminders.
          </Text>
        )}
        {studyInfo.contactEmail && (
          <Button
            title="Contact study staff"
            onPress={() => {
              void Linking.openURL(
                `mailto:${encodeURIComponent(studyInfo.contactEmail!)}`,
              );
            }}
          />
        )}
      </View>
    );

    // Display Study is no longer active?
    if (currentNotificationTime == null) {
      // We include `> endDate` and `< startDate` inside
      // `currentNotificationTime == null` so that the user can normally finish
      // their last ping even if it's after the end date.

      if (new Date() > getStudyEndDate(studyInfo)) {
        return (
          <View style={{ height: "100%" }}>
            {ExtraView}
            <View style={{ marginHorizontal: 20 }}>
              <Text style={styles.onlyTextStyle}>
                Thank you for your participation!
              </Text>
              <Text
                style={{
                  marginVertical: 10,
                  textAlign: "center",
                }}
              >
                The study has concluded on{"\n"}
                {format(getStudyEndDate(studyInfo), "PPPP")}.{"\n\n"}
                If you have any concerns regarding your ping records (or
                payments), please do not uninstall the app and press the button
                below to upload all your pings data stored locally. Otherwise,
                you may now uninstall Well Ping from your phone.
              </Text>
              <Button
                title="Upload Your Data"
                onPress={async () => {
                  Alert.alert(
                    "Upload All Data",
                    "During upload, your phone might be unresponsive for several minutes.\n\n" +
                      "Please do not exit the app until you see a message telling you that the upload is complete.",
                    [
                      {
                        text: "Upload All Data",
                        onPress: async () => {
                          await this._forceUploadAllDataAsync();
                        },
                      },
                      {
                        text: "Cancel",
                        style: "cancel",
                        onPress: async () => {
                          // Do nothing
                        },
                      },
                    ],
                  );
                }}
              />
            </View>
          </View>
        );
      }

      if (new Date() < getStudyStartDate(studyInfo)) {
        return (
          <View style={{ height: "100%" }}>
            {ExtraView}
            <Text style={styles.onlyTextStyle}>Welcome to Well Ping!</Text>
            <Text
              style={{
                marginTop: 10,
                marginHorizontal: 10,
                textAlign: "center",
              }}
            >
              You will receive your first ping on{"\n"}
              {format(getStudyStartDate(studyInfo), "PPPP")}.
            </Text>
          </View>
        );
      }

      return (
        <View style={{ height: "100%" }}>
          {ExtraView}
          <Text style={styles.onlyTextStyle}>
            There is currently no active survey. You will receive a notification
            with a survey soon!
          </Text>
          <DashboardComponent
            firebaseUser={firebaseUser}
            studyInfo={studyInfo}
          />
        </View>
      );
    }

    if (currentPing == null) {
      return (
        <View style={{ height: "100%" }}>
          {ExtraView}
          <Text
            style={{ fontSize: 30, marginVertical: 20, textAlign: "center" }}
          >
            Welcome to Well Ping!
          </Text>
          <View style={{ marginHorizontal: 20 }}>
            <Button
              title="Click here to start the survey"
              onPress={() => {
                this.startSurveyAsync();
              }}
            />
          </View>
          <DashboardComponent
            firebaseUser={firebaseUser}
            studyInfo={studyInfo}
          />
        </View>
      );
    }

    if (currentPing.endTime) {
      return (
        <View style={{ height: "100%" }}>
          {ExtraView}
          {this.state.afterFinishingPing_isUploading ? (
            <Text style={{ ...styles.onlyTextStyle, color: "red" }}>
              Uploading…{"\n"}Please do not exit the app!
            </Text>
          ) : (
            <>
              <Text style={styles.onlyTextStyle}>
                Thank you for completing the survey for this ping!{"\n"}
                Well Ping will send a notification for the next survey soon!
                {"\n"}
                Please close the app entirely.
              </Text>
              <DashboardComponent
                firebaseUser={firebaseUser}
                studyInfo={studyInfo}
              />
            </>
          )}
        </View>
      );
    }

    return (
      <View style={{ height: "100%" }}>
        {ExtraView}
        <SurveyScreen
          questions={streams[currentPing.streamName]}
          startingQuestionId={
            studyInfo.streamsStartingQuestionIds[currentPing.streamName]
          }
          ping={currentPing}
          previousState={this.state.storedPingStateAsync}
          onFinish={(finishedPing) => {
            this.setState({
              currentPing: finishedPing,
              afterFinishingPing_isUploading: true,
            });
            // TODO: Maybe also use NetInfo.fetch() before to make sure don't stuck on this page. But that's probably unnecessary.
            this._uploadUnuploadedDataAndRemoveFromThemIfSuccessfulAsync({
              doAfterResponseAsync: async (response) => {
                const showDataDiscrepancyAlert = ({
                  serverPingsCount,
                  localPingsCount,
                  serverAnswersCount,
                  localAnswersCount,
                }: {
                  serverPingsCount?: number;
                  localPingsCount?: number;
                  serverAnswersCount?: number;
                  localAnswersCount?: number;
                }) => {
                  const serverInfo =
                    `p${serverPingsCount ?? "n"}/` +
                    `a${serverAnswersCount ?? "n"}`;
                  const localInfo =
                    `p${localPingsCount ?? "n"}/` +
                    `a${localAnswersCount ?? "n"}`;

                  Alert.alert(
                    "Data Discrepancy Detected",
                    `The data on your phone locally (${localInfo}) does not match the data we have on the server (${serverInfo}). ` +
                      "To ensure your answers are recorded correctly, please click the “Upload All Data” button below.\n\n" +
                      "During upload, your phone might be unresponsive for several minutes. " +
                      "Please do not exit the app until you see a message telling you that the upload is complete.",
                    [
                      {
                        text: "Upload All Data",
                        onPress: async () => {
                          this.setState({
                            afterFinishingPing_isUploading: true,
                          });
                          await this._forceUploadAllDataAsync();
                          this.setState({
                            afterFinishingPing_isUploading: false,
                          });
                        },
                      },
                    ],
                  );
                };

                const serverPingsCount = response.new_pings_count;
                if (serverPingsCount != null) {
                  const localPingsCount = (await getPingsListAsync()).length;
                  if (serverPingsCount !== localPingsCount) {
                    showDataDiscrepancyAlert({
                      serverPingsCount,
                      localPingsCount,
                    });
                    return;
                  }
                }

                const serverAnswersCount = response.new_answers_count;
                if (serverAnswersCount != null) {
                  const localAnswersCount = (
                    await getAnswersPingIdsQuestionIdsListAsync()
                  ).length;
                  if (serverAnswersCount !== localAnswersCount) {
                    showDataDiscrepancyAlert({
                      serverPingsCount,
                      serverAnswersCount,
                      localAnswersCount,
                    });
                    return;
                  }
                }
              },
              doFinally: () => {
                this.setState({ afterFinishingPing_isUploading: false });
              },
            });
          }}
          studyInfo={studyInfo}
          setUploadStatusSymbol={this.setUploadStatusSymbol}
        />
      </View>
    );
  }
}
