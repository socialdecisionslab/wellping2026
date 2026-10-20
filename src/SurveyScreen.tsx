import {
  COMPLETION_EVENT_KEY,
  completionRequestedAt,
} from "./helpers/terminalCompletion";
import {
  Answer,
  AnswerData,
  AnswersList,
  ChoicesWithMultipleAnswersAnswerData,
  ChoicesWithSingleAnswerAnswer,
  ChoicesWithSingleAnswerAnswerData,
  MultipleTextAnswer,
  MultipleTextAnswerData,
  SliderAnswer,
  YesNoAnswerData,
} from "@wellping/study-schemas/lib/answerTypes";
import {
  BranchQuestion,
  BranchWithRelativeComparisonQuestion,
  ChoicesQuestion,
  ChoicesWithSingleAnswerQuestion,
  MultipleTextQuestion,
  Ping,
  Question,
  QuestionId,
  QuestionImageOptions,
  QuestionsList,
  StudyInfo,
  WrapperQuestion,
  YesNoQuestion,
} from "@wellping/study-schemas/lib/types";
import { addDays } from "date-fns";
import cloneDeep from "lodash/cloneDeep";
import cloneDeepWith from "lodash/cloneDeepWith";
import React from "react";
import {
  Alert,
  Button,
  Dimensions,
  DimensionValue,
  Image,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";
import { insertAnswerAsync } from "./helpers/answers";
import { enqueueFollowupPingsOnceAsync } from "./helpers/asyncStorage/futurePings";
import {
  clearPingStateAsync,
  getPingStateAsync,
  storePingStateAsync,
} from "./helpers/asyncStorage/pingState";
import {
  getDataOwnerAsync,
  getJournalPingExpiryAsync,
} from "./helpers/dataJournal";
import {
  getCriticalProblemTextForUser,
  getNonCriticalProblemTextForUser,
} from "./helpers/debug";
import {
  NON_USER_QUESTION_TYPES,
  QuestionType,
  replacePreviousAnswerPlaceholdersWithActualContent,
  treatPlaceholderReplacementValue,
  withVariable,
} from "./helpers/helpers";
import { addEndTimeToPingAsync } from "./helpers/pings";
import { secureGetPingAsync } from "./helpers/secureStore/ping";
import {
  enqueueSurveyAnswerSaveAsync,
  waitForSurveyAnswerSavesAsync,
} from "./helpers/surveyAnswerWrites";
import { DataValidationFunction, QuestionScreenProps } from "./helpers/types";
import ChoicesQuestionScreen from "./questionScreens/ChoicesQuestionScreen";
import HowLongAgoQuestionScreen from "./questionScreens/HowLongAgoQuestion";
import MultipleTextQuestionScreen from "./questionScreens/MultipleTextQuestionScreen";
import SliderQuestionScreen from "./questionScreens/SliderQuestionScreen";

/**
 * Any data that is associated with the question.
 * It is used by `pipeInExtraMetaData`.
 */
type ExtraData = { [key: string]: any };

function recoveryCode(error: unknown): string | undefined {
  return error !== null && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}

type CurrentQuestionData = {
  /**
   * The question ID.
   * If `null`, it means that there is no current question.
   */
  questionId: QuestionId | null;

  /**
   * The extra data associated with this question.
   */
  extraData: ExtraData;
};

type NextQuestionData = CurrentQuestionData & {
  /**
   * Unlike `CurrentData`, it cannot be `null` because in that case this
   * `NextData` should not exist at all.
   */
  questionId: QuestionId;
};

export interface SurveyScreenProps {
  /**
   * The questions in this ping.
   */
  questions: QuestionsList;

  /**
   * The question ID of the first question in `questions`.
   */
  startingQuestionId: QuestionId;

  /**
   * The current ping.
   */
  ping: Ping;

  /**
   * The previously stored state.
   * It is used to automatically put the user back to where they left when they
   * leave the app in the middle of the ping and come back later.
   */
  previousState: SurveyScreenState | null;

  /**
   * The function to call when the current ping is completed.
   */
  onFinish: (finishedPing: Ping) => void;

  studyInfo: StudyInfo;

  setUploadStatusSymbol: (symbol: string) => void;
}

export interface SurveyScreenState {
  /**
   * The question data of the current question that the user is answering.
   */
  currentQuestionData: CurrentQuestionData;

  /**
   * A stack of questions (and extra data for each of those questions) that
   * will be popped once the current question's next is `null`.
   *
   * When `nextQuestionsDataStack` is empty and the current question's `next`
   * is `null`, the current ping ends.
   *
   * For example, if `[a, b, c]` is in `nextStack` and the current question's
   * `next` is `null`, then the next question will be `c`.
   * If `[]` is in `nextStack` and the current question's `next` is `null`,
   * then the current ping ends.
   */
  nextQuestionsDataStack: NextQuestionData[];

  /**
   * All current answers.
   */
  answers: AnswersList;

  /**
   * Whether we are transitioning from two questions.
   * If true, this sets the whole screen's opacity to 0.
   */
  isInTransition: boolean;
}

export default class SurveyScreen extends React.Component<
  SurveyScreenProps,
  SurveyScreenState
> {
  constructor(props: SurveyScreenProps) {
    super(props);

    if (props.previousState) {
      this.state = {
        ...cloneDeepWith(props.previousState, (value) =>
          value instanceof Date ? new Date(value.getTime()) : undefined,
        ),
        isInTransition: false,
      };
    } else {
      this.state = {
        currentQuestionData: {
          questionId: props.startingQuestionId,
          extraData: {},
        },
        nextQuestionsDataStack: [],
        answers: {},
        isInTransition: false,
      };
    }
    this.committedState = this.state;
  }

  private committedState: SurveyScreenState;
  private operations: Promise<void> = Promise.resolve();
  private navigationPending = false;
  private initialResumeReady = false;
  private stoppedError: unknown = null;
  private expectedOwnerId: string | undefined;
  private pingExpiresAt: Date | null = null;
  private acceptedAnswerIds = new Set<string>();
  private unmounted = false;
  private questionGeneration = 0;
  private releaseRetry: (() => void) | null = null;
  private readonly cancelled = new Error("Survey screen was closed.");

  private stopForTerminalError(error: unknown) {
    const firstNotice = this.stoppedError === null;
    this.stoppedError = error;
    if (this.unmounted || !firstNotice) return;
    this.setState({ isInTransition: false });
    const expired = recoveryCode(error) === "PING_EXPIRED";
    Alert.alert(
      expired ? "Survey window ended" : "Survey needs recovery",
      expired
        ? "The survey window has ended. Your earlier saved responses have been preserved."
        : "This survey cannot continue in the current session. Existing saved responses have been preserved. Please keep the app open and recover the original session before continuing.",
      [{ text: "OK" }],
      { cancelable: false },
    );
  }

  private acceptsEventAt(date: Date): boolean {
    if (this.pingExpiresAt && date.getTime() > this.pingExpiresAt.getTime()) {
      this.stopForTerminalError(
        Object.assign(new Error("Survey window ended."), {
          code: "PING_EXPIRED",
        }),
      );
      return false;
    }
    return true;
  }

  /** Keep failures at the head of the queue until the participant retries. */
  private async retrySave<T>(
    operation: () => Promise<T>,
    drainAcceptedAnswer = false,
  ): Promise<T> {
    while (!this.unmounted || drainAcceptedAnswer) {
      try {
        return await operation();
      } catch (error) {
        const code = recoveryCode(error);
        if (
          code === "PING_EXPIRED" ||
          code === "OWNER_CHANGED" ||
          code === "NO_ACTIVE_OWNER" ||
          code === "SESSION_CLOSED" ||
          code === "INVALID_COMPLETION_EVENT"
        ) {
          this.stopForTerminalError(error);
          throw error;
        }
        if (this.unmounted) {
          if (drainAcceptedAnswer) throw error;
          break;
        }
        await new Promise<void>((resolve) => {
          let waiting = true;
          const retry = () => {
            if (!waiting) return;
            waiting = false;
            this.releaseRetry = null;
            resolve();
          };
          this.releaseRetry = retry;
          Alert.alert(
            "Survey not saved",
            "We could not securely save your progress. Please retry before continuing or closing the app. Your existing saved data has not been discarded.",
            [{ text: "Retry", onPress: retry }],
            { cancelable: false },
          );
        });
      }
    }
    throw this.cancelled;
  }

  private enqueue(
    operation: () => Promise<void>,
    drainAcceptedAnswer = false,
  ): Promise<void> {
    const result = this.operations.then(async () => {
      if (
        (!this.unmounted && this.stoppedError === null) ||
        drainAcceptedAnswer
      ) {
        await this.retrySave(operation, drainAcceptedAnswer);
      }
    });
    // Already accepted answers survive expiration/unmount. Navigation and resume
    // writes do not: the last saved position reconciles the durable answers.
    // Detached failures cannot ask for Retry; durable journal recovery remains
    // available for writes that reached storage, without stale UI alerts.
    this.operations = result.catch(() => undefined);
    return this.operations;
  }

  private applyCommittedState(state: SurveyScreenState) {
    this.committedState = state;
    if (!this.unmounted) this.setState(state);
  }

  private completionDelivered = false;

  private async finishTerminalResume() {
    if (
      this.committedState.currentQuestionData.questionId !== null ||
      this.completionDelivered ||
      this.stoppedError !== null
    )
      return;
    // The terminal snapshot and ping completion are separate durable writes.
    // Recover if the app closed between them, without changing an existing end time.
    const savedPing = await secureGetPingAsync(
      this.props.ping.id,
      this.expectedOwnerId,
    );
    if (!savedPing)
      throw new Error("Cannot finish a survey whose ping is missing.");
    if (this.unmounted) return;
    const finishedPing = savedPing.endTime
      ? savedPing
      : await addEndTimeToPingAsync(
          savedPing.id,
          completionRequestedAt(
            savedPing,
            this.committedState,
            this.expectedOwnerId,
            this.props.questions,
          ),
          this.expectedOwnerId,
        );
    if (this.unmounted) return;
    await clearPingStateAsync(savedPing.id, this.expectedOwnerId);
    if (this.unmounted) return;
    this.completionDelivered = true;
    this.props.onFinish(finishedPing);
  }

  componentDidMount() {
    void this.enqueue(async () => {
      const owner = await getDataOwnerAsync();
      if (this.unmounted) return;
      this.expectedOwnerId = owner.id;
      this.pingExpiresAt = await getJournalPingExpiryAsync(
        this.props.ping.id,
        owner.id,
      );
      if (this.unmounted) return;
      const drainedAnswers = await waitForSurveyAnswerSavesAsync(
        owner.id,
        this.props.ping.id,
      );
      if (this.unmounted) return;
      // Home may have read its snapshot while the old instance was draining.
      // Re-read after that lane, merging authoritative owner-verified answers.
      let refreshResume = true;
      let initialState: SurveyScreenState;
      try {
        initialState = await getPingStateAsync(
          this.props.ping.id,
          this.expectedOwnerId,
        );
      } catch (error) {
        if (
          recoveryCode(error) !== "MISSING_RESUME_STATE" ||
          this.props.previousState !== null ||
          drainedAnswers
        )
          throw error;
        // Only an explicitly absent resume for a new ping permits a fresh
        // baseline. An old screen may have finished draining during owner/expiry
        // lookup, so absence of a currently pending lane is not proof of newness.
        refreshResume = false;
        initialState = this.committedState;
      }
      if (this.unmounted) return;
      await storePingStateAsync(
        this.props.ping.id,
        initialState,
        this.expectedOwnerId,
      );
      if (this.unmounted) return;
      // No input is accepted without a durable question position to recover.
      // Remount seeded controls if the authoritative answer changed while waiting.
      if (refreshResume) this.questionGeneration += 1;
      this.initialResumeReady = true;
      this.applyCommittedState({ ...initialState, isInTransition: false });
      const initialQuestionId = initialState.currentQuestionData.questionId;
      if (initialQuestionId === null) {
        void this.enqueue(() => this.finishTerminalResume());
      } else if (
        this.props.questions[initialQuestionId] &&
        NON_USER_QUESTION_TYPES.includes(
          this.props.questions[initialQuestionId].type,
        )
      ) {
        this.onNextSelect();
      }
    });
  }

  private enqueueAcceptedAnswer(
    question: Question,
    realQuestionId: string,
    input: {
      preferNotToAnswer: true | null;
      data: AnswerData | null;
      date: Date;
    },
  ) {
    // Register immediately, so a remount/logout sees every accepted event even
    // before this instance's preceding operation reaches native storage.
    const previousLocalOperation = this.operations;
    const result = enqueueSurveyAnswerSaveAsync(
      this.expectedOwnerId!,
      this.props.ping.id,
      async () => {
        await previousLocalOperation;
        try {
          await this.retrySave(
            () => this.saveAnswer(question, realQuestionId, input),
            true,
          );
        } catch (error) {
          // A post-window event was never a valid accepted response. Do not keep
          // retrying it or block cleanup of earlier, valid durable responses.
          if (recoveryCode(error) !== "PING_EXPIRED") throw error;
        }
      },
    );
    this.operations = result.catch(() => undefined);
    return this.operations;
  }

  componentWillUnmount() {
    this.unmounted = true;
    this.releaseRetry?.();
  }

  /**
   * Returns a string where all placeholders in `input` are replaced with
   * actual data.
   * A warning text will replace a placeholder if that piece of data does
   * not exists.
   *
   * Supports:
   * - Replacing variable placeholders with variables in `extraData`.
   * - Replacing answer placeholders with actual answers.
   */
  replacePlaceholders(
    input: string,
    state: SurveyScreenState = this.state,
    defaultExtraData?: ExtraData,
  ): string {
    const { questions, studyInfo } = this.props;
    const { currentQuestionData, answers } = state;

    let output = input;
    function _replaceWithExtraData(extraData: ExtraData) {
      for (const [key, value] of Object.entries(extraData)) {
        const treatedValue = treatPlaceholderReplacementValue(
          key,
          value,
          studyInfo,
        );

        // https://stackoverflow.com/a/56136657/2603230
        output = output.split(withVariable(key)).join(treatedValue);
      }
    }
    _replaceWithExtraData(currentQuestionData.extraData);

    if (defaultExtraData != null) {
      // Replace the remaining placeholders (that have not been replaced by
      // current data in state) with the default extra data.
      _replaceWithExtraData(defaultExtraData);
    }

    output = replacePreviousAnswerPlaceholdersWithActualContent(
      output,
      (questionId) => {
        const question = questions[questionId];
        const answer = answers[questionId];
        if (!question) {
          return null;
        }

        let returnedAnswer: string | null = null;
        switch (question.type) {
          case QuestionType.ChoicesWithSingleAnswer: {
            const csaQuestion = questions[
              questionId
            ] as ChoicesWithSingleAnswerQuestion;

            const csaAnswer = answer as ChoicesWithSingleAnswerAnswer;
            if (csaAnswer == null) {
              return getNonCriticalProblemTextForUser(
                `csaAnswer.data (from ${question.id}) == null`,
              );
            }

            const csaAnswerChoiceValue = csaAnswer.data?.value;
            if (csaAnswerChoiceValue == null) {
              return getNonCriticalProblemTextForUser(
                `csaAnswerChoiceValue (from ${csaQuestion.id}) == null`,
              );
            }

            returnedAnswer = csaAnswerChoiceValue;
            break;
          }

          default:
            break;
        }

        if (returnedAnswer !== null) {
          returnedAnswer = treatPlaceholderReplacementValue(
            questionId,
            returnedAnswer,
            studyInfo,
          );
        }
        return returnedAnswer;
      },
    );

    return output;
  }

  /**
   * Returns a new stack of questions based on the previous question, its answer,
   * its extra data, and all current answers.
   *
   * The last element (i.e. `pop()`) of the returned array is the immediate next
   * question, while the rest should be added to the `nextQuestionsDataStack`.
   *
   * If the returned array is empty, it means that no question directly follows
   * this question, and we should pop a question from `nextQuestionsDataStack`.
   */
  getNewNextQuestionsDataStack({
    prevQuestion,
    prevAnswer,
    prevExtraData,
    answers,
    prevState,
  }: {
    prevQuestion: Question;
    // When the question is a branching question, `prevAnswer` can be undefined.
    prevAnswer?: Answer;
    prevExtraData: ExtraData;
    answers: AnswersList;
    prevState: SurveyScreenState;
  }): NextQuestionData[] {
    /**
     * The question(s) that cuts in line and shows before the actual `next`.
     * The user will "jump" to (and follow through until a question's `next`
     * is null) before going to `nextQuestionData`.
     *
     * If it is non-empty, the user will go to the first element. The rest of
     * the elements as well as `nextQuestionData` will be pushed to the
     * original `nextQuestionsDataStack`.
     */
    const jumpQuestionsDataStack: NextQuestionData[] = [];

    /**
     * The next question that the user will go to after the `jumpQuestionData`
     * sequence is done.
     *
     * If `questionId` is `null`, `nextQuestionsDataStack` will be popped and
     * we will go to that question. If `nextQuestionsDataStack` is empty, the
     * ping has ended.
     */
    const nextQuestionData: CurrentQuestionData = {
      questionId: prevQuestion.next,
      extraData: prevExtraData,
    };

    /**
     * Does appropriate actions when facing a conditional question ID.
     * See inline comments for more explanations.
     */
    const considerConditionalQuestionId = (
      conditionalQuestionId: QuestionId | null | undefined,
    ) => {
      if (conditionalQuestionId === undefined) {
        // Do nothing, because we will continue to this question's `next`
        // as before.
      } else if (conditionalQuestionId === null) {
        // If a question ID in any fields besides the `next` field is
        // intentionally set to (and is allowed to set to) `null`, it means
        // that we should treat it as if `next` is set to `null` when that
        // field is used. In other words, the original `next` is ignored.
        nextQuestionData.questionId = null;
      } else {
        jumpQuestionsDataStack.push({
          questionId: conditionalQuestionId,
          extraData: prevExtraData,
        });
      }
    };

    const handleYesNoQuestion = (ynQ: YesNoQuestion, ynD: YesNoAnswerData) => {
      if (ynQ.branchStartId) {
        const jumpQuestionId = ynD.value
          ? ynQ.branchStartId.yes
          : ynQ.branchStartId.no;
        considerConditionalQuestionId(jumpQuestionId);
      }
    };

    const handleMultipleTextQuestion = (
      mtQ: MultipleTextQuestion,
      mtD: MultipleTextAnswerData,
    ) => {
      const valuesLength = mtD.value.length;

      if (valuesLength === 0 || mtQ.repeatedItemStartId === undefined) {
        return;
      }

      // Reversed for because we want to go to the `0`th first, then `1`st,
      // etc.
      for (let i = valuesLength - 1; i >= 0; i--) {
        jumpQuestionsDataStack.push({
          questionId: mtQ.repeatedItemStartId,
          extraData: {
            [mtQ.variableName]: mtD.value[i],
            [mtQ.indexName]: i + 1,
          },
        });
      }
    };

    const handleChoicesQuestions = (
      cQ: ChoicesQuestion,
      cD:
        | ChoicesWithSingleAnswerAnswerData
        | ChoicesWithMultipleAnswersAnswerData,
    ) => {
      const specialCasesStartId = cQ.specialCasesStartId;
      if (!specialCasesStartId) {
        return;
      }

      const specialCase = specialCasesStartId.find((eachSpecialCase) => {
        /* istanbul ignore else */
        if (cQ.type === QuestionType.ChoicesWithSingleAnswer) {
          const csaAnswerData = cD as ChoicesWithSingleAnswerAnswerData;
          return eachSpecialCase[0] === csaAnswerData.value;
        } else if (cQ.type === QuestionType.ChoicesWithMultipleAnswers) {
          const cmaAnswerData = cD as ChoicesWithMultipleAnswersAnswerData;
          // (Notice that we cannot use `.includes` here because
          //  `[ 'Choice 1', true ] != [ 'Choice 1', true ]`
          //  and `.includes` checks equality.)
          return cmaAnswerData.value.some(
            // If this special choice key is selected.
            (answer) => answer[0] === eachSpecialCase[0] && answer[1] === true,
          );
        }
      });

      const specialNextQuestionId = specialCase ? specialCase[1] : undefined;
      considerConditionalQuestionId(specialNextQuestionId);
    };

    const handleBranchQuestion = (bQ: BranchQuestion) => {
      let selectedBranchId = bQ.branchStartId.false;

      // TODO: consider the implication of not providing `defaultPlaceholderValues` to `replacePlaceholders` here.

      switch (bQ.condition.questionType) {
        case QuestionType.MultipleText: {
          const targetQuestionAnswer = answers[
            this.replacePlaceholders(bQ.condition.questionId, prevState)
          ] as MultipleTextAnswer;
          if (targetQuestionAnswer && targetQuestionAnswer.data) {
            if (
              targetQuestionAnswer.data.value.length === bQ.condition.target
            ) {
              selectedBranchId = bQ.branchStartId.true;
            }
          }
          break;
        }

        case QuestionType.ChoicesWithSingleAnswer: {
          const csaQuestionAnswer = answers[
            this.replacePlaceholders(bQ.condition.questionId, prevState)
          ] as ChoicesWithSingleAnswerAnswer;
          if (csaQuestionAnswer && csaQuestionAnswer.data) {
            if (csaQuestionAnswer.data?.value === bQ.condition.target) {
              selectedBranchId = bQ.branchStartId.true;
            }
          }
          break;
        }
      }

      considerConditionalQuestionId(selectedBranchId);
    };

    const handleBranchWithRelativeComparison = (
      bwrcQuestion: BranchWithRelativeComparisonQuestion,
    ) => {
      let nextQuestionId = null;
      let curMaxValue = -999;
      for (const comparingQuestionId of Object.keys(
        bwrcQuestion.branchStartId,
      )) {
        // TODO: SUPPORT OTHER QUSTION TYPES.
        const comparingQuestionAnswer =
          (answers[comparingQuestionId] as SliderAnswer).data?.value || -1;
        if (comparingQuestionAnswer > curMaxValue) {
          nextQuestionId = bwrcQuestion.branchStartId[comparingQuestionId];
          curMaxValue = comparingQuestionAnswer;
        }
      }

      considerConditionalQuestionId(nextQuestionId);
    };

    const handleWrapper = (wQuestion: WrapperQuestion) => {
      // Do the inner next first.
      jumpQuestionsDataStack.push({
        questionId: wQuestion.innerNext,
        extraData: prevExtraData,
      });
    };

    if (NON_USER_QUESTION_TYPES.includes(prevQuestion.type)) {
      // Handle branching questions.
      switch (prevQuestion.type) {
        case QuestionType.Branch:
          handleBranchQuestion(prevQuestion as BranchQuestion);
          break;

        case QuestionType.BranchWithRelativeComparison:
          handleBranchWithRelativeComparison(
            prevQuestion as BranchWithRelativeComparisonQuestion,
          );
          break;

        case QuestionType.Wrapper:
          handleWrapper(prevQuestion as WrapperQuestion);
          break;

        default:
          break;
      }
    } else {
      if (prevAnswer?.preferNotToAnswer) {
        if (prevQuestion.fallbackNext?.preferNotToAnswer !== undefined) {
          nextQuestionData.questionId =
            prevQuestion.fallbackNext.preferNotToAnswer;
        }
      } else if (prevAnswer === undefined || prevAnswer.data === null) {
        // If `prevAnswer.preferNotToAnswer` is not true and `prevAnswer.data
        // === null` (or if the whole answer is undefined - this might happen
        // when the user are clicking "Next" to fast), it means that the user
        // clicked "Next" without answering.
        if (prevQuestion.fallbackNext?.nextWithoutAnswering !== undefined) {
          nextQuestionData.questionId =
            prevQuestion.fallbackNext.nextWithoutAnswering;
        }
      } else {
        // If `prevAnswer.data !== null` and `prevAnswer.preferNotToAnswer` is
        // not true. It means that the user answered the question normally.
        switch (prevQuestion.type) {
          case QuestionType.YesNo:
            handleYesNoQuestion(
              prevQuestion as YesNoQuestion,
              prevAnswer.data as YesNoAnswerData,
            );
            break;

          case QuestionType.MultipleText:
            handleMultipleTextQuestion(
              prevQuestion as MultipleTextQuestion,
              prevAnswer.data as MultipleTextAnswerData,
            );
            break;

          case QuestionType.ChoicesWithMultipleAnswers:
          case QuestionType.ChoicesWithSingleAnswer:
            handleChoicesQuestions(
              prevQuestion as ChoicesQuestion,
              prevAnswer.data as
                | ChoicesWithSingleAnswerAnswerData
                | ChoicesWithMultipleAnswersAnswerData,
            );
            break;

          default:
            // For other question types, there isn't anything special we need to
            // handle.
            break;
        }
      }
    }

    const newNextQuestionsStack: NextQuestionData[] = jumpQuestionsDataStack;
    if (nextQuestionData.questionId !== null) {
      // We insert `nextQuestionData` at the start of the array because it
      // should be the last thing that gets popped from this stack.
      newNextQuestionsStack.unshift(nextQuestionData as NextQuestionData);
    } else {
      // If nextQuestionData.questionId is `null`, it doesn't need to be in this
      // stack.
    }
    return newNextQuestionsStack;
  }

  /** Calculate navigation without mutating a committed/resumable stack. */
  private nextStateAfter(state: SurveyScreenState): SurveyScreenState {
    const { currentQuestionData, answers, nextQuestionsDataStack } = state;
    if (currentQuestionData.questionId === null) return state;
    const prevQuestion = this.props.questions[currentQuestionData.questionId];
    const newNextQuestionsStack = this.getNewNextQuestionsDataStack({
      prevQuestion,
      prevAnswer: answers[this.getRealQuestionId(prevQuestion, state)],
      prevExtraData: currentQuestionData.extraData,
      answers,
      prevState: state,
    });
    const stack = [...nextQuestionsDataStack, ...newNextQuestionsStack];
    return {
      ...state,
      currentQuestionData: stack.pop() || { questionId: null, extraData: {} },
      nextQuestionsDataStack: stack,
      isInTransition: false,
    };
  }

  private async scheduleFollowups(state: SurveyScreenState) {
    const id = state.currentQuestionData.questionId;
    if (id === null) return;
    const question = this.props.questions[id];
    const answer = state.answers[this.getRealQuestionId(question, state)];
    if (question.type !== QuestionType.YesNo || answer?.preferNotToAnswer)
      return;
    const streamName = (question as YesNoQuestion).addFollowupStream?.yes;
    if (!streamName || (answer?.data as YesNoAnswerData | null)?.value !== true)
      return;
    // The saved answer's timestamp anchors both dates across interrupted retries.
    const answeredAt = new Date(answer.date);
    const operationId = JSON.stringify([
      this.props.ping.id,
      answer.questionId,
      streamName,
    ]);
    await this.retrySave(() =>
      enqueueFollowupPingsOnceAsync(
        operationId,
        [3, 7].map((days) => ({
          afterDate: addDays(answeredAt, days),
          streamName,
        })),
        this.expectedOwnerId,
      ),
    );
  }

  /** Wait for all accepted input and its resume snapshot before advancing. */
  onNextSelect(
    mode: "next" | "skip" | "preferNotToAnswer" = "next",
    generation: number = this.questionGeneration,
  ) {
    if (
      this.unmounted ||
      this.stoppedError !== null ||
      !this.initialResumeReady ||
      this.navigationPending ||
      generation !== this.questionGeneration
    )
      return;
    const date = new Date();
    if (!this.acceptsEventAt(date)) return;
    if (
      mode === "next" &&
      this.dataValidationFunction &&
      !this.dataValidationFunction()
    )
      return;
    this.navigationPending = true;
    this.setState({ isInTransition: true });
    const questionId = this.committedState.currentQuestionData.questionId;
    if (questionId === null) return;
    const question = this.props.questions[questionId];
    const realQuestionId = this.getRealQuestionId(
      question,
      this.committedState,
    );

    if (
      !NON_USER_QUESTION_TYPES.includes(question.type) &&
      (mode !== "next" ||
        (this.committedState.answers[realQuestionId] == null &&
          !this.acceptedAnswerIds.has(realQuestionId)))
    ) {
      this.acceptedAnswerIds.add(realQuestionId);
      void this.enqueueAcceptedAnswer(question, realQuestionId, {
        preferNotToAnswer: mode === "preferNotToAnswer" ? true : null,
        data: null,
        date,
      });
    }
    void this.enqueue(async () => {
      await this.scheduleFollowups(this.committedState);
      if (this.unmounted || this.stoppedError !== null) return;
      let nextState = this.nextStateAfter(this.committedState);
      const visited = new Set<string>();
      while (
        nextState.currentQuestionData.questionId !== null &&
        NON_USER_QUESTION_TYPES.includes(
          this.props.questions[nextState.currentQuestionData.questionId]?.type,
        )
      ) {
        const marker = JSON.stringify([
          nextState.currentQuestionData,
          nextState.nextQuestionsDataStack,
        ]);
        if (visited.has(marker))
          throw new Error("Survey branching contains a cycle.");
        visited.add(marker);
        nextState = this.nextStateAfter(nextState);
      }
      if (nextState.currentQuestionData.questionId === null) {
        nextState = {
          ...nextState,
          currentQuestionData: {
            questionId: null,
            extraData: {
              [COMPLETION_EVENT_KEY]: {
                version: 1,
                ownerId: this.expectedOwnerId,
                pingId: this.props.ping.id,
                questionId,
                requestedAt: date.toISOString(),
              },
            },
          },
        };
      }
      // Do not display the destination (or complete the ping) until it is durable.
      await this.retrySave(() =>
        storePingStateAsync(
          this.props.ping.id,
          nextState,
          this.expectedOwnerId,
        ),
      );
      if (this.unmounted) return;
      this.dataValidationFunction = null;
      this.questionGeneration += 1;
      this.navigationPending = false;
      this.applyCommittedState(nextState);
    });
    void this.enqueue(() => this.finishTerminalResume());
  }

  getRealQuestionId(
    question: Question,
    state: SurveyScreenState = this.state,
  ): string {
    return this.replacePlaceholders(
      question.id,
      state,
      question.defaultPlaceholderValues,
    );
  }

  private async saveAnswer(
    question: Question,
    realQuestionId: string,
    input: {
      preferNotToAnswer: true | null;
      data: AnswerData | null;
      date: Date;
    },
  ) {
    const answer = await this.retrySave(
      () =>
        insertAnswerAsync({
          ping: this.props.ping,
          question,
          realQuestionId,
          expectedOwnerId: this.expectedOwnerId,
          ...input,
        }),
      true,
    );
    if (this.unmounted) return;
    const state = {
      ...this.committedState,
      answers: { ...this.committedState.answers, [realQuestionId]: answer },
      isInTransition: false,
    };
    await this.retrySave(() =>
      storePingStateAsync(this.props.ping.id, state, this.expectedOwnerId),
    );
    if (!this.unmounted) this.applyCommittedState(state);
  }

  addAnswerToAnswersListAsync(
    question: Question,
    {
      preferNotToAnswer = null,
      data = null,
      date = new Date(),
    }: {
      preferNotToAnswer?: true | null;
      data?: AnswerData | null;
      date?: Date;
    },
    realQuestionId = this.getRealQuestionId(question, this.committedState),
    generation = this.questionGeneration,
  ): Promise<void> {
    if (
      this.unmounted ||
      this.stoppedError !== null ||
      !this.initialResumeReady ||
      this.navigationPending ||
      generation !== this.questionGeneration
    )
      return Promise.resolve();
    if (!this.acceptsEventAt(date)) return Promise.resolve();
    // Values and expanded IDs belong to the event, not to whichever repeated
    // question happens to be visible when the queued native write completes.
    const input = {
      preferNotToAnswer,
      data: cloneDeep(data),
      date: new Date(date.getTime()),
    };
    this.acceptedAnswerIds.add(realQuestionId);
    return this.enqueueAcceptedAnswer(question, realQuestionId, input);
  }

  dataValidationFunction: DataValidationFunction | null = null;
  render() {
    const {
      currentQuestionData: { questionId },
      answers,
      isInTransition,
    } = this.state;
    if (questionId === null) {
      // This is just here until `onFinish` is called.
      return <></>;
    }

    const { questions, studyInfo } = this.props;

    const question = questions[questionId] as Question;
    if (question === undefined) {
      return (
        <Text>
          {getCriticalProblemTextForUser(
            `questions["${questionId}"] === undefined`,
          )}
        </Text>
      );
    }
    const realQuestionId = this.getRealQuestionId(question);
    const generation = this.questionGeneration;
    const renderState = this.state;

    type QuestionScreenType = React.ElementType<QuestionScreenProps>;
    let QuestionScreen: QuestionScreenType;
    switch (question.type) {
      case QuestionType.ChoicesWithSingleAnswer:
      case QuestionType.ChoicesWithMultipleAnswers:
      case QuestionType.YesNo:
        QuestionScreen = ChoicesQuestionScreen as QuestionScreenType;
        break;

      case QuestionType.Slider:
        QuestionScreen = SliderQuestionScreen as QuestionScreenType;
        break;

      case QuestionType.MultipleText:
        QuestionScreen = MultipleTextQuestionScreen as QuestionScreenType;
        break;

      case QuestionType.HowLongAgo:
        QuestionScreen = HowLongAgoQuestionScreen as QuestionScreenType;
        break;

      default:
        if (NON_USER_QUESTION_TYPES.includes(question.type)) {
          return <></>;
        } else {
          // TODO: better error displaying.
          return <></>;
        }
    }

    const getImageIfAnyForPosition = (
      position: QuestionImageOptions["position"],
    ) =>
      question.image &&
      question.image.position === position && (
        <Image
          style={{
            margin: 5,
            alignSelf: "center",
            width: question.image.style.width as DimensionValue,
            height: question.image.style.height as DimensionValue,
            maxHeight: question.image.style.maxHeight,
            maxWidth: question.image.style.maxWidth,
            aspectRatio: question.image.style.aspectRatio,
          }}
          source={{
            uri: question.image.url,
          }}
        />
      );

    const nextButtonIsDisabled = (): boolean => {
      if (
        !this.initialResumeReady ||
        this.navigationPending ||
        this.stoppedError !== null
      )
        return true;
      if (studyInfo.alwaysEnableNextButton) {
        return false;
      }

      const answer = answers[realQuestionId];
      if (answer == null) {
        return true;
      }

      switch (question.type) {
        case QuestionType.MultipleText: {
          const mtAnswer = answer as MultipleTextAnswer;
          if (mtAnswer.data) {
            return mtAnswer.data.value.length === 0;
          }
          break;
        }

        default:
          break;
      }
      return false;
    };

    return (
      <View
        testID="mainSurveyScreenView"
        pointerEvents={
          !this.initialResumeReady ||
          this.navigationPending ||
          this.stoppedError !== null
            ? "none"
            : "auto"
        }
        style={{
          paddingHorizontal: 20,
          marginTop: 5,
          marginBottom: 10,
          flex: 1,
          // We use `opacity` so that `QuestionScreen` still loads and are able
          // to call `loadingCompleted` and set `isInTransition`.
          // We use 0.05 instead 0 so that if there's error, we can still see it.
          opacity: !this.initialResumeReady || isInTransition ? 0.025 : 1,
        }}
      >
        <View style={{ flex: 0 }}>
          <Text
            testID="questionTitle"
            style={{
              textAlign: "center",
              fontSize: 18,
            }}
          >
            {this.replacePlaceholders(
              question.question,
              this.state,
              question.defaultPlaceholderValues,
            )}
          </Text>
          {(question.description || question.image) && (
            <>
              <Text
                style={{
                  textAlign: "center",
                  color: "gray",
                  fontSize: 13,
                  marginTop: 5,
                  marginBottom: 2,
                }}
              >
                You may need to scroll to see the full description.
              </Text>
              <ScrollView
                style={{
                  marginBottom: 5,
                  maxHeight: Dimensions.get("window").height / 10,
                  borderWidth: 1,
                  borderColor: "lightgray",
                }}
              >
                {question.description && (
                  <Text
                    testID="questionDescription"
                    style={{
                      textAlign: "left",
                      padding: 5,
                    }}
                  >
                    {this.replacePlaceholders(
                      question.description,
                      this.state,
                      question.defaultPlaceholderValues,
                    )}
                  </Text>
                )}
                {getImageIfAnyForPosition("inDescriptionBox")}
              </ScrollView>
            </>
          )}
        </View>
        <View
          style={{
            // Change this to `1` if we always want the "Next" button to be on the bottom.
            flex: -1,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              flex: -1,
            }}
          >
            {getImageIfAnyForPosition("left")}
            <View style={{ flex: 1 }}>
              <QuestionScreen
                /* https://stackoverflow.com/a/21750576/2603230 */
                key={`${realQuestionId}:${generation}`}
                question={question}
                initialAnswer={answers[realQuestionId]}
                loadingCompleted={() => {
                  if (
                    !this.unmounted &&
                    this.initialResumeReady &&
                    !this.navigationPending &&
                    generation === this.questionGeneration
                  ) {
                    this.setState({ isInTransition: false });
                  }
                }}
                onDataChange={(data) => {
                  void this.addAnswerToAnswersListAsync(
                    question,
                    { data },
                    realQuestionId,
                    generation,
                  );
                }}
                allAnswers={answers}
                allQuestions={questions}
                pipeInExtraMetaData={(input) =>
                  this.replacePlaceholders(
                    input,
                    renderState,
                    question.defaultPlaceholderValues,
                  )
                }
                setDataValidationFunction={(func) => {
                  if (
                    !this.unmounted &&
                    generation === this.questionGeneration
                  ) {
                    this.dataValidationFunction = func;
                  }
                }}
              />
            </View>
          </View>
        </View>
        {question.extraCustomNextWithoutAnsweringButton && (
          <Button
            disabled={
              !this.initialResumeReady ||
              this.navigationPending ||
              this.stoppedError !== null
            }
            onPress={() => this.onNextSelect("skip", generation)}
            accessibilityLabel={question.extraCustomNextWithoutAnsweringButton}
            title={question.extraCustomNextWithoutAnsweringButton}
          />
        )}
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            marginTop: Platform.OS === "ios" ? 10 : 20,
            flex: 0,
          }}
        >
          <Button
            disabled={
              !this.initialResumeReady ||
              this.navigationPending ||
              this.stoppedError !== null
            }
            onPress={() => this.onNextSelect("preferNotToAnswer", generation)}
            accessibilityLabel="Prefer not to answer the current question"
            title="Prefer not to answer"
          />
          <Button
            disabled={nextButtonIsDisabled()}
            onPress={() => this.onNextSelect("next", generation)}
            accessibilityLabel="Next question"
            title="Next"
          />
        </View>
      </View>
    );
  }
}
