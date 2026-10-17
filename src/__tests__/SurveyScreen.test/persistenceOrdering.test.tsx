import { Answer } from "@wellping/study-schemas/lib/answerTypes";
import { AnswerSchema } from "@wellping/study-schemas/lib/schemas/Answer";
import { Ping } from "@wellping/study-schemas/lib/types";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { Alert } from "react-native";

import SurveyScreen, {
  SurveyScreenProps,
  SurveyScreenState,
} from "../../SurveyScreen";
import { insertAnswerAsync } from "../../helpers/answers";
import {
  clearPingStateAsync,
  getPingStateAsync,
  storePingStateAsync,
} from "../../helpers/asyncStorage/pingState";
import { QuestionType } from "../../helpers/helpers";
import { getJournalPingExpiryAsync } from "../../helpers/dataJournal";
import { enqueueFollowupPingsOnceAsync } from "../../helpers/asyncStorage/futurePings";
import { addEndTimeToPingAsync } from "../../helpers/pings";
import { secureGetPingAsync } from "../../helpers/secureStore/ping";
import { waitForPendingSurveySavesAsync } from "../../helpers/surveyAnswerWrites";
import { PINGS, PINGS_STUDY_INFO } from "../data/pings";

jest.mock("../../helpers/dataJournal", () => ({
  getDataOwnerAsync: jest.fn(async () => ({ id: "owner-a" })),
  getJournalPingExpiryAsync: jest.fn(async () => null),
}));
jest.mock("../../helpers/studyFile", () => ({
  getReusableChoicesIncludeErrorAsync: jest.fn(),
}));
jest.mock("../../helpers/asyncStorage/futurePings", () => ({
  enqueueFollowupPingsOnceAsync: jest.fn(),
}));
jest.mock("../../helpers/answers", () => ({ insertAnswerAsync: jest.fn() }));
jest.mock("../../helpers/asyncStorage/pingState", () => ({
  storePingStateAsync: jest.fn(),
  getPingStateAsync: jest.fn(),
  clearPingStateAsync: jest.fn(),
}));
jest.mock("../../helpers/pings", () => ({ addEndTimeToPingAsync: jest.fn() }));
jest.mock("../../helpers/secureStore/ping", () => ({
  secureGetPingAsync: jest.fn(),
}));

const insert = jest.mocked(insertAnswerAsync);
const store = jest.mocked(storePingStateAsync);
const finish = jest.mocked(addEndTimeToPingAsync);
const clear = jest.mocked(clearPingStateAsync);
let ping: Ping;
let snapshots: SurveyScreenState[];
let initialResume: SurveyScreenState | null;
let durableAnswers: SurveyScreenState["answers"];

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}
async function ready(view: ReturnType<typeof render>) {
  await waitFor(() =>
    expect(view.getByTestId("mainSurveyScreenView").props.pointerEvents).toBe(
      "auto",
    ),
  );
}
function answerFor(input: Parameters<typeof insertAnswerAsync>[0]): Answer {
  const answer = AnswerSchema.parse({
    pingId: input.ping.id,
    questionId: input.realQuestionId,
    preferNotToAnswer: input.preferNotToAnswer,
    data: input.data,
    date: input.date,
  });
  durableAnswers[input.realQuestionId] = answer;
  return answer;
}
function props(overrides: Partial<SurveyScreenProps> = {}): SurveyScreenProps {
  if (overrides.previousState) initialResume = overrides.previousState;
  return {
    questions: {
      q1: { id: "q1", type: QuestionType.YesNo, question: "First", next: "q2" },
      q2: {
        id: "q2",
        type: QuestionType.YesNo,
        question: "Second",
        next: null,
      },
    },
    startingQuestionId: "q1",
    ping,
    previousState: null,
    studyInfo: { ...PINGS_STUDY_INFO, alwaysEnableNextButton: true },
    onFinish: jest.fn(),
    setUploadStatusSymbol: jest.fn(),
    ...overrides,
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getJournalPingExpiryAsync).mockResolvedValue(null);
  ping = { ...PINGS[0], endTime: null };
  snapshots = [];
  initialResume = null;
  durableAnswers = {};
  jest.mocked(getPingStateAsync).mockImplementation(async () => {
    const resume = snapshots.at(-1) ?? initialResume;
    if (!resume)
      throw Object.assign(new Error("No synthetic resume exists."), {
        code: "MISSING_RESUME_STATE",
      });
    return { ...resume, answers: { ...resume.answers, ...durableAnswers } };
  });
  insert.mockImplementation(async (input) => answerFor(input));
  store.mockImplementation(async (_, state) => {
    snapshots.push(state);
  });
  clear.mockResolvedValue(undefined);
  jest.mocked(enqueueFollowupPingsOnceAsync).mockResolvedValue(undefined);
  jest.mocked(secureGetPingAsync).mockImplementation(async () => ping);
  finish.mockImplementation(async (_, date) => {
    ping = { ...ping, endTime: date };
    return ping;
  });
});

