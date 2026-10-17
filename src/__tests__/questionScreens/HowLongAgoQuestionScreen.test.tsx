import {
  HowLongAgoAnswerDataType,
  HowLongAgoAnswerData,
} from "@wellping/study-schemas/lib/answerTypes";
import { HowLongAgoQuestion } from "@wellping/study-schemas/lib/types";
import React from "react";
import { Alert } from "react-native";
import {
  render,
  fireEvent,
  waitFor,
  RenderAPI,
} from "@testing-library/react-native";
import { ReactTestInstance } from "react-test-renderer";

import { QuestionType } from "../../helpers/helpers";
import HowLongAgoQuestionScreen from "../../questionScreens/HowLongAgoQuestion";
import { simplePipeInExtraMetaData } from "../helper";

const getSelectionA11YLabel = (option: string) => `select ${option}`;
const getSelection = (
  option: string,
  getAllByLabelText: RenderAPI["getAllByLabelText"],
) => {
  const selections = getAllByLabelText(getSelectionA11YLabel(option));
  expect(selections).toHaveLength(1);
  const selection = selections[0];
  return selection;
};

const basicTestForQuestionAsync = async (
  question: HowLongAgoQuestion,
  inputValues: HowLongAgoAnswerDataType,
) => {
  const mockLoadingCompleted = jest.fn();
  const mockOnDataChangeFn = jest.fn();
  const mockPipeInExtraMetaData = jest.fn(simplePipeInExtraMetaData);
  const mockSetDataValidationFunction = jest.fn();

  const renderResults = render(
    <HowLongAgoQuestionScreen
      realQuestionId={question.id}
      isDisabled={false}
      key={question.id}
      question={question}
      loadingCompleted={mockLoadingCompleted}
      onDataChange={mockOnDataChangeFn}
      allAnswers={{}}
      allQuestions={{ [question.id]: question }}
      pipeInExtraMetaData={mockPipeInExtraMetaData}
      setDataValidationFunction={mockSetDataValidationFunction}
    />,
  );
  const { getAllByLabelText, toJSON } = renderResults;

  expect(mockLoadingCompleted).toHaveBeenCalledTimes(1);

  // Because there isn't a need to pipe in any data.
  expect(mockPipeInExtraMetaData).not.toHaveBeenCalled();

  // There shouldn't need to be any validation
  expect(mockSetDataValidationFunction).not.toHaveBeenCalled();

  const selections = getAllByLabelText(/select (.*?)/);
  expect(selections).toHaveLength(10 + 4);

  let calledTimes = 0;
  if (inputValues[0]) {
    const leftSelection = getSelection(`${inputValues[0]}`, getAllByLabelText);
    fireEvent.press(leftSelection);

    calledTimes += 1;
    expect(mockOnDataChangeFn).toHaveBeenNthCalledWith(calledTimes, {
      value: [inputValues[0], null],
    } as HowLongAgoAnswerData);
    expect(mockOnDataChangeFn).toHaveBeenCalledTimes(calledTimes);
  }
  if (inputValues[1]) {
    const rightSelection = getSelection(`${inputValues[1]}`, getAllByLabelText);
    fireEvent.press(rightSelection);

    calledTimes += 1;
    expect(mockOnDataChangeFn).toHaveBeenNthCalledWith(calledTimes, {
      value: inputValues,
    } as HowLongAgoAnswerData);
    expect(mockOnDataChangeFn).toHaveBeenCalledTimes(calledTimes);
  }
  expect(mockOnDataChangeFn).toHaveBeenCalledTimes(calledTimes);

  return renderResults;
};

test.each([
  [null, null],
  [6, "days"],
  [2, "weeks"],
  [1, "months"],
  [null, "hours"],
])("input [%p, %p]", async (left, right) => {
  const question = {
    id: "HowLongAgoQuestion",
    type: QuestionType.HowLongAgo,
    question: "How long ago?",
    next: null,
  } as HowLongAgoQuestion;

  await basicTestForQuestionAsync(question, [left, right]);
});

test("disabled completed question cannot change either selection", () => {
  const question = {
    id: "disabledHowLongAgo",
    type: QuestionType.HowLongAgo,
    question: "How long ago?",
    next: null,
  } as HowLongAgoQuestion;
  const onDataChange = jest.fn();
  const screen = render(
    <HowLongAgoQuestionScreen
      realQuestionId={question.id}
      isDisabled={true}
      question={question}
      loadingCompleted={jest.fn()}
      onDataChange={onDataChange}
      allAnswers={{}}
      allQuestions={{ [question.id]: question }}
      pipeInExtraMetaData={jest.fn()}
      setDataValidationFunction={jest.fn()}
    />,
  );
  fireEvent.press(screen.getAllByLabelText("select 1")[0]);
  fireEvent.press(screen.getAllByLabelText("select days")[0]);
  expect(onDataChange).not.toHaveBeenCalled();
});
