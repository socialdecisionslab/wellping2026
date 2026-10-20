import Slider from "@react-native-community/slider";
import {
  Answer,
  AnswerData,
  ChoicesWithMultipleAnswersAnswerChoices,
  HowLongAgoAnswerDataType,
} from "@wellping/study-schemas/lib/answerTypes";
import {
  ChoicesWithMultipleAnswersQuestion,
  ChoicesWithSingleAnswerQuestion,
  HowLongAgoQuestion,
  MultipleTextQuestion,
  SliderQuestion,
  YesNoQuestion,
} from "@wellping/study-schemas/lib/types";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";

import * as helpers from "../../helpers/helpers";
import { QuestionType } from "../../helpers/helpers";
import ChoicesQuestionScreen from "../../questionScreens/ChoicesQuestionScreen";
import HowLongAgoQuestionScreen from "../../questionScreens/HowLongAgoQuestion";
import MultipleTextQuestionScreen from "../../questionScreens/MultipleTextQuestionScreen";
import SliderQuestionScreen from "../../questionScreens/SliderQuestionScreen";
import {
  findSliderAsync,
  moveSlider,
} from "../reactNativeTestingLibraryHelper";

// These tests exercise local form hydration, not study loading or persistence.
jest.mock("../../helpers/studyFile", () => ({
  getReusableChoicesIncludeErrorAsync: jest.fn(),
}));

const savedAnswer = (data: AnswerData | null): Answer =>
  ({
    pingId: "restored-ping",
    questionId: "restored-question",
    data,
    preferNotToAnswer: null,
    date: new Date("2026-01-01T00:00:00Z"),
  } as Answer);

const screenProps = () => ({
  loadingCompleted: jest.fn(),
  onDataChange: jest.fn(),
  allAnswers: {},
  allQuestions: {},
  pipeInExtraMetaData: (value: string) => value,
  setDataValidationFunction: jest.fn(),
});

test.each([true, false])(
  "restores the saved yes/no selection %p",
  async (value) => {
    const question: YesNoQuestion = {
      id: "restored-question",
      type: QuestionType.YesNo,
      question: "Are you happy?",
      next: null,
    };
    const props = screenProps();
    const { getByLabelText } = render(
      <ChoicesQuestionScreen
        {...props}
        question={question}
        initialAnswer={savedAnswer({ value })}
      />,
    );

    await waitFor(() =>
      expect(getByLabelText(`select ${value ? "Yes" : "No"}`)).toHaveStyle({
        backgroundColor: "#b3995d",
      }),
    );
    expect(getByLabelText(`select ${value ? "No" : "Yes"}`)).toHaveStyle({
      backgroundColor: "#F9F6EF",
    });
    expect(props.loadingCompleted).toHaveBeenCalledTimes(1);
    expect(props.onDataChange).not.toHaveBeenCalled();

    fireEvent.press(getByLabelText(`select ${value ? "No" : "Yes"}`));
    expect(props.onDataChange).toHaveBeenCalledWith({ value: !value });
  },
);

test("restores a single choice using its persisted displayed label", async () => {
  const question: ChoicesWithSingleAnswerQuestion = {
    id: "restored-question",
    type: QuestionType.ChoicesWithSingleAnswer,
    question: "Which animal?",
    choices: ["Wolf", "{{animal}}", "Other"],
    randomizeChoicesOrder: true,
    next: null,
  };
  const props = screenProps();
  const { getByLabelText } = render(
    <ChoicesQuestionScreen
      {...props}
      question={question}
      pipeInExtraMetaData={(value) => value.replace("{{animal}}", "Fox")}
      initialAnswer={savedAnswer({ value: "Fox" })}
    />,
  );

  await waitFor(() =>
    expect(getByLabelText("select Fox")).toHaveStyle({
      backgroundColor: "#b3995d",
    }),
  );
  expect(props.onDataChange).not.toHaveBeenCalled();
  fireEvent.press(getByLabelText("select Wolf"));
  expect(props.onDataChange).toHaveBeenCalledWith({ value: "Wolf" });
  expect(getByLabelText("select Fox")).toHaveStyle({
    backgroundColor: "#F9F6EF",
  });
});