test("Next waits for rapid inputs in order and the destination's durable snapshot", async () => {
  const inputGate = deferred();
  const navigationGate = deferred();
  insert.mockImplementationOnce(async (input) => {
    await inputGate.promise;
    return answerFor(input);
  });
  store.mockImplementation(async (_, state) => {
    if (state.currentQuestionData.questionId === "q2")
      await navigationGate.promise;
    snapshots.push(state);
  });
  const view = render(<SurveyScreen {...props()} />);
  await ready(view);
  fireEvent.press(view.getByLabelText("select Yes"));
  fireEvent.press(view.getByLabelText("select No"));
  fireEvent.press(view.getByLabelText("Next question"));
  fireEvent.press(view.getByLabelText("Next question"));
  await flush();
  expect(insert).toHaveBeenCalledTimes(1);
  expect(view.getByTestId("questionTitle").props.children).toBe("First");
  await act(async () => {
    inputGate.resolve();
  });
  expect(insert).toHaveBeenCalledTimes(2);
  expect(insert.mock.calls.map(([input]) => input.data)).toEqual([
    { value: true },
    { value: false },
  ]);
  expect(view.getByTestId("questionTitle").props.children).toBe("First");
  expect(snapshots.at(-1)?.answers.q1.data).toEqual({ value: false });
  await act(async () => {
    navigationGate.resolve();
  });
  expect(view.getByTestId("questionTitle").props.children).toBe("Second");
  expect(finish).not.toHaveBeenCalled();
  expect(insert).toHaveBeenCalledTimes(2);
});

test("input snapshots are durable without navigating, so interruption can restore the selection", async () => {
  const first = render(<SurveyScreen {...props()} />);
  await ready(first);
  fireEvent.press(first.getByLabelText("select No"));
  await waitFor(() =>
    expect(snapshots.at(-1)?.answers.q1.data).toEqual({ value: false }),
  );
  const saved = snapshots.at(-1)!;
  first.unmount();
  const second = render(<SurveyScreen {...props({ previousState: saved })} />);
  await ready(second);
  expect(second.getByLabelText("select No").props.style.backgroundColor).toBe(
    "#b3995d",
  );
  expect(insert).toHaveBeenCalledTimes(1);
});

test("recoverable input failure blocks navigation and Retry saves the same captured value", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  insert.mockRejectedValueOnce(new Error("disk temporarily unavailable"));
  const view = render(<SurveyScreen {...props()} />);
  await ready(view);
  fireEvent.press(view.getByLabelText("select Yes"));
  fireEvent.press(view.getByLabelText("Next question"));
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
  expect(view.getByTestId("questionTitle").props.children).toBe("First");
  expect(
    store.mock.calls.some(
      ([, state]) => state.currentQuestionData.questionId === "q2",
    ),
  ).toBe(false);
  await act(async () => {
    alert.mock.calls[0][2]![0].onPress!();
  });
  expect(view.getByTestId("questionTitle").props.children).toBe("Second");
  expect(insert).toHaveBeenCalledTimes(2);
  expect(insert.mock.calls[0][0]).toEqual(insert.mock.calls[1][0]);
});

test("resume-save failure retries only the snapshot and cannot expose the next question", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  let fail = true;
  store.mockImplementation(async (_, state) => {
    if (state.currentQuestionData.questionId === "q2" && fail) {
      fail = false;
      throw new Error("secure store unavailable");
    }
    snapshots.push(state);
  });
  const view = render(<SurveyScreen {...props()} />);
  await ready(view);
  fireEvent.press(view.getByLabelText("select Yes"));
  fireEvent.press(view.getByLabelText("Next question"));
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
  expect(view.getByTestId("questionTitle").props.children).toBe("First");
  expect(insert).toHaveBeenCalledTimes(1);
  await act(async () => {
    alert.mock.calls[0][2]![0].onPress!();
  });
  expect(view.getByTestId("questionTitle").props.children).toBe("Second");
  expect(insert).toHaveBeenCalledTimes(1);
});

