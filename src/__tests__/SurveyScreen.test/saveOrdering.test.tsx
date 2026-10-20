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
  return { ping, view: render(<SurveyScreen {...props} />) };
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
