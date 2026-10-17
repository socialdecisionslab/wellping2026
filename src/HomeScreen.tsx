import {
  Streams,
  StreamName,
  StudyInfo,
  Ping,
} from "@wellping/study-schemas/lib/types";
import { User } from "./helpers/secureStore/user";
import { format, getDay } from "date-fns";
import * as Linking from "expo-linking";
import { Subscription } from "expo-modules-core";
import * as Notifications from "expo-notifications";
import {
  onAuthStateChanged as firebaseOnAuthStateChanged,
  Unsubscribe as FirebaseUnsubscribe,
  User as FirebaseUser,
} from "firebase/auth";
import React from "react";
import {
  Button,
  Text,
  View,
  ScrollView,
  Alert,
  // Clipboard,
  TouchableWithoutFeedback,
  TouchableOpacity,
  AppState,
  AppStateStatus,
  Dimensions,
  Pressable,
  StyleSheet,
  FlatList,
  Platform,
  Image,
} from "react-native";
const { height, width } = Dimensions.get('screen')
import {
  Button as PaperButton,
  IconButton
} from 'react-native-paper'
import AsyncStorage from "@react-native-async-storage/async-storage";

import { studyFileExistsAsync } from "./helpers/studyFile";
import SurveyScreen, { SurveyScreenState } from "./SurveyScreen";
import DashboardComponent, {
  getDashboardUrlAsync,
} from "./components/DashboardComponent";
import HideKeyboardButtonAndWrapper from "./components/HideKeyboardButtonAndWrapper";
import { getAnswersPingIdsQuestionIdsListAsync } from "./helpers/asyncStorage/answersPingIdsQuestionIdsList";
import {
  dequeueFuturePingIfAny,
  getFuturePingsQueue,
  initFuturePingQueueAsync,
} from "./helpers/asyncStorage/futurePings";
import {
  getNotificationTimesAsync,
  clearNotificationTimesAsync,
} from "./helpers/asyncStorage/notificationTimes";
import {
  getPingStateAsync,
  clearPingStateAsync,
} from "./helpers/asyncStorage/pingState";
import { getPingsListAsync } from "./helpers/asyncStorage/pingsList";
import {
  addToUnuploadedPingsListIfNeededAsync,
  getUnuploadedPingsListAsync,
  removeFromUnuploadedPingsListAsync,
} from "./helpers/asyncStorage/unuploadedPingsList";
import { clearAllPingsAndAnswersAsync } from "./helpers/cleanup";
import {
  uploadDataAsync,
  getAllDataAsync,
  getUnuploadedDataAsync,
} from "./helpers/dataUpload";
import {
  getNonCriticalProblemTextForUser,
  JS_VERSION_NUMBER,
  getUsefulDebugInfoAsync,
  alertWithShareButtonContainingDebugInfoAsync,
  HOME_SCREEN_DEBUG_VIEW_SYMBOLS,
} from "./helpers/debug";
import {
firebaseLoginAsync,
  firebaseInitialized,
  getFirebaseAuth,
} from "./helpers/firebase";
import { getLoginSessionIDAsync } from "./helpers/loginSession";
import {
  setNotificationsAsync,
  setupNotificationsPermissionAsync,
  getCurrentNotificationTimeAsync,
  getIncomingNotificationTimeAsync,
  clearSentNotificationsAsync,
  _sendTestNotificationAsync,
} from "./helpers/notifications";
import {
  getLatestPingAsync,
  getTodayPingsAsync,
  insertPingAsync,
  getNumbersOfPingsForAllStreamNamesAsync,
} from "./helpers/pings";
import { secureGetUserAsync } from "./helpers/secureStore/user";
import {
  DataUploadServerResponse,
  getSymbolsForServerTypeUsed,
  isUsingFirebase,
} from "./helpers/server";
import {
  getAllStreamNames,
  getStudyStartDate,
  getStudyEndDate,
  getStudyInfoAsync,
} from "./helpers/studyFile";
import { styles } from "./helpers/styles";
import LoadingScreen from "./screens/LoadingScreen";
import { AntDesign, Feather } from '@expo/vector-icons';

type HomeScreenProps = {
  studyInfo: StudyInfo;
  streams: Streams;
  logout: () => Promise<void>;
  userInfo: User | null;
  navFn: () => void;
  showNavBar: boolean;
}