test.each(["Prefer not to answer the current question", "Skip this question"])(
  "%s supersedes pending input once and never writes to the following question",
  async (button) => {
    const gate = deferred();
    insert.mockImplementationOnce(async (input) => {
      await gate.promise;
      return answerFor(input);
    });
    const p = props();
    p.questions.q1.extraCustomNextWithoutAnsweringButton = "Skip this question";
    const view = render(<SurveyScreen {...p} />);
    await ready(view);
    fireEvent.press(view.getByLabelText("select Yes"));
    fireEvent.press(view.getByLabelText(button));
    fireEvent.press(view.getByLabelText(button));
    await flush();
    await act(async () => {
      gate.resolve();
    });
    expect(view.getByTestId("questionTitle").props.children).toBe("Second");
    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert.mock.calls[1][0]).toMatchObject({
      realQuestionId: "q1",
      data: null,
      preferNotToAnswer: button.startsWith("Prefer") ? true : null,
    });
  },
);

test("closing during a pending write drains accepted answers but cancels navigation and resume writes", async () => {
  const gate = deferred();
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  insert.mockImplementationOnce(async (input) => {
    await gate.promise;
    return answerFor(input);
  });
  const p = props();
  const view = render(<SurveyScreen {...p} />);
  await ready(view);
  fireEvent.press(view.getByLabelText("select Yes"));
  fireEvent.press(view.getByLabelText("select No"));
  fireEvent.press(view.getByLabelText("Next question"));
  await flush();
  view.unmount();
  await act(async () => {
    gate.resolve();
  });
  expect(insert).toHaveBeenCalledTimes(2);
  expect(insert.mock.calls.map(([input]) => input.data)).toEqual([
    { value: true },
    { value: false },
  ]);
  expect(
    insert.mock.calls.every(([input]) => input.expectedOwnerId === "owner-a"),
  ).toBe(true);
  expect(store).toHaveBeenCalledTimes(1);
  expect(finish).not.toHaveBeenCalled();
  expect(p.onFinish).not.toHaveBeenCalled();
  expect(alert).not.toHaveBeenCalled();
});

test("closing a failed save drains the accepted answer once and ignores stale Retry", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  insert.mockRejectedValueOnce(new Error("temporarily unavailable"));
  const view = render(<SurveyScreen {...props()} />);
  await ready(view);
  fireEvent.press(view.getByLabelText("select Yes"));
  await waitFor(() => expect(alert).toHaveBeenCalled());
  const retry = alert.mock.calls[0][2]![0].onPress!;
  view.unmount();
  await act(async () => {
    retry();
  });
  expect(insert).toHaveBeenCalledTimes(2);
  await act(async () => {
    retry();
  });
  expect(insert).toHaveBeenCalledTimes(2);
  expect(store).toHaveBeenCalledTimes(1);
});

test("expanded IDs and mutable input belong to the event, and repeated questions remount", async () => {
  const ref = React.createRef<SurveyScreen>();
  const state: SurveyScreenState = {
    currentQuestionData: {
      questionId: "item_[__INDEX__]",
      extraData: { INDEX: 1 },
    },
    nextQuestionsDataStack: [
      { questionId: "item_[__INDEX__]", extraData: { INDEX: 2 } },
    ],
    answers: {},
    isInTransition: false,
  };
  const question = {
    id: "item_[__INDEX__]",
    type: QuestionType.MultipleText,
    question: "Item [__INDEX__]",
    max: 1,
    variableName: "ITEM",
    indexName: "INDEX",
    next: null,
  } as const;
  const view = render(
    <SurveyScreen
      ref={ref}
      {...props({
        questions: { [question.id]: question },
        previousState: state,
      })}
    />,
  );
  await ready(view);
  const input = { value: ["original"] };
  let save!: Promise<void>;
  act(() => {
    save = ref.current!.addAnswerToAnswersListAsync(question, { data: input });
  });
  input.value[0] = "mutated later";
  fireEvent.press(view.getByLabelText("Next question"));
  await act(async () => {
    await save;
  });
  await flush();
  expect(insert.mock.calls[0][0]).toMatchObject({
    realQuestionId: "item_1",
    data: { value: ["original"] },
  });
  expect(view.getByTestId("questionTitle").props.children).toBe("Item 2");
  expect(view.getByLabelText("text input 0").props.defaultValue).toBe("");
  expect(state.nextQuestionsDataStack).toHaveLength(1);
});

