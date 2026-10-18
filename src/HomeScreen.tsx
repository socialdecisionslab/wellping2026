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
  ScrollView,
  Text,
  View,
} from "react-native";
import SyncStatus from "./components/SyncStatus";
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
import {
  DataUploadServerResponse,
  isUsingFirebase,
  isUsingBeiwe,
} from "./helpers/server";
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

  async checkIfPingHasExpiredAsync(generation = this.homeGeneration) {
    const previousNotificationTime = this.state.currentNotificationTime;

    const currentNotificationTime = await getCurrentNotificationTimeAsync();
    this.assertHomeGeneration(generation);
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
    this.assertHomeGeneration(generation);
    if (
      privateWindowExpired ||
      currentNotificationTimeNumber !== previousNotificationTimeNumber
    ) {
      if (this.state.currentPing && !this.state.currentPing.endTime) {
        await this.preserveExpiredSurveyAsync();
        this.assertHomeGeneration(generation);
      } else {
        this.setState({
          currentPing: null,
          storedPingStateAsync: null,
          resumeError: false,
        });
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
    const generation = this.homeGeneration;
    this.setState({ expirySavePending: true, expirySaveError: false });
    this.preservingExpired = Promise.resolve()
      .then(() => waitForPendingSurveySavesAsync())
      .then(() => {
        this.assertHomeGeneration(generation);
        if (this.expiryTransitionRequested) {
          this.setState({
            currentPing: null,
            storedPingStateAsync: null,
            resumeError: false,
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
        if (generation === this.homeGeneration)
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
      void this.refreshHomeAsync();
    }
    this.setState({ appState: nextAppState });
  };

  notificationResponseReceivedListener: ReturnType<
    typeof Notifications.addNotificationResponseReceivedListener
  > | null = null;
  notificationReceivedListener: ReturnType<
    typeof Notifications.addNotificationReceivedListener
  > | null = null;
  appStateSubscription: ReturnType<typeof AppState.addEventListener> | null =
    null;
  unregisterAuthObserver: FirebaseUnsubscribe | null = null;
  async restorePingAsync(ping: Ping, generation = this.homeGeneration) {
    const previousPing = this.state.currentPing;
    const isCurrent = () =>
      generation === this.homeGeneration &&
      this.state.currentPing === previousPing;
    let storedPingStateAsync: SurveyScreenState | null = null;
    let resumeError = false;
    try {
      storedPingStateAsync = ping.endTime
        ? null
        : await getPingStateAsync(ping.id);
    } catch (error) {
      if (!isCurrent()) return;
      resumeError = true;
      if (error instanceof MissingResumeStateError) {
        try {
          resumeError = (
            await getAnswersPingIdsQuestionIdsListAsync()
          ).some(([id]) => id === ping.id);
        } catch {
          resumeError = true;
        }
      }
    }
    if (!isCurrent()) return;
    if (previousPing === ping) {
      await this.checkIfPingHasExpiredAsync(generation);
      if (!isCurrent()) return;
    }
    if (!ping.endTime) {
      const active = await isJournalPingActiveAsync(ping.id);
      if (!isCurrent()) return;
      if (!active) {
        await this.preserveExpiredSurveyAsync();
        return;
      }
    }
    this.setState((current) =>
      generation === this.homeGeneration && current.currentPing === previousPing
        ? { currentPing: ping, storedPingStateAsync, resumeError }
        : null,
    );
  }

  homeGeneration = 0;
  homeMounted = false;
  homeWork: Promise<void> | null = null;
  refreshRequested = false;
  resumeRequested: Ping | null = null;

  retryResumeAsync() {
    if (!this.homeMounted || !this.state.currentPing) return Promise.resolve();
    this.resumeRequested = this.state.currentPing;
    return this.homeWork || this.runHomeAsync(false);
  }

  assertHomeGeneration(generation: number) {
    if (generation !== this.homeGeneration)
      throw new Error("Home operation is no longer current.");
  }

  refreshHomeAsync() {
    if (!this.homeMounted) return Promise.resolve();
    this.refreshRequested = true;
    return this.homeWork || this.runHomeAsync(false);
  }

  componentDidMount() {
    this.homeMounted = true;
    return this.startHomeAsync();
  }

  startHomeAsync() {
    if (!this.homeMounted) return Promise.resolve();
    this.homeGeneration++;
    this.resumeRequested = null;
    this.removeHomeSubscriptions();
    this.refreshRequested = true;
    this.setState({ startupError: false, isLoading: true });
    return this.runHomeAsync(true);
  }

  runHomeAsync(initialize: boolean) {
    const generation = this.homeGeneration;
    const previous = this.homeWork;
    const work = Promise.resolve(previous)
      .then(async () => {
        this.assertHomeGeneration(generation);
        if (initialize) {
          this.notificationResponseReceivedListener =
            Notifications.addNotificationResponseReceivedListener(() => {
              if (generation === this.homeGeneration)
                void this.refreshHomeAsync();
            });
          this.notificationReceivedListener =
            Notifications.addNotificationReceivedListener(() => {
              if (generation === this.homeGeneration)
                void this.refreshHomeAsync();
            });
          this.appStateSubscription = AppState.addEventListener(
            "change",
            (state) => {
              if (generation === this.homeGeneration)
                this._handleAppStateChange(state);
            },
          );
          await this.initializeHomeAsync(generation);
          this.assertHomeGeneration(generation);
        }
        while (this.refreshRequested || this.resumeRequested) {
          if (this.refreshRequested) {
            this.refreshRequested = false;
            await this.checkIfPingHasExpiredAsync(generation);
          } else {
            const ping = this.resumeRequested;
            this.resumeRequested = null;
            if (ping && this.state.currentPing === ping) {
              await this.restorePingAsync(ping, generation);
              this.assertHomeGeneration(generation);
              this.refreshRequested = true;
            }
          }
          this.assertHomeGeneration(generation);
        }
        if (initialize) {
          this.interval = setInterval(() => {
            if (generation === this.homeGeneration) void this.refreshHomeAsync();
          }, 30 * 1000);
          this.setState({ isLoading: false });
        }
      })
      .catch(() => {
        if (generation !== this.homeGeneration) return;
        this.homeGeneration++;
        this.refreshRequested = false;
        this.resumeRequested = null;
        this.removeHomeSubscriptions();
        this.setState({
          startupError: true,
          isLoading: false,
          expirySavePending: false,
          expirySaveError: false,
        });
      })
      .finally(() => {
        if (this.homeWork === work) {
          this.homeWork = null;
          if (
            generation === this.homeGeneration &&
            (this.refreshRequested || this.resumeRequested)
          )
            void this.runHomeAsync(false);
        }
      });
    this.homeWork = work;
    return work;
  }

  async initializeHomeAsync(generation: number) {
    const { studyInfo } = this.props;

    await this.preservingExpired;
    this.assertHomeGeneration(generation);
    await waitForPendingSurveySavesAsync();
    this.assertHomeGeneration(generation);
    this.expiryTransitionRequested = false;
    this.setState({ expirySavePending: false, expirySaveError: false });
    const latestPing = await getLatestPingAsync();
    this.assertHomeGeneration(generation);
    const allowsNotifications = await setupNotificationsPermissionAsync();
    this.assertHomeGeneration(generation);
    this.setState({ allowsNotifications });

    await setNotificationsAsync();
    this.assertHomeGeneration(generation);

    // Recover before presenting participant actions.
    const currentNotificationTime = await getCurrentNotificationTimeAsync();
    this.assertHomeGeneration(generation);
    this.setState({ currentNotificationTime });
    const latestPingActive =
      latestPing && !latestPing.endTime
        ? await isJournalPingActiveAsync(latestPing.id)
        : false;
    this.assertHomeGeneration(generation);
    if (
      latestPing &&
      currentNotificationTime &&
      latestPing.notificationTime.getTime() ===
        currentNotificationTime.getTime() &&
      (latestPing.endTime || latestPingActive)
    ) {
      this.assertHomeGeneration(generation);
      await this.restorePingAsync(latestPing, generation);
    } else if (latestPing && !latestPing.endTime) {
      if (latestPingActive)
        throw new Error("An unfinished survey window needs recovery.");
      this.setState({ expiredIncomplete: true });
    }
    this.assertHomeGeneration(generation);

    if (isUsingFirebase(studyInfo) && firebaseInitialized()) {
      this.unregisterAuthObserver = firebaseOnAuthStateChanged(
        getFirebaseAuth(),
        async (firebaseUser) => {
          if (generation !== this.homeGeneration) return;
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
            try {
              const localStoredUser = await secureGetUserAsync();
              if (generation !== this.homeGeneration) return;
              if (localStoredUser === null) {
                await alertWithShareButtonContainingDebugInfoAsync(
                  "Not logged in locally!",
                  "Error",
                );
                return;
              }

              await firebaseLoginAsync(localStoredUser);
              // If the login is successful, this `onAuthStateChanged` callback
              // will be called again, so we don't have to do anything here.
            } catch (e) {
              if (generation !== this.homeGeneration) return;
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
          if (generation !== this.homeGeneration) return;
          // Unsure when will this be called.
          await alertWithShareButtonContainingDebugInfoAsync(
            `onAuthStateChanged error: ${e}`,
          );
        },
      );
    }

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
    this.homeMounted = false;
    this.homeGeneration++;
    this.resumeRequested = null;
    this.refreshRequested = false;
    this.removeHomeSubscriptions();
  }

  removeHomeSubscriptions() {
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
    this.notificationReceivedListener?.remove();
    this.notificationReceivedListener = null;
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
        this.setUploadStatusSymbol("Retry sync");
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
              void this.startHomeAsync();
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
              void this.retryResumeAsync();
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
        {(!currentPing || currentPing.endTime) && (
          <SyncStatus
            configured={
              !!studyInfo.server &&
              (isUsingFirebase(studyInfo) || isUsingBeiwe(studyInfo))
            }
            uploading={
              this.state.afterFinishingPing_isUploading ||
              this.state.uploadStatusSymbol ===
                HOME_SCREEN_DEBUG_VIEW_SYMBOLS.UPLOAD.UPLOADING
            }
            failed={this.state.uploadStatusSymbol === "Retry sync"}
            refreshToken={`${currentPing?.id ?? ""}:${
              this.state.uploadStatusSymbol
            }`}
            retry={() => this.syncCompletedSurveyAsync()}
          />
        )}
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
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}
          >
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
                Please check the saved responses and sync status above. Keep the
                app installed until your study team confirms that it is safe to
                remove it. Contact them about records or payments.
              </Text>
            </View>
          </ScrollView>
        );
      }

      if (new Date() < getStudyStartDate(studyInfo)) {
        return (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}
          >
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
          </ScrollView>
        );
      }

      return (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}
        >
          {ExtraView}
          <Text style={styles.onlyTextStyle}>
            There is currently no active survey. Check your study schedule and
            follow your study team’s instructions for the next survey.
          </Text>
          <DashboardComponent
            firebaseUser={firebaseUser}
            studyInfo={studyInfo}
          />
        </ScrollView>
      );
    }

    if (currentPing == null) {
      return (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}
        >
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
        </ScrollView>
      );
    }

    if (currentPing.endTime) {
      return (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}
        >
          {ExtraView}
          <Text style={styles.onlyTextStyle}>
            Thank you for completing the survey for this ping!{"\n"}
            Your responses are saved on this device. You can close the app
            safely.
          </Text>
          <DashboardComponent
            firebaseUser={firebaseUser}
            studyInfo={studyInfo}
          />
        </ScrollView>
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
