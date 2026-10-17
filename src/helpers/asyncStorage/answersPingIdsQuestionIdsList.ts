// Compatibility API. Answer bodies and indices commit in a single journal transaction.
import { Answer } from "@wellping/study-schemas/lib/answerTypes";
import { PingId, QuestionId } from "@wellping/study-schemas/lib/types";
import {
  getAnswersQuestionIdsForPingAsync,
  getJournalAnswerIdsAsync,
  removeJournalRecordsAsync,
  storeJournalAnswerAsync,
} from "../dataJournal";

export type AnswerPingIdQuestionId = [PingId, QuestionId];
export type AnswersPingIdsQuestionIdsList = AnswerPingIdQuestionId[];
export type AnswersQuestionIdsListForPing = QuestionId[];
export function addToAnswersQuestionIdsListForPingIfNeededAsync(
  answer: Answer,
): Promise<void> {
  return storeJournalAnswerAsync(answer);
}
export function clearAnswersQuestionIdsListForPingAsync(
  pingId: PingId,
): Promise<void> {
  return removeJournalRecordsAsync({
    pingId,
    allAnswers: false,
    answersForPing: true,
  });
}
export function getAnswersQuestionIdsListForPingAsync(
  pingId: PingId,
): Promise<AnswersQuestionIdsListForPing> {
  return getAnswersQuestionIdsForPingAsync(pingId);
}
export { getAnswersQuestionIdsForPingAsync };
export function getAnswersPingIdsQuestionIdsListAsync({
  unuploadedOnly = false,
}: { unuploadedOnly?: boolean } = {}): Promise<AnswersPingIdsQuestionIdsList> {
  return getJournalAnswerIdsAsync(unuploadedOnly);
}
export function clearAnswersPingIdsQuestionIdsListAsync(): Promise<void> {
  return removeJournalRecordsAsync({ allAnswers: true });
}