test("terminal completion waits for the terminal snapshot and retries without a duplicate end time", async () => {
  const gate = deferred();
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  store.mockImplementation(async (_, state) => {
    if (state.currentQuestionData.questionId === null) await gate.promise;
    snapshots.push(state);
  });
  clear.mockRejectedValueOnce(new Error("cleanup temporarily unavailable"));
  const p = props({
    questions: {
      q1: { id: "q1", type: QuestionType.YesNo, question: "Last", next: null },
    },
  });
  const view = render(<SurveyScreen {...p} />);
  await ready(view);
  fireEvent.press(view.getByLabelText("select Yes"));
  fireEvent.press(view.getByLabelText("Next question"));
  await flush();
  expect(finish).not.toHaveBeenCalled();
  expect(p.onFinish).not.toHaveBeenCalled();
  expect(view.getByTestId("questionTitle").props.children).toBe("Last");
  await act(async () => {
    gate.resolve();
  });
  expect(finish).toHaveBeenCalledTimes(1);
  expect(finish.mock.calls[0][2]).toBe("owner-a");
  expect(secureGetPingAsync).toHaveBeenCalledWith(ping.id, "owner-a");
  expect(p.onFinish).not.toHaveBeenCalled();
  const endTime = ping.endTime;
  await act(async () => {
    alert.mock.calls[0][2]![0].onPress!();
  });
  expect(finish).toHaveBeenCalledTimes(1);
  expect(p.onFinish).toHaveBeenCalledTimes(1);
  expect(ping.endTime).toBe(endTime);
});

test("restored terminal snapshot completes once without rewriting existing end time", async () => {
  ping = { ...ping, endTime: new Date(123456) };
  const p = props({
    previousState: {
      currentQuestionData: { questionId: null, extraData: {} },
      nextQuestionsDataStack: [],
      answers: {},
      isInTransition: true,
    },
  });
  render(<SurveyScreen {...p} />);
  await waitFor(() => expect(p.onFinish).toHaveBeenCalledWith(ping));
  expect(finish).not.toHaveBeenCalled();
  expect(clear).toHaveBeenCalledTimes(1);
  expect(clear).toHaveBeenCalledWith(ping.id, "owner-a");
  expect(getPingStateAsync).toHaveBeenCalledWith(ping.id, "owner-a");
  expect(store.mock.calls.every(([, , owner]) => owner === "owner-a")).toBe(
    true,
  );
  expect(p.onFinish).toHaveBeenCalledWith(ping);
});

test("followup scheduling is awaited as one stable retryable pair before navigation", async () => {
  const followups = jest.mocked(enqueueFollowupPingsOnceAsync);
  const gate = deferred();
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  followups.mockRejectedValueOnce(new Error("temporary scheduling failure"));
  followups.mockImplementationOnce(async () => {
    await gate.promise;
  });
  const p = props();
  p.questions.q1 = {
    ...p.questions.q1,
    addFollowupStream: { yes: "followup" },
  } as typeof p.questions.q1;
  const view = render(<SurveyScreen {...p} />);
  await ready(view);
  fireEvent.press(view.getByLabelText("select Yes"));
  fireEvent.press(view.getByLabelText("Next question"));
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
  expect(view.getByTestId("questionTitle").props.children).toBe("First");
  await act(async () => {
    alert.mock.calls[0][2]![0].onPress!();
  });
  expect(view.getByTestId("questionTitle").props.children).toBe("First");
  expect(followups).toHaveBeenCalledTimes(2);
  expect(followups.mock.calls[1]).toEqual(followups.mock.calls[0]);
  const [operationId, pair, ownerId] = followups.mock.calls[0];
  expect(ownerId).toBe("owner-a");
  expect(JSON.parse(operationId)).toEqual([ping.id, "q1", "followup"]);
  expect(pair).toHaveLength(2);
  expect(pair.map((item) => item.streamName)).toEqual(["followup", "followup"]);
  expect(pair[1].afterDate.getTime() - pair[0].afterDate.getTime()).toBe(
    4 * 24 * 60 * 60 * 1000,
  );
  await act(async () => {
    gate.resolve();
  });
  expect(view.getByTestId("questionTitle").props.children).toBe("Second");
  expect(insert).toHaveBeenCalledTimes(1);
});

