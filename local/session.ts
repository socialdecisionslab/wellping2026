import { IS_LOCAL_DEVELOPMENT } from "../config/local";
import {
  getPingStateAsync,
  storePingStateAsync,
} from "../src/helpers/asyncStorage/pingState";
import { addToUnuploadedPingsListIfNeededAsync } from "../src/helpers/asyncStorage/unuploadedPingsList";
import { getLatestPingAsync, insertPingAsync } from "../src/helpers/pings";
import {
  secureGetUserAsync,
  secureStoreUserAsync,
} from "../src/helpers/secureStore/user";
import {
  getStudyFileAsync,
  parseAndStoreStudyFileAsync,
} from "../src/helpers/studyFile";

export async function openSyntheticSession(startAnother = false) {
  if (!IS_LOCAL_DEVELOPMENT)
    throw new Error("Local configuration is required.");
  const error = await parseAndStoreStudyFileAsync(
    JSON.stringify(require("./synthetic-study.json")),
  );
  if (error) throw new Error(error);
  const study = await getStudyFileAsync();
  if (!(await secureGetUserAsync())) {
    await secureStoreUserAsync({
      username: "synthetic",
      password: "local-only",
      loginDate: Date.now(),
    });
  }
  let ping = await getLatestPingAsync();
  let previousState = null;
  if (ping && !startAnother && ping.endTime === null) {
    previousState = await getPingStateAsync(ping.id);
  }
  if (!ping || startAnother) {
    ping = await insertPingAsync({
      notificationTime: new Date(Date.now() - 1000),
      startTime: new Date(),
      streamName: "synthetic",
    });
    await addToUnuploadedPingsListIfNeededAsync(ping);
    // Make the first screen resumable even before React mounts it.
    await storePingStateAsync(ping.id, {
      currentQuestionData: {
        questionId: study.studyInfo.streamsStartingQuestionIds.synthetic,
        extraData: {},
      },
      nextQuestionsDataStack: [],
      answers: {},
      isInTransition: false,
    });
  }
  return { study, ping, previousState };
}
