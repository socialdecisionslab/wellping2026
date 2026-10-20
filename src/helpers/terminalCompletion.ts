import type { Ping, Streams } from "@wellping/study-schemas/lib/types";
import type { SurveyScreenState } from "../SurveyScreen";
import {
  captureCurrentDataOwnerAsync,
  assertDataOwnerAsync,
  completeJournalPingAsync,
} from "./dataJournal";
import { getPingsAsync } from "./pings";
import {
  getPingStateAsync,
  MissingResumeStateError,
} from "./asyncStorage/pingState";

export const COMPLETION_EVENT_KEY = "__wellpingCompletionEvent";
export function completionRequestedAt(
  ping: Ping,
  state: SurveyScreenState,
  ownerId: string | undefined,
  questions: Streams[string],
): Date {
  const event = state.currentQuestionData.extraData[COMPLETION_EVENT_KEY];
  // Older snapshots did not preserve the click time. Do not invent an earlier
  // time for them; the journal still enforces the original protocol deadline.
  if (event === undefined) return new Date();
  const date = new Date(event?.requestedAt);
  if (
    event === null ||
    typeof event !== "object" ||
    event.version !== 1 ||
    event.ownerId !== ownerId ||
    event.pingId !== ping.id ||
    typeof event.questionId !== "string" ||
    !Object.prototype.hasOwnProperty.call(questions, event.questionId) ||
    typeof event.requestedAt !== "string" ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString() !== event.requestedAt ||
    date.getTime() < ping.startTime.getTime() ||
    date.getTime() > Date.now() ||
    state.nextQuestionsDataStack.length !== 0
  ) {
    throw Object.assign(
      new Error("Invalid terminal completion event; data preserved."),
      {
        code: "INVALID_COMPLETION_EVENT",
      },
    );
  }
  return date;
}

/** Reconcile terminal evidence against the original instrument before expiry or replacement. */
export async function recoverTerminalCompletionsAsync(streams: Streams) {
  const owner = await captureCurrentDataOwnerAsync();
  for (const ping of await getPingsAsync()) {
    await assertDataOwnerAsync(owner);
    if (ping.endTime) continue;
    let state: SurveyScreenState;
    try {
      state = await getPingStateAsync(ping.id, owner.id);
    } catch (error) {
      if (error instanceof MissingResumeStateError) continue;
      throw error;
    }
    if (state.currentQuestionData.questionId !== null) continue;
    // Legacy snapshots cannot prove a pre-expiry completion; leave them to normal resume.
    if (state.currentQuestionData.extraData[COMPLETION_EVENT_KEY] === undefined)
      continue;
    const questions = streams[ping.streamName];
    if (!questions)
      throw new Error(
        "Original completion instrument is unavailable; data preserved.",
      );
    await completeJournalPingAsync(
      ping.id,
      completionRequestedAt(ping, state, owner.id, questions),
      owner.id,
    );
  }
  await assertDataOwnerAsync(owner);
}
