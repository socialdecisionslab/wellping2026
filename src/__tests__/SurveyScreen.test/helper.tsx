import { Ping, StudyInfo } from "@wellping/study-schemas/lib/types";
import {
  fireEvent,
  act,
  waitFor,
  waitForElementToBeRemoved,
  RenderAPI,
} from "@testing-library/react-native";
import waitForExpect from "wait-for-expect";

import { getAnswersAsync } from "../../helpers/answers";
import {
  getAnswersPingIdsQuestionIdsListAsync,
  getAnswersQuestionIdsListForPingAsync,
} from "../../helpers/asyncStorage/answersPingIdsQuestionIdsList";
import { getPingsListAsync } from "../../helpers/asyncStorage/pingsList";
import { clearAllPingsAndAnswersAsync } from "../../helpers/cleanup";
import { insertPingAsync, getPingsAsync } from "../../helpers/pings";
import { secureStoreUserAsync } from "../../helpers/secureStore/user";
import { PINGS_STUDY_INFO } from "../data/pings";
import { mockCurrentStudyInfo } from "../helper";

export const MAIN_SURVEY_SCREEN_VIEW = "mainSurveyScreenView";
export const QUESTION_TITLE_TESTID = "questionTitle";
export const NEXT_BUTTON_A11YLABEL = "Next question";
export const PNA_BUTTON_A11YLABEL = "Prefer not to answer the current question";

// Just use a study info - it's not important.
export const STUDY_INFO: StudyInfo = {
  ...PINGS_STUDY_INFO,
  // This doesn't really matter (as we always just call .press()), but we add it
  // here to make it clearer.
  alwaysEnableNextButton: true,
};

export function getBaseProps() {
  return {
    studyInfo: STUDY_INFO,
    previousState: null,
    onFinish: () => {},
    setUploadStatusSymbol: () => {}, // TODO: TEST THIS.
  };
}

export async function setUpSurveyScreenTestAsync(
  studyInfo: StudyInfo = STUDY_INFO,
): Promise<Ping> {
  mockCurrentStudyInfo(studyInfo);
  await secureStoreUserAsync({
    username: "synthetic-renderer",
    password: "test-only",
    loginDate: 0,
  });

  // Just to make sure.
  await clearAllPingsAndAnswersAsync();

  return await insertPingAsync({
    notificationTime: new Date(Date.now() - 20000),
    startTime: new Date(Date.now() - 10000),
    streamName: `myTest${Date.now()}Stream`, // We use `Date.now()` so that it will not conflict with other data.
  });
}

export type TearDownSurveyScreenTestOptions = {
  shouldHaveEndTime: boolean;
  shouldCheckAnswers: boolean;
};
export async function tearDownSurveyScreenTestAsync(
  customizedOptions: Partial<TearDownSurveyScreenTestOptions> = {},
): Promise<void> {
  const options: TearDownSurveyScreenTestOptions = {
    shouldHaveEndTime: true,
    shouldCheckAnswers: true,
    ...customizedOptions,
  };

  const pingsList = await getPingsListAsync();
  expect(pingsList).toHaveLength(1);
  const pings = await getPingsAsync();
  expect(pings).toHaveLength(1);

  const ping = pings[0];
  if (options.shouldHaveEndTime) {
    expect(ping.endTime).not.toBeNull();
  } else {
    expect(ping.endTime).toBeNull();
  }

  if (options.shouldCheckAnswers) {
    const answersQuestionIdsListForPing =
      await getAnswersQuestionIdsListForPingAsync(ping.id);
    // Expect the answersQuestionIdsListForPing to be unique.
    // https://stackoverflow.com/q/57001262/2603230
    expect(
      Array.isArray(answersQuestionIdsListForPing) &&
        answersQuestionIdsListForPing.length ===
          new Set(answersQuestionIdsListForPing).size,
    ).toBeTruthy();

    const answersPingIdsQuestionIdsList =
      await getAnswersPingIdsQuestionIdsListAsync();
    // Just a easy way to compare if two arrays are equal.
    expect(JSON.stringify(answersPingIdsQuestionIdsList)).toEqual(
      JSON.stringify(
        answersQuestionIdsListForPing.map((questionId) => [
          ping.id,
          questionId,
        ]),
      ),
    );

    const answers = await getAnswersAsync();
    for (let i = 0; i < answers.length; i++) {
      const answer = answers[i];
      expect(answer.pingId).toBe(ping.id);
      expect(answer.questionId).not.toBeNull();
      expect(answer.date).not.toBeNull();

      // Make sure prefer not to answer means the input data is not stored.
      if (answer.preferNotToAnswer) {
        expect(answer.data).toBeNull();
      }
      if (answer.data) {
        expect(answer.preferNotToAnswer).toBeNull();
      }

      expect(answersQuestionIdsListForPing[i]).toStrictEqual(answer.questionId);
      expect(answersPingIdsQuestionIdsList[i]).toEqual([
        answer.pingId,
        answer.questionId,
      ]);

      // So that the date and the ping ID (which are dynamic) wouldn't affect the
      // snapshot.
      answer.date = new Date(0);
      answer.pingId = "[removed for snapshot]";
    }
    // TODO: READ AND MAKE SURE ALL SNAPSHOTS ARE FINE
    expect(answers).toMatchSnapshot(`getAnswersAsync`);
  }

  await clearAllPingsAndAnswersAsync();
}