test("cancelled validation does not write or navigate", async () => {
  const ref = React.createRef<SurveyScreen>();
  const view = render(<SurveyScreen ref={ref} {...props()} />);
  await ready(view);
  ref.current!.dataValidationFunction = () => false;
  fireEvent.press(view.getByLabelText("Next question"));
  await flush();
  expect(insert).not.toHaveBeenCalled();
  expect(store).toHaveBeenCalledTimes(1);
  expect(view.getByTestId("questionTitle").props.children).toBe("First");
});

test("text immediately followed by Next is saved before navigation without a timer gap", async () => {
  const p = props();
  p.questions.q1 = {
    id: "q1",
    type: QuestionType.MultipleText,
    question: "First",
    max: 2,
    variableName: "ITEM",
    indexName: "INDEX",
    next: "q2",
  };
  const view = render(<SurveyScreen {...p} />);
  await ready(view);
  act(() => {
    fireEvent.changeText(view.getByLabelText("text input 0"), "first value");
    fireEvent.changeText(view.getByLabelText("text input 1"), "second value");
    fireEvent.press(view.getByLabelText("Next question"));
  });
  await flush();
  expect(view.getByTestId("questionTitle").props.children).toBe("Second");
  expect(insert).toHaveBeenCalledTimes(2);
  expect(insert.mock.calls[1][0]).toMatchObject({
    realQuestionId: "q1",
    data: { value: ["first value", "second value"] },
  });
  expect(snapshots.at(-1)?.answers.q1.data).toEqual({
    value: ["first value", "second value"],
  });
});

test("dropdown selection immediately followed by Next is not deferred or discarded", async () => {
  const p = props();
  p.questions.q1 = {
    id: "q1",
    type: QuestionType.MultipleText,
    question: "First",
    max: 1,
    variableName: "ITEM",
    indexName: "INDEX",
    next: "q2",
    dropdownChoices: {
      choices: ["Choice A", "Choice B"],
      forceChoice: true,
      alwaysShowChoices: true,
    },
  };
  const view = render(<SurveyScreen {...p} />);
  await ready(view);
  fireEvent(view.getByLabelText("text input 0"), "focus");
  act(() => {
    fireEvent.press(view.getByText("Choice B"));
    fireEvent.press(view.getByLabelText("Next question"));
  });
  await flush();
  expect(view.getByTestId("questionTitle").props.children).toBe("Second");
  expect(insert).toHaveBeenCalledTimes(1);
  expect(insert.mock.calls[0][0]).toMatchObject({
    realQuestionId: "q1",
    data: { value: ["Choice B"] },
  });
});

test("callbacks retained from an earlier question cannot write or navigate the new question", async () => {
  const ref = React.createRef<SurveyScreen>();
  const p = props();
  const view = render(<SurveyScreen ref={ref} {...p} />);
  await ready(view);
  fireEvent.press(view.getByLabelText("select Yes"));
  fireEvent.press(view.getByLabelText("Next question"));
  await flush();
  await act(async () => {
    await ref.current!.addAnswerToAnswersListAsync(
      p.questions.q1,
      { data: { value: false } },
      "q1",
      0,
    );
    ref.current!.onNextSelect("preferNotToAnswer", 0);
  });
  expect(insert).toHaveBeenCalledTimes(1);
  expect(view.getByTestId("questionTitle").props.children).toBe("Second");
  expect(p.onFinish).not.toHaveBeenCalled();
});

test("same-batch multi-choice toggles retain both values before immediate Next", async () => {
  const p = props();
  p.questions.q1 = {
    id: "q1",
    type: QuestionType.ChoicesWithMultipleAnswers,
    question: "First",
    choices: ["A", "B", "C"],
    next: "q2",
  };
  const view = render(<SurveyScreen {...p} />);
  await ready(view);
  act(() => {
    fireEvent.press(view.getByLabelText("select A"));
    fireEvent.press(view.getByLabelText("select B"));
    fireEvent.press(view.getByLabelText("Next question"));
  });
  await flush();
  expect(snapshots.at(-1)?.answers.q1.data).toEqual({
    value: [
      ["A", true],
      ["B", true],
      ["C", false],
    ],
  });
  expect(view.getByTestId("questionTitle").props.children).toBe("Second");
});

