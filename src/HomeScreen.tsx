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
import {
  peekFuturePingIfAny,
  acknowledgeFuturePingAsync,
} from "./helpers/asyncStorage/futurePings";
import { getPingsListAsync } from "./helpers/asyncStorage/pingsList";
import {
  getPingStateAsync,
  MissingResumeStateError,
} from "./helpers/asyncStorage/pingState";
import { getUnuploadedPingsListAsync } from "./helpers/asyncStorage/unuploadedPingsList";
import { waitForPendingSurveySavesAsync } from "./helpers/surveyAnswerWrites";
import {
  isJournalPingActiveAsync,
  captureCurrentDataOwnerAsync,
  assertDataOwnerAsync,
} from "./helpers/dataJournal";
import { getNotificationTimesAsync } from "./helpers/asyncStorage/notificationTimes";
import { uploadDataAsync } from "./helpers/dataUpload";
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
  startupError?: boolean;
  expiredIncomplete?: boolean;
  expirySavePending?: boolean;
  expirySaveError?: boolean;
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
    const privateWindowExpired =
      this.state.currentPing &&
      !this.state.currentPing.endTime &&
      !(await isJournalPingActiveAsync(this.state.currentPing.id));
    if (
      privateWindowExpired ||
      currentNotificationTimeNumber !== previousNotificationTimeNumber
    ) {
      if (this.state.currentPing && !this.state.currentPing.endTime) {
        await this.preserveExpiredSurveyAsync();
      } else {
        this.setState({ currentPing: null });
      }
    }

    await clearSentNotificationsAsync();
  }

  preservingExpired: Promise<void> | null = null;
  expiryTransitionRequested = false;
  preserveExpiredSurveyAsync() {
    this.expiryTransitionRequested = true;
    return this.retryPendingSurveySavesAsync();
  }

  retryPendingSurveySavesAsync() {
    if (this.preservingExpired) return this.preservingExpired;
    this.preservingExpired = new Promise<void>((resolve) => {
      this.setState(
        { expirySavePending: true, expirySaveError: false },
        resolve,
      );
    })
      .then(() => waitForPendingSurveySavesAsync())
      .then(() => {
        if (this.expiryTransitionRequested) {
          this.setState({
            currentPing: null,
            expiredIncomplete: true,
            expirySavePending: false,
            expirySaveError: false,
          });
        } else {
          this.setState({ expirySavePending: false, expirySaveError: false });
        }
        this.expiryTransitionRequested = false;
      })
      .catch(() => {
        this.setState({ expirySavePending: false, expirySaveError: true });
      })
      .finally(() => {
        this.preservingExpired = null;
      });
    return this.preservingExpired;
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

  notificationResponseReceivedListener: ReturnType<
    typeof Notifications.addNotificationResponseReceivedListener
  > | null = null;
  appStateSubscription: ReturnType<typeof AppState.addEventListener> | null =
    null;
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
    } catch (error) {
      if (
        error instanceof MissingResumeStateError &&
        (await getAnswersPingIdsQuestionIdsListAsync()).every(
          ([id]) => id !== ping.id,
        )
      ) {
        this.setState({
          currentPing: ping,
          storedPingStateAsync: null,
          resumeError: false,
        });
        return;
      }
      this.setState({ currentPing: ping, resumeError: true });
    }
  }

  startup: Promise<void> | null = null;
  componentDidMount() {
    if (this.startup) return this.startup;
    this.startup = this.initializeHomeAsync()
      .catch(() => {
        this.componentWillUnmount();
        this.setState({ startupError: true, isLoading: false });
      })
      .finally(() => {
        this.startup = null;
      });
    return this.startup;
  }

  async initializeHomeAsync() {
    const { studyInfo } = this.props;

    const latestPing = await getLatestPingAsync();
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

    this.appStateSubscription = AppState.addEventListener(
      "change",
      this._handleAppStateChange,
    );

    // Recover before presenting participant actions.
    const currentNotificationTime = await getCurrentNotificationTimeAsync();
    if (
      latestPing &&
      currentNotificationTime &&
      latestPing.notificationTime.getTime() ===
        currentNotificationTime.getTime() &&
      (latestPing.endTime || (await isJournalPingActiveAsync(latestPing.id)))
    ) {
      await this.restorePingAsync(latestPing);
    } else if (latestPing && !latestPing.endTime) {
      if (await isJournalPingActiveAsync(latestPing.id))
        throw new Error("An unfinished survey window needs recovery.");
      this.setState({ expiredIncomplete: true });
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
    this.appStateSubscription = null;

    if (this.unregisterAuthObserver) {
      this.unregisterAuthObserver();
      this.unregisterAuthObserver = null;
    }

    if (this.notificationResponseReceivedListener) {
      this.notificationResponseReceivedListener.remove();
      this.notificationResponseReceivedListener = null;
    }
  }

  startingSurvey: Promise<void> | null = null;
  startSurveyAsync() {
    if (this.startingSurvey) return this.startingSurvey;
    this.startingSurvey = this.beginSurveyAsync()
      .catch(() => {
        this.setState({ startupError: true, isLoading: false });
      })
      .finally(() => {
        this.startingSurvey = null;
      });
    return this.startingSurvey;
  }

  async beginSurveyAsync() {
    const owner = await captureCurrentDataOwnerAsync();
    let followupOperationId: string | undefined;
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
        const futurePingIfAny = await peekFuturePingIfAny(owner.id);
        if (futurePingIfAny) {
          newStreamName = futurePingIfAny.streamName;
          followupOperationId = futurePingIfAny.operationId;
        }
      }
    }

    await this._startSurveyTypeAsync(
      newStreamName,
      followupOperationId,
      owner.id,
    );
    if (followupOperationId)
      await acknowledgeFuturePingAsync(followupOperationId, owner.id);
    await assertDataOwnerAsync(owner);

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
    try {
      await waitForPendingSurveySavesAsync();
    } catch (error) {
      this.setState({ expirySaveError: true });
      await doAfterErrorAsync(error);
      doFinally();
      return;
    }
    return uploadDataAsync(studyInfo, this.setUploadStatusSymbol, {
      unuploadedOnly: true,
    })
      .then(async (response) => {
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

  async _startSurveyTypeAsync(
    streamName: StreamName,
    operationId: string | undefined,
    expectedOwnerId: string,
  ) {
    // Starting an offline survey must not wait for an unrelated network request.
    void this._uploadUnuploadedDataAndRemoveFromThemIfSuccessfulAsync().catch(
      () => undefined,
    );

    // Create new ping.
    const { currentNotificationTime } = this.state;
    const schedule = await getNotificationTimesAsync();
    const expiresAt = schedule?.find(
      (item) => +item.notificationDate === +currentNotificationTime!,
    )?.expirationDate;
    if (!expiresAt || !Number.isFinite(+expiresAt))
      throw new Error("Current survey window needs recovery.");
    const newPing = await insertPingAsync({
      notificationTime: currentNotificationTime!,
      startTime: new Date(),
      streamName,
      operationId,
      expiresAt,
      expectedOwnerId,
    });

    // Insertion atomically marks this owner-bound ping dirty.

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

  async syncCompletedSurveyAsync() {
    this.setState({ afterFinishingPing_isUploading: true });
    await this._uploadUnuploadedDataAndRemoveFromThemIfSuccessfulAsync({
      doFinally: () => this.setState({ afterFinishingPing_isUploading: false }),
    });
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

    if (this.state.expirySavePending || this.state.expirySaveError) {
      return (
        <View style={{ padding: 24 }}>
          <Text accessibilityRole="alert">
            {this.state.expirySaveError
              ? "The last accepted answers could not be saved yet. Keep the app open and retry saving or contact study staff."
              : "Saving your last accepted answers; please keep the app open."}
          </Text>
          {this.state.expirySaveError && (
            <Button
              title="Retry saving"
              onPress={() => {
                void this.retryPendingSurveySavesAsync();
              }}
            />
          )}
        </View>
      );
    }
    if (this.state.startupError) {
      return (
        <View style={{ padding: 24 }}>
          <Text accessibilityRole="alert">
            Saved study data needs recovery. Nothing has been deleted. Retry or
            contact study staff.
          </Text>
          <Button
            title="Retry recovery"
            onPress={() => {
              this.setState({ startupError: false, isLoading: true });
              void this.componentDidMount();
            }}
          />
        </View>
      );
    }
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
        {this.state.expiredIncomplete && (
          <Text accessibilityRole="alert">
            An earlier survey window ended before completion. Its saved
            responses are preserved as incomplete and can still sync; new
            answers cannot be added after the window closes.
          </Text>
        )}
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
          <Text style={styles.onlyTextStyle}>
            Thank you for completing the survey for this ping!{"\n"}
            Your responses are saved on this device. You can close the app
            safely.
          </Text>
          <Text accessibilityLiveRegion="polite">
            {this.state.afterFinishingPing_isUploading
              ? "Sync is in progress. Saved responses remain available offline."
              : "Open the app with a connection to retry any pending sync."}
          </Text>
          <Button
            title="Retry sync"
            disabled={this.state.afterFinishingPing_isUploading}
            onPress={() => {
              void this.syncCompletedSurveyAsync();
            }}
          />
          <DashboardComponent
            firebaseUser={firebaseUser}
            studyInfo={studyInfo}
          />
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
            void this.syncCompletedSurveyAsync();
          }}
          studyInfo={studyInfo}
          setUploadStatusSymbol={this.setUploadStatusSymbol}
        />
      </View>
    );
  }
}
