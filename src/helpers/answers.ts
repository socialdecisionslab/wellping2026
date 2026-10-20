import { AnswerData, Answer } from "@wellping/study-schemas/lib/answerTypes";
import { AnswerSchema } from "@wellping/study-schemas/lib/schemas/Answer";
import { Question, Ping } from "@wellping/study-schemas/lib/types";

import {
  captureDataSnapshotAsync,
  removeJournalRecordsAsync,
} from "./dataJournal";
import { secureStoreAnswerAsync } from "./secureStore/answer";

export async function getAnswersAsync({
  unuploadedOnly = false,
}: {
  unuploadedOnly?: boolean;
} = {}): Promise<Answer[]> {
  return (await captureDataSnapshotAsync({ unuploadedOnly })).answers;
}

export async function insertAnswerAsync({
  ping,
  question,
  realQuestionId,
  preferNotToAnswer,
  data,
  date,
  expectedOwnerId,
}: {
  ping: Ping;
  question: Question;
  realQuestionId: string;
  preferNotToAnswer: true | null; // See `MARK: WHY_PNA_TRUE_OR_NULL`.
  data: AnswerData | null;
  date: Date;
  expectedOwnerId?: string;
}): Promise<Answer> {
  const answer = AnswerSchema.parse({
    pingId: ping.id,
    questionId: realQuestionId,
    preferNotToAnswer,
    data,
    date,
  });

  await secureStoreAnswerAsync(answer, expectedOwnerId);

  return answer;
}

export function clearAllAnswersAsync(): Promise<void> {
  return removeJournalRecordsAsync({ allAnswers: true });
}