test("same-batch how-long-ago choices retain both columns before immediate Next", async () => {
  const p = props();
  p.questions.q1 = {
    id: "q1",
    type: QuestionType.HowLongAgo,
    question: "First",
    next: "q2",
  };
  const view = render(<SurveyScreen {...p} />);
  await ready(view);
  act(() => {
    fireEvent.press(view.getByLabelText("select 2"));
    fireEvent.press(view.getByLabelText("select days"));
    fireEvent.press(view.getByLabelText("Next question"));
  });
  await flush();
  expect(snapshots.at(-1)?.answers.q1.data).toEqual({ value: [2, "days"] });
  expect(view.getByTestId("questionTitle").props.children).toBe("Second");
});

test("initial resume must be durable before any input is accepted", async () => {
  const gate = deferred();
  store.mockImplementationOnce(async (_, state) => {
    await gate.promise;
    snapshots.push(state);
  });
  const ref = React.createRef<SurveyScreen>();
  const p = props();
  const view = render(<SurveyScreen ref={ref} {...p} />);
  await flush();
  expect(view.getByTestId("mainSurveyScreenView").props.pointerEvents).toBe(
    "none",
  );
  await act(async () => {
    await ref.current!.addAnswerToAnswersListAsync(p.questions.q1, {
      data: { value: true },
    });
    ref.current!.onNextSelect();
  });
  expect(insert).not.toHaveBeenCalled();
  await act(async () => {
    gate.resolve();
  });
  expect(view.getByTestId("mainSurveyScreenView").props.pointerEvents).toBe(
    "auto",
  );
  fireEvent.press(view.getByLabelText("select Yes"));
  await flush();
  expect(insert).toHaveBeenCalledTimes(1);
});

test.each(["Prefer not to answer the current question", "Skip this question"])(
  "an accepted %s response survives expiration without advancing",
  async (button) => {
    const gate = deferred();
    insert.mockImplementationOnce(async (input) => {
      await gate.promise;
      return answerFor(input);
    });
    const p = props();
    p.questions.q1.extraCustomNextWithoutAnsweringButton = "Skip this question";
    const ref = React.createRef<SurveyScreen>();
    const view = render(<SurveyScreen ref={ref} {...p} />);
    await ready(view);
    const instance = ref.current!;
    fireEvent.press(view.getByLabelText("select Yes"));
    fireEvent.press(view.getByLabelText(button));
    await flush();
    view.unmount();
    await act(async () => {
      await instance.addAnswerToAnswersListAsync(p.questions.q1, {
        data: { value: false },
      });
      instance.onNextSelect();
      gate.resolve();
    });
    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert.mock.calls[1][0]).toMatchObject({
      realQuestionId: "q1",
      data: null,
      preferNotToAnswer: button.startsWith("Prefer") ? true : null,
      expectedOwnerId: "owner-a",
    });
    expect(store).toHaveBeenCalledTimes(1);
    expect(finish).not.toHaveBeenCalled();
    expect(p.onFinish).not.toHaveBeenCalled();
  },
);

test.each([true, false])(
  "immediate same-ping remount waits and hydrates accepted answers (previous snapshot supplied: %s)",
  async (supplySnapshot) => {
    const gate = deferred();
    insert.mockImplementationOnce(async (input) => {
      await gate.promise;
      return answerFor(input);
    });
    const first = render(<SurveyScreen {...props()} />);
    await ready(first);
    fireEvent.press(first.getByLabelText("select Yes"));
    fireEvent.press(first.getByLabelText("select No"));
    await flush();
    const staleSnapshot = snapshots.at(-1)!;
    first.unmount();
    const second = render(
      <SurveyScreen
        {...props({ previousState: supplySnapshot ? staleSnapshot : null })}
      />,
    );
    await flush();
    expect(second.getByTestId("mainSurveyScreenView").props.pointerEvents).toBe(
      "none",
    );
    expect(insert).toHaveBeenCalledTimes(1);
    expect(store).toHaveBeenCalledTimes(1);
    await act(async () => {
      gate.resolve();
    });
    expect(insert).toHaveBeenCalledTimes(2);
    expect(second.getByTestId("mainSurveyScreenView").props.pointerEvents).toBe(
      "auto",
    );
    expect(second.getByLabelText("select No").props.style.backgroundColor).toBe(
      "#b3995d",
    );
    expect(snapshots.at(-1)?.answers.q1.data).toEqual({ value: false });
    fireEvent.press(second.getByLabelText("select Yes"));
    await flush();
    expect(insert.mock.calls.map(([input]) => input.data)).toEqual([
      { value: true },
      { value: false },
      { value: true },
    ]);
    expect(durableAnswers.q1.data).toEqual({ value: true });
    expect(snapshots.at(-1)?.answers.q1.data).toEqual({ value: true });
    expect(finish).not.toHaveBeenCalled();
  },
);