type HomeScreenState = {
  appState: AppStateStatus;
  time: Date;
  allowsNotifications: boolean;
  currentNotificationTime: Date | null;
  currentPing: Ping | null;
  isLoading: boolean;
  storedPingStateAsync: SurveyScreenState | null;
  uploadStatusSymbol: string;
  text: string | undefined;

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

type ItemData = {
  id: string;
  title: string;
  contactEmail: string | undefined;
  startDate: Date;
  endDate: Date;
};

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
      text: undefined,
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

  notificationResponseReceivedListener: Subscription | null = null;
  unregisterAuthObserver: FirebaseUnsubscribe | null = null;
  async restorePingAsync(ping: Ping) {
    try {
      const storedPingStateAsync = ping.endTime ? null : await getPingStateAsync(ping.id);
      this.setState({ storedPingStateAsync, currentPing: ping, resumeError: false });
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

    // Check if the current notification has expired.
    this.interval = setInterval(async () => {
      await this.checkIfPingHasExpiredAsync();
    }, 30 * 1000); 
    // Do this initially too.
    await this.checkIfPingHasExpiredAsync();

    this.notificationResponseReceivedListener =
      Notifications.addNotificationResponseReceivedListener(async () => {
        await this.checkIfPingHasExpiredAsync();
      });

    AppState.addEventListener("change", this._handleAppStateChange);

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

  async _forceUploadAllDataAsync({
    successTitle,
    getSuccessMessage = (response) => JSON.stringify(response),
    errorTitle,
    getErrorMessage = (error) => getNonCriticalProblemTextForUser(`${error}`),
  }: {
    successTitle: string;
    getSuccessMessage?: (response: DataUploadServerResponse) => string;
    errorTitle: string;
    getErrorMessage?: (error: any) => string;
  }) {
    const { studyInfo } = this.props;
    try {
      const response = await uploadDataAsync(
        studyInfo,
        this.setUploadStatusSymbol,
        { unuploadedOnly: false },
      );
      await alertWithShareButtonContainingDebugInfoAsync(
        getSuccessMessage(response),
        successTitle,
      );
    } catch (e) {
      await alertWithShareButtonContainingDebugInfoAsync(
        getErrorMessage(e),
        errorTitle,
      );
    }
  }

  render() {
    const { studyInfo, streams, logout } = this.props;

    const {
      allowsNotifications,
      currentNotificationTime,
      currentPing,
      firebaseUser,
      isLoading,
    } = this.state;

    const BellImage = () =>
      <View style={{height: 120, width: 120, backgroundColor: 'rgba(0,0,0,0.0)'}}>
        <Image source={require('../assets/icon-android-foreground.png')} style={{height: 120, width: 120, backgroundColor: 'transparent', transform: [{scale: 2.5}]}}/>
      </View>

    const shouldRemoveFutureNotifications = async () => {
      // Check if future pings should be disabled
      // This condition is met when the last 5 consecutive answers are "prefer not to answer"
      const data = await getAllDataAsync();
  
      // Get last up to last Five "preferNotToAnswer" values
      const answers = data.answers.slice(-5)
      // Round up all prefNotAnswer values into an array, 1 for true, 0 for false
      const responses = answers.map(e=>e.preferNotToAnswer? 1:0)
  
      // If all elements are 1 e.g. [1,1,1,1,1] and length more than 5, 
      // meaning the Participant repeatedly chose not to respond, disable all future pings 
      // so the Participant won't have to receive pings. They can choose to continue
      // answering survey questions without deleting their saved responses.
      if(responses.length>=5 && responses.every(e => e===1)) {

        await Notifications.cancelAllScheduledNotificationsAsync();
      }
      else {}
    }

    if (this.state.resumeError) {
      return <View style={{ padding: 24 }}>
        <Text>Saved progress could not be recovered securely. Your data has not been deleted. Please retry or contact study staff.</Text>
        <Button title="Retry recovery" onPress={() => {
          if (this.state.currentPing) void this.restorePingAsync(this.state.currentPing);
        }} />
      </View>;
    }

    if (isLoading) {
      return <LoadingScreen />;
    }

    // Diagnostics and data-export controls are intentionally absent from the app.
    const ExtraView = allowsNotifications ? null : (
      <Text>Please allow notifications if you would like study reminders.</Text>
    );

    // Display Study is no longer active?
    if (currentNotificationTime === null) {
      // We include `> endDate` and `< startDate` inside
      // `currentNotificationTime == null` so that the user can normally finish
      // their last ping even if it's after the end date.

      // Study has concluded screen
      if (new Date() > getStudyEndDate(studyInfo)) {
        return (
          <View style={{ height: "100%" }}>
            {/* {ExtraView} */}
            {/* <DebugView/> */}
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
                          await this._forceUploadAllDataAsync({
                            successTitle: "Data Uploaded Successfully!",
                            getSuccessMessage: (response) =>
                              "Thank you for your patience. " +
                              "Your local data has been successfully uploaded to the server.\n\n" +
                              `Response: ${JSON.stringify(response)}`,
                            errorTitle: "Error: Data Upload Error!",
                            getErrorMessage: (error) =>
                              "We cannot upload your data at this moment.\n\n" +
                              "Please try again later or contact the research staff.\n\n" +
                              `Error message: ${error}`,
                          });
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

      // Home screen current replaced with survey screen
      if (new Date() < getStudyStartDate(studyInfo)) {
        // When participant sees study before it begins
        return (
          <View style={{ height: "100%" }}>
            {ExtraView}

            <Text style={{
              textAlign: "center",
              marginTop: 30,
              fontSize: 25,
              marginHorizontal: 10,
              fontFamily: 'Roboto_700Bold',
              color: '#3a3a3a'
            }}
              numberOfLines={2}
              adjustsFontSizeToFit
              // maxFontSizeMultiplier={2}
            >Welcome to Well Ping!</Text>
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

      /* 
      *   Used to render Flatlist in HomeScreen when there is no Active Ping
      */
      const DATA: ItemData[] = [{
        id: studyInfo.id, 
        title: studyInfo.studyFileURL, 
        contactEmail: studyInfo.contactEmail,
        startDate: studyInfo.startDate,
        endDate: studyInfo.endDate
      }]
      /* 
      *   Survey information Card 
      */
      const renderItem = ({item}: {item: ItemData}) => {
        return <Pressable onPress={async ()=>{}} style={[_styles.shadow, {marginTop: 20, width: width*.9, height: height*.2, backgroundColor: '#fffae2', alignItems: 'flex-start', justifyContent: 'space-around', padding: 10, paddingHorizontal: 20, borderRadius: 12}]}>
          <View style={{paddingVertical: 10, width: '100%', height: 50, marginBottom: 10}}>
            <Text numberOfLines={1} adjustsFontSizeToFit style={{fontSize: 18, fontFamily: 'Roboto_700Bold', color: '#3a3a3a', width: '50%'}}>Study ID</Text>
            <Text adjustsFontSizeToFit style={{fontFamily: 'Roboto_400Regular', fontSize: 16, color: '#3a3a3a', width: '100%'}}>{item.id}</Text>
          </View>
 
          {/* <View>
          <Text style={{fontSize: 18, fontFamily: 'Roboto_700Bold', color: '#3a3a3a'}}>URL</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit style={{fontSize: 16, fontFamily: 'Roboto_400Regular', color: '#4a4a4a'}}>{item.title}</Text>
          <Text style={{fontSize: 18, fontFamily: 'Roboto_700Bold', color: '#3a3a3a'}}>E-mail</Text>
          <Text numberOfLines={1} style={{fontSize: 16, fontFamily: 'Roboto_400Regular', color: '#4a4a4a'}}>{item.contactEmail}</Text>
          </View> */}

          <View style={{width: '100%', height: 50, backgroundColor: 'transparent', flexDirection: 'row'}}>
            <View style={[_styles.center, {width: '50%', height: '100%', alignItems: 'flex-start', paddingVertical: 10}]}>
              <Text adjustsFontSizeToFit style={{fontSize: 18, fontFamily: 'Roboto_700Bold', color: '#3a3a3a', width: '70%'}}>Start date</Text>
              <Text adjustsFontSizeToFit style={{fontFamily: 'Roboto_400Regular', color: "#4a4a4a"}}>{item.startDate.toLocaleDateString()}</Text>
            </View>
            <View style={[_styles.center, {width: '50%', height: '100%', alignItems: 'flex-end', paddingVertical: 10}]}>
              <Text adjustsFontSizeToFit style={{fontSize: 18, fontFamily: 'Roboto_700Bold', color: '#3a3a3a'}}>End date</Text>
              <Text adjustsFontSizeToFit style={{fontFamily: 'Roboto_400Regular', color: "#4a4a4a"}}>{item.endDate.toLocaleDateString()}</Text>
            </View>
          </View>

        </Pressable>
      }

      // When participant see's but Ping is not active
      return (
        <View style={{height: '100%', backgroundColor: 'white'}}>
          {ExtraView} 
          {/* <DebugView /> */}
          <View style={{width: width, backgroundColor: 'white', alignItems: 'center', justifyContent: 'flex-start', paddingTop: 30, flexDirection: 'row'}}>
            <Text numberOfLines={1} adjustsFontSizeToFit style={{fontFamily: 'Roboto_700Bold', fontSize: 36,  width: '80%',  textAlign: 'left',  color: "#3a3a3a", paddingLeft: 20}}>
              Your survey
            </Text>
            {this.props.showNavBar
              ? <></>
              : <IconButton 
                  style={{width: '20%', alignItems: 'flex-end', paddingRight: 20}}
                  icon={()=><Feather name="settings" size={30} color="#3A3A3A" />}
                  onPress={this.props.navFn}/>}
          </View>

          <View style={{ width: '100%', height: height*.7, backgroundColor: 'white', alignItems: 'center'}}>
            {/* Survey Flatlist */}
            <FlatList
              contentContainerStyle={[_styles.center, {backgroundColor: 'white', width: width, height: height*.7, justifyContent: 'flex-start'}]}
              data={DATA}
              renderItem={renderItem}
              keyExtractor={item => item.id}
            />

            {/* Long Press to activate Debug View */}
          </View>

          {/* <DashboardComponent
            firebaseUser={firebaseUser}
            studyInfo={studyInfo}
          /> */}
        </View>
      );
    }

    // Display Survey Start flow
    if (currentPing === null) {
      const streamButtons = [];
      for (const streamName of getAllStreamNames(studyInfo)) {
        streamButtons.push(
          <Button
            color="orange"
            key={streamName}
            title={`Start "${streamName}" stream`}
            onPress={() => {
              this._startSurveyTypeAsync(streamName);
            }}
          />,
        );
      }

      return (
        <View style={[_styles.container, {justifyContent: 'center', backgroundColor: 'white'}]}>
          {/* Remove this back button when live */}
          {/* <Pressable onPress={()=>this.setState({ currentPing: null, currentNotificationTime: null })} style={{position: 'absolute', top: 20, backgroundColor: 'transparent', justifyContent: 'flex-start', alignItems: 'center', width: '100%', paddingLeft: 20, flexDirection: 'row'}}>
            <AntDesign name="arrowleft" size={30} color="green" />
            <Text adjustsFontSizeToFit>remove me</Text>
          </Pressable> */}

          <View style={{width: width, position: 'absolute', top: 0, alignItems: 'center'}}>
            {/* {ExtraView} */}
          </View>
          {/* <DebugView>{streamButtons}</DebugView> */}

          <View style={{height: height*.5, width: '100%', backgroundColor: 'transparent', justifyContent: 'space-around', alignItems: 'center'}}>
            <View style={{height: 120, width: 120, backgroundColor: 'rgba(0,0,0,0.0)'}}>
              <Image source={require('../assets/icon-android-foreground.png')} style={{height: 120, width: 120, backgroundColor: 'transparent', transform: [{scale: 2.5}]}}/>
            </View>

            <View style={{width: '100%', flexDirection: 'row', justifyContent: 'center'}}>
              <Text 
                style={{ width: '50%',fontFamily: 'Roboto_700Bold', fontSize: 36, marginVertical: 20, textAlign: "center", color: '#3a3a3a'}}
                numberOfLines={2}
                adjustsFontSizeToFit
              >
                Welcome to Well Ping!
              </Text>
            </View>
            {/* <PaperButton
              buttonColor="white" 
              mode="elevated" 
              style={{borderRadius: 12, width: 294, alignItems: 'center', paddingVertical: 10, borderWidth: 0, borderColor: 'black'}}
              // disabled={this.state.disableLoginButton}
              labelStyle={{fontSize: 18, color: '#761A15', fontFamily: 'Roboto_500Medium'}}
              onPress={() => {
                this.startSurveyAsync();
              }}
            >
              <Text
                // style={{width: '100%'}}
                numberOfLines={2}
                adjustsFontSizeToFit
              >
              Click here to start the survey
              </Text>
            </PaperButton> */}
            <Pressable 
              onPress={() => {
                this.startSurveyAsync();
              }}
              style={[_styles.center, {
                width: '80%', 
                height: 100, 
                borderWidth: 0.5,
                borderColor: 'lightgray',
                borderRadius: 20,
                paddingHorizontal: '5%',
                paddingVertical: '5%',
                backgroundColor: 'white'
              }]}>

              <Text
                  style={{color: '#761A15', fontSize: 36, fontFamily: 'Roboto_500Medium'}}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                Click here to start the survey
                </Text>
            </Pressable>

          </View>
          {/* Long Press to activate Debug View */}
          {/* <DashboardComponent
            firebaseUser={firebaseUser}
            studyInfo={studyInfo}
          /> */}
        </View>
      );
    }

    // Display End of Survey screen
    if (currentPing.endTime) {
      return (
        <View style={_styles.container}>
          {ExtraView}
          {this.state.afterFinishingPing_isUploading 
            ? <Text style={{ ...styles.onlyTextStyle, color: "red" }}>
                Uploading…{"\n"}Please do not exit the app!
              </Text>
            : <View style={_styles.container}>
              <View style={{height: height/8}}/>
              <BellImage/>
              <Pressable onLongPress={()=>void 0}>
                <Text numberOfLines={3} adjustsFontSizeToFit style={[styles.onlyTextStyle, {fontSize: 30, fontFamily: 'Roboto_700Bold', color: '#3a3a3a'}]}>
                  Thank you for completing the survey for this ping!{"\n"}
                </Text>
              </Pressable>
              <Text numberOfLines={2} adjustsFontSizeToFit style={{fontFamily: "Roboto_400Regular", fontSize: 20, textAlign: 'center', paddingHorizontal: 40, color: '#3a3a3a'}}>
                Well Ping will send a notification for the next survey soon.{"\n"}
                {/* Please close the app entirely */}
              </Text>
              {/* <View style={{height: height/8/2}}/> */}
              {/* <Text style={{fontSize: 25, fontFamily: 'Roboto_700Bold'}}>You may now exit the app</Text> */}
              <Text numberOfLines={1} adjustsFontSizeToFit style={{fontSize: 30, fontFamily: 'Roboto_700Bold', textAlign: 'center', paddingHorizontal: 20, color: '#3a3a3a'}}>Please close the app entirely</Text>
              <DashboardComponent
                firebaseUser={firebaseUser}
                studyInfo={studyInfo}
              />

              {/* Long Press to activate Debug View */}
            </View>
          }

        </View>
      );
    }

    // Finally, display SurveyScreen
    return (
      <View style={{ height: "100%" }}>
        {ExtraView}
        {/* <Pressable onPress={()=>console.log(JSON.stringify(streams))} style={{width: '100%', height: 50, backgroundColor: 'tan'}}>
          <Text>log to terminal</Text>
        </Pressable> */}
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
                          await this._forceUploadAllDataAsync({
                            successTitle: "Data Uploaded Successfully!",
                            getSuccessMessage: (response) =>
                              "Thank you for your patience. " +
                              "You may exit the app now.\n\n" +
                              `Response: ${JSON.stringify(response)}`,
                            errorTitle: "Error: Data Upload Error!",
                            getErrorMessage: (error) =>
                              "We cannot upload your data at this moment.\n\n" +
                              "You may exit the app for now, we will alert you again of this problem next time you finished a ping.\n\n" +
                              `Error message: ${error}`,
                          });
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
              doFinally: async () => {
                this.setState({ afterFinishingPing_isUploading: false });

                // This method implements LOGOUT when the last 5 consecutve answers are "prefer not to answer"
                await shouldRemoveFutureNotifications()
              },
            });
          }}
          studyInfo={studyInfo}
          setUploadStatusSymbol={this.setUploadStatusSymbol}
        />
        {/* <DebugView /> */}
      </View>
    );
  }
}

const _styles = StyleSheet.create({
  container: {
    height: '100%', 
    alignItems: 'center', 
    justifyContent: 'flex-start',
    backgroundColor: 'white'
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center'
  },
  shadow: Platform.OS!=="ios"? {
    // Android styles
		shadowColor: 'black', 
		shadowOffset: {height: 5, width: 5}, 
		shadowRadius: 6, 
		shadowOpacity: 1, 
		elevation: 4,
	} : {
    // iOS styles
		shadowColor: 'lightgray', 
		shadowOffset: {height: 5, width: 5}, 
		shadowRadius: 3, 
		shadowOpacity: 1, 
		elevation: 5,
	},
})