test.each([true, false])(
  "restores multi-choice tuple order and selection without reshuffling (selected %p)",
  async (selected) => {
    const question: ChoicesWithMultipleAnswersQuestion = {
      id: "restored-question",
      type: QuestionType.ChoicesWithMultipleAnswers,
      question: "Which animals?",
      choices: ["Wolf", "Fox", "Other"],
      randomizeChoicesOrder: true,
      randomizeExceptForChoiceIds: ["Other"],
      next: null,
    };
    const value: ChoicesWithMultipleAnswersAnswerChoices = [
      ["Other", false],
      ["Fox", selected],
      ["Wolf", false],
    ];
    const answer = savedAnswer({ value });
    const props = screenProps();
    const shuffleSpy = jest.spyOn(helpers, "shuffle");
    const { getByLabelText, getAllByLabelText } = render(
      <ChoicesQuestionScreen
        {...props}
        question={question}
        initialAnswer={answer}
      />,
    );

    await waitFor(() => expect(getAllByLabelText(/^select /)).toHaveLength(3));
    expect(
      getAllByLabelText(/^select /).map(
        (item) => item.props.accessibilityLabel,
      ),
    ).toEqual(["select Other", "select Fox", "select Wolf"]);
    expect(getByLabelText("select Fox")).toHaveStyle({
      backgroundColor: selected ? "#b3995d" : "#F9F6EF",
    });
    expect(shuffleSpy).not.toHaveBeenCalled();
    expect(props.onDataChange).not.toHaveBeenCalled();
    expect(props.loadingCompleted).toHaveBeenCalledTimes(1);

    fireEvent.press(getByLabelText("select Wolf"));
    expect(props.onDataChange).toHaveBeenLastCalledWith({
      value: [
        ["Other", false],
        ["Fox", selected],
        ["Wolf", true],
      ],
    });
    fireEvent.press(getByLabelText("select Fox"));
    expect(props.onDataChange).toHaveBeenLastCalledWith({
      value: [
        ["Other", false],
        ["Fox", !selected],
        ["Wolf", true],
      ],
    });
    expect(answer.data).toEqual({
      value: [
        ["Other", false],
        ["Fox", selected],
        ["Wolf", false],
      ],
    });
  },
);

test("a randomized multi-choice question remounts in its previously saved order", async () => {
  const question: ChoicesWithMultipleAnswersQuestion = {
    id: "restored-question",
    type: QuestionType.ChoicesWithMultipleAnswers,
    question: "Which animals?",
    choices: ["Wolf", "Fox", "Other"],
    randomizeChoicesOrder: true,
    next: null,
  };
  const props = screenProps();
  const firstRender = render(
    <ChoicesQuestionScreen {...props} question={question} />,
  );
  await waitFor(() =>
    expect(firstRender.getAllByLabelText(/^select /)).toHaveLength(3),
  );
  expect(props.onDataChange).not.toHaveBeenCalled();
  const displayedOrder = firstRender
    .getAllByLabelText(/^select /)
    .map((item) => item.props.accessibilityLabel);
  fireEvent.press(firstRender.getByLabelText("select Fox"));
  const answer = savedAnswer(props.onDataChange.mock.calls[0][0]);
  firstRender.unmount();

  const restoredProps = screenProps();
  const shuffleSpy = jest.spyOn(helpers, "shuffle");
  const restored = render(
    <ChoicesQuestionScreen
      {...restoredProps}
      question={question}
      initialAnswer={answer}
    />,
  );
  await waitFor(() =>
    expect(restored.getAllByLabelText(/^select /)).toHaveLength(3),
  );
  expect(
    restored
      .getAllByLabelText(/^select /)
      .map((item) => item.props.accessibilityLabel),
  ).toEqual(displayedOrder);
  expect(restored.getByLabelText("select Fox")).toHaveStyle({
    backgroundColor: "#b3995d",
  });
  expect(shuffleSpy).not.toHaveBeenCalled();
  expect(restoredProps.onDataChange).not.toHaveBeenCalled();
});

test.each<HowLongAgoAnswerDataType>([
  [6, "days"],
  [null, "hours"],
  [2, null],
])(
  "restores how-long-ago [%p, %p] and retains the untouched column",
  (number, unit) => {
    const question: HowLongAgoQuestion = {
      id: "restored-question",
      type: QuestionType.HowLongAgo,
      question: "How long ago?",
      next: null,
    };
    const props = screenProps();
    const { getByLabelText } = render(
      <HowLongAgoQuestionScreen
        {...props}
        question={question}
        initialAnswer={savedAnswer({ value: [number, unit] })}
      />,
    );

    if (number !== null) {
      expect(getByLabelText(`select ${number}`)).toHaveStyle({
        backgroundColor: "#b3995d",
      });
    }
    if (unit !== null) {
      expect(getByLabelText(`select ${unit}`)).toHaveStyle({
        backgroundColor: "#b3995d",
      });
    }
    expect(props.onDataChange).not.toHaveBeenCalled();
    fireEvent.press(getByLabelText("select 3"));
    expect(props.onDataChange).toHaveBeenLastCalledWith({ value: [3, unit] });
    fireEvent.press(getByLabelText("select weeks"));
    expect(props.onDataChange).toHaveBeenLastCalledWith({
      value: [3, "weeks"],
    });
  },
);

