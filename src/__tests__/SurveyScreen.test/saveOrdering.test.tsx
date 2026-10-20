import React from "react";
import { Alert } from "react-native";
import { render, fireEvent, waitFor, act } from "@testing-library/react-native";
import SurveyScreen from "../../SurveyScreen";
import * as answers from "../../helpers/answers";
import { getPingStateAsync } from "../../helpers/asyncStorage/pingState";
import { QuestionType } from "../../helpers/helpers";
import { getBaseProps, setUpSurveyScreenTestAsync } from "./helper";

async function setup() {
  const ping = await setUpSurveyScreenTestAsync();
  const props = {
    ...getBaseProps(),
    ping,
    startingQuestionId: "q1",
    questions: {
      q1: {
        id: "q1",
        type: QuestionType.YesNo,
        question: "First",
        branchStartId: { yes: "yes", no: "no" },
        next: null,
      },
      yes: {
        id: "yes",
        type: QuestionType.YesNo,
        question: "Yes branch",
        next: null,
      },
      no: {
        id: "no",
        type: QuestionType.YesNo,
        question: "No branch",
        next: null,
      },
    },
  };
  const view = render(<SurveyScreen {...props} />);
  await waitFor(() =>
    expect(view.getByTestId("mainSurveyScreenView").props.pointerEvents).toBe(
      "auto",
    ),
  );
  return { ping, view };
}

test("immediate repeated Next waits for the final delayed answer and saves the correct branch", async () => {
  const { ping, view } = await setup();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = answers.insertAnswerAsync;
  jest
    .spyOn(answers, "insertAnswerAsync")
    .mockImplementationOnce(async (input) => {
      await gate;
      return original(input);
    });
  fireEvent.press(await view.findByLabelText("select Yes"));
  fireEvent.press(view.getByLabelText("Next question"));
  fireEvent.press(view.getByLabelText("Next question"));
  expect(view.getByTestId("questionTitle").props.children).toBe("First");
  await act(async () => {
    release();
  });
  await waitFor(() =>
    expect(view.getByTestId("questionTitle").props.children).toBe("Yes branch"),
  );
  await waitFor(async () =>
    expect(
      (
        await getPingStateAsync(ping.id)
      ).currentQuestionData.questionId,
    ).toBe("yes"),
  );
  expect((await answers.getAnswersAsync())[0].data).toEqual({ value: true });
});

test("failed answer save keeps the question and retry preserves the answer", async () => {
  const { view } = await setup();
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  jest
    .spyOn(answers, "insertAnswerAsync")
    .mockRejectedValueOnce(Error("disk unavailable"));
  fireEvent.press(await view.findByLabelText("select Yes"));
  await waitFor(() => expect(alert).toHaveBeenCalled());
  expect(view.getByTestId("questionTitle").props.children).toBe("First");
  await act(async () => {
    alert.mock.calls[0][2]![0].onPress!();
  });
  fireEvent.press(view.getByLabelText("Next question"));
  await waitFor(() =>
    expect(view.getByTestId("questionTitle").props.children).toBe("Yes branch"),
  );
});

test("queued slider values 10 then 90 survive unmount during the first insert", async () => {
  const ping = await setUpSurveyScreenTestAsync();
  const view = render(
    <SurveyScreen
      {...getBaseProps()}
      ping={ping}
      startingQuestionId="q1"
      questions={{
        q1: {
          id: "q1",
          type: QuestionType.Slider,
          question: "Slider",
          slider: ["left", "right"],
          next: null,
        },
      }}
    />,
  );
  await waitFor(() =>
    expect(view.getByTestId("mainSurveyScreenView").props.pointerEvents).toBe(
      "auto",
    ),
  );
  const {
    findSliderAsync,
    moveSlider,
  } = require("../reactNativeTestingLibraryHelper");
  const {
    waitForPendingSurveySavesAsync,
  } = require("../../helpers/surveyAnswerWrites");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = answers.insertAnswerAsync;
  const insert = jest
    .spyOn(answers, "insertAnswerAsync")
    .mockImplementationOnce(async (input) => {
      await gate;
      return original(input);
    });
  const slider = await findSliderAsync(view);
  moveSlider(slider, 10);
  moveSlider(slider, 90);
  await waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
  view.unmount();
  release();
  await waitForPendingSurveySavesAsync();
  expect(insert).toHaveBeenCalledTimes(2);
  expect((await answers.getAnswersAsync())[0].data).toEqual({ value: 90 });
  expect((await getPingStateAsync(ping.id)).answers.q1.data).toEqual({
    value: 90,
  });
});

test("forced-choice validation clears and persists invalid text before a second Next", async () => {
  const ping = await setUpSurveyScreenTestAsync();
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  const view = render(
    <SurveyScreen
      {...getBaseProps()}
      ping={ping}
      startingQuestionId="q1"
      questions={{
        q1: {
          id: "q1",
          type: QuestionType.MultipleText,
          question: "Forced choice",
          max: 1,
          indexName: "INDEX",
          variableName: "VALUE",
          dropdownChoices: { choices: ["Allowed"], forceChoice: true },
          next: "q2",
        },
        q2: {
          id: "q2",
          type: QuestionType.YesNo,
          question: "Second",
          next: null,
        },
      }}
    />,
  );
  await waitFor(() =>
    expect(view.getByTestId("mainSurveyScreenView").props.pointerEvents).toBe(
      "auto",
    ),
  );
  fireEvent.changeText(view.getByLabelText("text input 0"), "Invalid");
  fireEvent.press(view.getByLabelText("Next question"));
  await waitFor(() => expect(alert).toHaveBeenCalled());
  expect(view.getByTestId("questionTitle").props.children).toBe(
    "Forced choice",
  );
  await act(async () => {
    alert.mock.calls[0][2]?.[0]?.onPress?.();
  });
  fireEvent.press(view.getByLabelText("Next question"));
  await waitFor(() =>
    expect(view.getByTestId("questionTitle").props.children).toBe("Second"),
  );
  expect((await answers.getAnswersAsync())[0].data).toEqual({ value: [] });
  expect((await getPingStateAsync(ping.id)).answers.q1.data).toEqual({
    value: [],
  });
});
