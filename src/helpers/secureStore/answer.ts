import { Answer } from "@wellping/study-schemas/lib/answerTypes";
import { PingId, QuestionId } from "@wellping/study-schemas/lib/types";
import {
  getJournalAnswerAsync,
  removeJournalRecordsAsync,
  storeJournalAnswerAsync,
} from "../dataJournal";

export function secureStoreAnswerAsync(
  answer: Answer,
  expectedOwnerId?: string,
): Promise<void> {
  return storeJournalAnswerAsync(answer, expectedOwnerId);
}
export function secureGetAnswerAsync(
  pingId: PingId,
  questionId: QuestionId,
): Promise<Answer | null> {
  return getJournalAnswerAsync(pingId, questionId);
}
export function secureRemoveAnswerAsync(
  pingId: PingId,
  questionId: QuestionId,
): Promise<void> {
  return removeJournalRecordsAsync({ pingId, questionId });
}