test.each([0, 67])(
  "restores slider value %p ahead of all defaults",
  async (value) => {
    const question: SliderQuestion = {
      id: "restored-question",
      type: QuestionType.Slider,
      question: "How much?",
      defaultValue: 12,
      defaultValueFromQuestionId: "earlier-slider",
      displayCurrentValueToUser: true,
      slider: ["A little", "A lot"],
      next: null,
    };
    const props = screenProps();
    const result = render(
      <SliderQuestionScreen
        {...props}
        question={question}
        allAnswers={{ "earlier-slider": savedAnswer({ value: 34 }) }}
        initialAnswer={savedAnswer({ value })}
      />,
    );
    const slider = await findSliderAsync(result);
    // Slider 5.x omits a zero value at its native boundary (the native default).
    // Check the value supplied by our form before that library normalization.
    expect(result.UNSAFE_getByType(Slider).props.value).toBe(value);
    expect(result.getByText(`(You have selected ${value})`)).toBeTruthy();
    expect(props.onDataChange).not.toHaveBeenCalled();
    moveSlider(slider, 56);
    expect(props.onDataChange).toHaveBeenCalledWith({ value: 56 });
  },
);

test("restores multiple-text defaults and preserves other values while typing", async () => {
  const question: MultipleTextQuestion = {
    id: "restored-question",
    type: QuestionType.MultipleText,
    question: "Who was there?",
    max: 4,
    maxMinus: "earlier-names",
    variableName: "NAME",
    indexName: "INDEX",
    next: null,
  };
  const props = screenProps();
  const answer = savedAnswer({ value: ["Alice", "Bob"] });
  const { getByLabelText, getAllByLabelText } = render(
    <MultipleTextQuestionScreen
      {...props}
      question={question}
      allAnswers={{ "earlier-names": savedAnswer({ value: ["Charlie"] }) }}
      initialAnswer={answer}
    />,
  );

  expect(getAllByLabelText(/^text input /)).toHaveLength(3);
  expect(getByLabelText("text input 0").props.defaultValue).toBe("Alice");
  expect(getByLabelText("text input 1").props.defaultValue).toBe("Bob");
  expect(getByLabelText("text input 2").props.defaultValue).toBe("");
  expect(getByLabelText("text input 0").props.value).toBeUndefined();
  expect(props.onDataChange).not.toHaveBeenCalled();

  fireEvent.changeText(getByLabelText("text input 0"), "  Alicia  ");
  await waitFor(() =>
    expect(props.onDataChange).toHaveBeenLastCalledWith({
      value: ["Alicia", "Bob"],
    }),
  );
  // Native text and the original default must not be forced to the trimmed data.
  expect(getByLabelText("text input 0").props.value).toBe("  Alicia  ");
  expect(getByLabelText("text input 0").props.defaultValue).toBe("Alice");
  fireEvent.changeText(getByLabelText("text input 1"), "");
  await waitFor(() =>
    expect(props.onDataChange).toHaveBeenLastCalledWith({ value: ["Alicia"] }),
  );
  expect(answer.data).toEqual({ value: ["Alice", "Bob"] });
});

test("a fresh multiple-text form stays uncontrolled and does not emit a write", () => {
  const question: MultipleTextQuestion = {
    id: "restored-question",
    type: QuestionType.MultipleText,
    question: "Who was there?",
    max: 2,
    variableName: "NAME",
    indexName: "INDEX",
    next: null,
  };
  const props = screenProps();
  const { getAllByLabelText } = render(
    <MultipleTextQuestionScreen {...props} question={question} />,
  );
  getAllByLabelText(/^text input /).forEach((input) => {
    expect(input.props.defaultValue).toBe("");
    expect(input.props.value).toBeUndefined();
  });
  expect(props.onDataChange).not.toHaveBeenCalled();
});

test("a saved null answer leaves controls unanswered", async () => {
  const question: YesNoQuestion = {
    id: "restored-question",
    type: QuestionType.YesNo,
    question: "Are you happy?",
    next: null,
  };
  const props = screenProps();
  const { getAllByLabelText } = render(
    <ChoicesQuestionScreen
      {...props}
      question={question}
      initialAnswer={savedAnswer(null)}
    />,
  );
  await waitFor(() => expect(getAllByLabelText(/^select /)).toHaveLength(2));
  getAllByLabelText(/^select /).forEach((choice) =>
    expect(choice).toHaveStyle({ backgroundColor: "#F9F6EF" }),
  );
  expect(props.onDataChange).not.toHaveBeenCalled();
});
