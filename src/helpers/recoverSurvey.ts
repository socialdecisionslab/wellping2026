import { withDataLock } from "./dataLock";
import { getPingStateAsync } from "./asyncStorage/pingState";
import type { Answer } from "@wellping/study-schemas/lib/answerTypes";
import { getAnswersQuestionIdsListForPingAsync } from "./asyncStorage/answersPingIdsQuestionIdsList";
import { secureGetAnswerAsync } from "./secureStore/answer";

async function getAnswersQuestionIdsForPingRecoveryAsync(
  pingId: string,
): Promise<Record<string, Answer>> {
  const answers: Record<string, Answer> = {};
  for (const questionId of await getAnswersQuestionIdsListForPingAsync(
    pingId,
  )) {
    const answer = await secureGetAnswerAsync(pingId, questionId);
    if (!answer)
      throw new Error(
        "A saved response is incomplete. Data preserved for recovery.",
      );
    answers[questionId] = answer;
  }
  return answers;
}

/** Reconcile an interrupted answer-to-resume write before rendering old defaults. */
export function recoverSurveyAsync(pingId: string) {
  return withDataLock(async () => {
    // Validate session ownership before reading any response records.
    const state = await getPingStateAsync(pingId);
    const answers = await getAnswersQuestionIdsForPingRecoveryAsync(pingId);
    return {
      ...state,
      answers: { ...state.answers, ...answers },
      isInTransition: false,
    };
  });
}