test("expired late input stops navigation without poisoning earlier accepted-save drains", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  const ref = React.createRef<SurveyScreen>();
  const p = props();
  const view = render(<SurveyScreen ref={ref} {...p} />);
  await ready(view);
  fireEvent.press(view.getByLabelText("select Yes"));
  await flush();
  insert.mockRejectedValueOnce(
    Object.assign(new Error("expired"), { code: "PING_EXPIRED" }),
  );
  fireEvent.press(view.getByLabelText("select No"));
  fireEvent.press(view.getByLabelText("Next question"));
  await flush();
  expect(alert).toHaveBeenCalledTimes(1);
  expect(alert.mock.calls[0][0]).toBe("Survey window ended");
  expect(alert.mock.calls[0][1]).toContain(
    "earlier saved responses have been preserved",
  );
  expect(alert.mock.calls[0][2]!.map((button) => button.text)).toEqual(["OK"]);
  expect(snapshots.at(-1)?.answers.q1.data).toEqual({ value: true });
  expect(view.getByTestId("questionTitle").props.children).toBe("First");
  expect(view.getByTestId("mainSurveyScreenView").props.pointerEvents).toBe(
    "none",
  );
  await act(async () => {
    await ref.current!.addAnswerToAnswersListAsync(p.questions.q1, {
      data: { value: true },
    });
    ref.current!.onNextSelect();
    await waitForPendingSurveySavesAsync();
  });
  expect(insert).toHaveBeenCalledTimes(2);
  expect(finish).not.toHaveBeenCalled();
  expect(p.onFinish).not.toHaveBeenCalled();
});

test("an expired event rejected after unmount does not leave a permanent failed drain", async () => {
  const gate = deferred();
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  insert.mockImplementationOnce(async () => {
    await gate.promise;
    throw Object.assign(new Error("expired"), { code: "PING_EXPIRED" });
  });
  const view = render(<SurveyScreen {...props()} />);
  await ready(view);
  fireEvent.press(view.getByLabelText("select Yes"));
  await flush();
  view.unmount();
  await act(async () => {
    gate.resolve();
    await waitForPendingSurveySavesAsync();
  });
  expect(insert).toHaveBeenCalledTimes(1);
  expect(store).toHaveBeenCalledTimes(1);
  expect(alert).not.toHaveBeenCalled();
});

test("owner mismatch is not retried into another session or silently discarded", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  insert.mockRejectedValue(
    Object.assign(new Error("owner changed"), { code: "OWNER_CHANGED" }),
  );
  const view = render(<SurveyScreen {...props()} />);
  await ready(view);
  fireEvent.press(view.getByLabelText("select Yes"));
  fireEvent.press(view.getByLabelText("Next question"));
  await flush();
  expect(insert).toHaveBeenCalledTimes(1);
  expect(alert.mock.calls[0][0]).toBe("Survey needs recovery");
  expect(view.getByTestId("questionTitle").props.children).toBe("First");
  view.unmount();
  await expect(waitForPendingSurveySavesAsync()).rejects.toMatchObject({
    code: "OWNER_CHANGED",
  });
  expect(
    insert.mock.calls.every(([input]) => input.expectedOwnerId === "owner-a"),
  ).toBe(true);
  // Simulate recovery of the original owner; no queued value is lost.
  insert.mockImplementation(async (input) => answerFor(input));
  await waitForPendingSurveySavesAsync();
  expect(durableAnswers.q1.data).toEqual({ value: true });
  expect(store).toHaveBeenCalledTimes(1);
});