/**
 * Tests the current question.
 *
 * If `waitForAndTestEndPage` is true, we will wait for the question title to
 * be removed and test if it is indeed the end page (onFinishFn should be
 * passed to the function). Otherwise, we will wait for the next question title
 * to be loaded.
 */
export async function testCurrentQuestionAsync({
  renderResults: {
    getByLabelText,
    queryByTestId,
    findByTestId,
    getByTestId,
    toJSON,
  },
  expectCurrentQuestionAsync,
  nextButton = "next",
  waitForAndTestEndPage = false,
  onFinishFn,
}: {
  renderResults: RenderAPI;
  expectCurrentQuestionAsync: (
    getCurrentQuestionTitle: () => string,
  ) => Promise<void>;
  nextButton?: "next" | "pna";
  waitForAndTestEndPage?: boolean;
  onFinishFn?: jest.Mock;
}): Promise<void> {
  // Wait for the question to be loaded.
  await waitFor(() => {
    expect(getByTestId(QUESTION_TITLE_TESTID)).toBeTruthy();
    expect(getByTestId(MAIN_SURVEY_SCREEN_VIEW).props.pointerEvents).toBe(
      "auto",
    );
  });
  expect(queryByTestId(QUESTION_TITLE_TESTID)).not.toBeNull();

  const getCurrentQuestionTitle = () =>
    getByTestId(QUESTION_TITLE_TESTID).props.children;

  await act(async () => {
    await expectCurrentQuestionAsync(getCurrentQuestionTitle);
  });

  await waitForExpect(async () => {
    // Expect the screen to return to non-blank after the transition between
    // question finishes.
    expect(
      (await findByTestId(MAIN_SURVEY_SCREEN_VIEW)).props.style.opacity,
    ).toBe(1);
  });

  const currentQuestionTitle = getCurrentQuestionTitle();

  await act(async () => {
    if (nextButton === "next") {
      fireEvent.press(getByLabelText(NEXT_BUTTON_A11YLABEL));
    } else if (nextButton === "pna") {
      fireEvent.press(getByLabelText(PNA_BUTTON_A11YLABEL));
    }
  });

  if (waitForAndTestEndPage) {
    if (queryByTestId(QUESTION_TITLE_TESTID)) {
      await waitForElementToBeRemoved(() =>
        queryByTestId(QUESTION_TITLE_TESTID),
      );
    }

    expect(toJSON()).toBe(null);

    await waitForExpect(() => {
      expect(onFinishFn).toHaveBeenCalledTimes(1);
    });
  } else {
    await waitForExpect(() => {
      expect(getCurrentQuestionTitle()).not.toEqual(currentQuestionTitle);
    });
  }
}

export type TestQuestionsSequence = {
  expectCurrentQuestionAsync: (
    getCurrentQuestionTitle: () => string,
  ) => Promise<void>;
  nextButton?: "next" | "pna";
}[];

export async function testQuestionsSequenceAsync({
  renderResults,
  onFinishFn,
  sequence,
}: {
  renderResults: RenderAPI;
  onFinishFn: jest.Mock;
  sequence: TestQuestionsSequence;
}) {
  for (let i = 0; i < sequence.length - 1; i++) {
    const currentQuestion = sequence[i];
    await testCurrentQuestionAsync({
      renderResults,
      expectCurrentQuestionAsync: currentQuestion.expectCurrentQuestionAsync,
      nextButton: currentQuestion.nextButton,
    });
  }

  const lastQuestion = sequence[sequence.length - 1];
  await testCurrentQuestionAsync({
    renderResults,
    expectCurrentQuestionAsync: lastQuestion.expectCurrentQuestionAsync,
    nextButton: lastQuestion.nextButton,
    waitForAndTestEndPage: true,
    onFinishFn,
  });
}

export const PART_OF_NON_CRITICAL_ERROR_STRING =
  "[An internal error occurred. Please contact the study staff.]";