test("terminal completion preserves final Next event time across storage delay and restart", async () => {
  const gate = deferred();
  const p = props({
    questions: {
      q1: { id: "q1", type: QuestionType.YesNo, question: "Last", next: null },
    },
  });
  store.mockImplementation(async (_, state) => {
    snapshots.push(state);
    if (state.currentQuestionData.questionId === null) await gate.promise;
  });
  const view = render(<SurveyScreen {...p} />);
  await ready(view);
  fireEvent.press(view.getByLabelText("select Yes"));
  fireEvent.press(view.getByLabelText("Next question"));
  await flush();
  const terminal = snapshots.at(-1)!;
  const event =
    terminal.currentQuestionData.extraData.__wellpingCompletionEvent;
  expect(event).toMatchObject({
    version: 1,
    ownerId: "owner-a",
    pingId: ping.id,
    questionId: "q1",
  });
  expect(finish).not.toHaveBeenCalled();
  view.unmount();
  await act(async () => {
    gate.resolve();
  });
  render(<SurveyScreen {...props({ ...p, previousState: terminal })} />);
  await flush();
  expect(finish).toHaveBeenCalledTimes(1);
  expect(finish.mock.calls[0][1].toISOString()).toBe(event.requestedAt);
  expect(p.onFinish).toHaveBeenCalledTimes(1);
});

test.each([
  { requestedAt: "not-a-date" },
  { requestedAt: "2999-01-01T00:00:00.000Z" },
  { requestedAt: "1999-01-01T00:00:00.000Z" },
  { ownerId: "another-owner" },
  { pingId: "another-ping" },
  { questionId: "unknown-question" },
])(
  "terminal recovery refuses an unverified completion event: %p",
  async (invalid) => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const p = props({
      previousState: {
        currentQuestionData: {
          questionId: null,
          extraData: {
            __wellpingCompletionEvent: {
              version: 1,
              ownerId: "owner-a",
              pingId: ping.id,
              questionId: "q1",
              requestedAt: new Date().toISOString(),
              ...invalid,
            },
          },
        },
        nextQuestionsDataStack: [],
        answers: {},
        isInTransition: false,
      },
    });
    render(<SurveyScreen {...p} />);
    await flush();
    expect(finish).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(p.onFinish).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][0]).toBe("Survey needs recovery");
  },
);

test("persisted expiry allows the exact deadline, rejects the next millisecond, and drains earlier input", async () => {
  const deadline = new Date("2026-01-01T00:00:00.000Z");
  jest.mocked(getJournalPingExpiryAsync).mockResolvedValue(deadline);
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  const gate = deferred();
  insert.mockImplementationOnce(async (input) => {
    await gate.promise;
    return answerFor(input);
  });
  const ref = React.createRef<SurveyScreen>();
  const p = props();
  const view = render(<SurveyScreen ref={ref} {...p} />);
  await ready(view);
  expect(getJournalPingExpiryAsync).toHaveBeenCalledWith(ping.id, "owner-a");
  act(() => {
    void ref.current!.addAnswerToAnswersListAsync(p.questions.q1, {
      data: { value: true },
      date: deadline,
    });
    void ref.current!.addAnswerToAnswersListAsync(p.questions.q1, {
      data: { value: false },
      date: new Date(deadline.getTime() + 1),
    });
  });
  await flush();
  expect(insert).toHaveBeenCalledTimes(1);
  expect(insert.mock.calls[0][0].date.getTime()).toBe(deadline.getTime());
  expect(alert.mock.calls[0][0]).toBe("Survey window ended");
  view.unmount();
  await act(async () => {
    gate.resolve();
    await waitForPendingSurveySavesAsync();
  });
  expect(durableAnswers.q1.data).toEqual({ value: true });
  expect(store).toHaveBeenCalledTimes(1);
});

test.each(["next", "skip", "preferNotToAnswer"] as const)(
  "an expired %s event does not enter the accepted-save or navigation lane",
  async (mode) => {
    jest.mocked(getJournalPingExpiryAsync).mockResolvedValue(new Date(0));
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const ref = React.createRef<SurveyScreen>();
    const p = props();
    render(<SurveyScreen ref={ref} {...p} />);
    await flush();
    await act(async () => {
      ref.current!.onNextSelect(mode);
      await waitForPendingSurveySavesAsync();
    });
    expect(insert).not.toHaveBeenCalled();
    expect(store).toHaveBeenCalledTimes(1);
    expect(finish).not.toHaveBeenCalled();
    expect(p.onFinish).not.toHaveBeenCalled();
    expect(alert.mock.calls[0][0]).toBe("Survey window ended");
  },
);
