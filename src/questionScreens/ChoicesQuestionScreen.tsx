import {
  ChoicesWithMultipleAnswersAnswerChoices,
  YesNoAnswerData,
  ChoicesWithSingleAnswerAnswerData,
  ChoicesWithMultipleAnswersAnswerData,
} from "@wellping/study-schemas/lib/answerTypes";
import {
  ChoicesQuestion,
  YesNoQuestion,
  Choice,
} from "@wellping/study-schemas/lib/types";
import cloneDeep from "lodash/cloneDeep";
import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
} from "react-native";

import { QuestionType, shuffle } from "../helpers/helpers";
import { getReusableChoicesIncludeErrorAsync } from "../helpers/studyFile";
import { QuestionScreenProps } from "../helpers/types";

export interface ChoiceItemProps {
  id: string;
  title: string;
  selected: boolean;
  onSelect: () => void;
  multiple?: boolean;
  disabled?: boolean;
}
export function ChoiceItem({
  title,
  selected,
  onSelect,
  multiple = false,
  disabled = false,
}: ChoiceItemProps) {
  return (
    <TouchableOpacity
      onPress={() => {
        if (!disabled) onSelect();
      }}
      disabled={disabled}
      accessibilityRole={multiple ? "checkbox" : "radio"}
      accessibilityState={{ checked: selected, disabled }}
      style={[
        styles.item,
        { backgroundColor: selected ? "#b3995d" : "#F9F6EF" },
      ]}
      accessibilityLabel={`select ${title}`}
    >
      <Text style={styles.title}>{title}</Text>
    </TouchableOpacity>
  );
}

interface ChoicesQuestionScreenProps extends QuestionScreenProps {
  question: ChoicesQuestion | YesNoQuestion;
}

enum ChoicesAnswerType {
  SINGLE_SELECTION, // ChoicesWithMultipleAnswersAnswerChoices
  MULTIPLE_SELECTION, // string
  YESNO, // boolean
}

const YESNO_CHOICES_YES_VALUE = "Yes";
const YESNO_CHOICES_NO_VALUE = "No";
const YESNO_CHOICES: Choice[] = [
  YESNO_CHOICES_YES_VALUE,
  YESNO_CHOICES_NO_VALUE,
];

const ChoicesQuestionScreen: React.ElementType<ChoicesQuestionScreenProps> = ({
  question,
  initialAnswer,
  loadingCompleted,
  onDataChange,
  pipeInExtraMetaData,
}) => {
  let answerType: ChoicesAnswerType;
  switch (question.type) {
    case QuestionType.ChoicesWithSingleAnswer:
      answerType = ChoicesAnswerType.SINGLE_SELECTION;
      break;

    case QuestionType.ChoicesWithMultipleAnswers:
      answerType = ChoicesAnswerType.MULTIPLE_SELECTION;
      break;

    case QuestionType.YesNo:
      answerType = ChoicesAnswerType.YESNO;
      break;

    default:
      throw new Error("Wrong QuestionType in ChoicesQuestionScreen");
  }

  const listRef = React.useRef<FlatList<{ id: string; title: string }>>(null);

  const [selected, setSelected] =
    React.useState<ChoicesWithMultipleAnswersAnswerChoices>([]);
  const latestSelected = React.useRef(selected);

  type FlatListData = {
    id: string;
    title: string;
  }[];
  const [flatListData, setFlatListData] = React.useState<FlatListData>([]);

  const initAnswerDataWithFlatListData = (
    inputFlatListData: FlatListData = flatListData,
  ) => {
    // Unlike `choices`, `flatListDataChoices` will be in the actual order of
    // the choices displayed on the screen.
    const flatListDataChoices = inputFlatListData.map((data) => data.title);
    return flatListDataChoices.map((choice) => [
      choice,
      false,
    ]) as ChoicesWithMultipleAnswersAnswerChoices;
  };

  React.useEffect(() => {
    // We have to use `useEffect(..., [])` here to ensure this only runs once.
    // If we don't use `useEffect`, each time the user update the state, the choices will be re-shuffled.

    async function setupAsync() {
      const savedValue = initialAnswer?.data?.value;
      if (
        answerType === ChoicesAnswerType.MULTIPLE_SELECTION &&
        Array.isArray(savedValue) &&
        savedValue.length > 0 &&
        savedValue.every(
          (choice) =>
            Array.isArray(choice) &&
            choice.length === 2 &&
            typeof choice[0] === "string" &&
            typeof choice[1] === "boolean",
        )
      ) {
        // Tuples preserve the labels and order the participant originally saw.
        // Do not re-pipe or reshuffle them when resuming the question.
        const savedChoices =
          savedValue as ChoicesWithMultipleAnswersAnswerChoices;
        setFlatListData(
          savedChoices.map(([title], index) => ({
            id: `restored-${index}`,
            title,
          })),
        );
        latestSelected.current = cloneDeep(savedChoices);
        setSelected(latestSelected.current);
        loadingCompleted();
        return;
      }

      let choices: Choice[];
      if (answerType === ChoicesAnswerType.YESNO) {
        choices = YESNO_CHOICES;
      } else {
        const cQ = question as ChoicesQuestion;
        if (typeof cQ.choices === "string") {
          choices = await getReusableChoicesIncludeErrorAsync(cQ.choices);
        } else {
          choices = cQ.choices;
        }
      }

      let tempFlatListData = choices.map((choice) => {
        return {
          id: choice,
          title: pipeInExtraMetaData(choice),
        };
      });
      if (answerType !== ChoicesAnswerType.YESNO) {
        const cQ = question as ChoicesQuestion;
        if (cQ.randomizeChoicesOrder) {
          const randomizeExceptForChoiceIds =
            cQ.randomizeExceptForChoiceIds || [];

          const flatListShuffleableData = tempFlatListData.filter(
            (value) => !randomizeExceptForChoiceIds.includes(value.id),
          );
          const flatListFixedDataAtLast = tempFlatListData.filter((value) =>
            randomizeExceptForChoiceIds.includes(value.id),
          );
          tempFlatListData = [
            ...shuffle(flatListShuffleableData),
            ...flatListFixedDataAtLast,
          ];
        }
      }
      setFlatListData(tempFlatListData);

      // We have to specify `tempFlatListData` variable here (instead of using
      // the `flatListData` variable) because `flatListData` might still not be
      // updated here.
      const initialSelected = initAnswerDataWithFlatListData(tempFlatListData);
      let savedSelection: string | undefined;
      if (
        answerType === ChoicesAnswerType.YESNO &&
        typeof savedValue === "boolean"
      ) {
        savedSelection = savedValue
          ? YESNO_CHOICES_YES_VALUE
          : YESNO_CHOICES_NO_VALUE;
      } else if (
        answerType === ChoicesAnswerType.SINGLE_SELECTION &&
        typeof savedValue === "string"
      ) {
        savedSelection = savedValue;
      }
      if (savedSelection !== undefined) {
        initialSelected.forEach((choice) => {
          choice[1] = choice[0] === savedSelection;
        });
      }
      latestSelected.current = initialSelected;
      setSelected(initialSelected);

      loadingCompleted();
    }
    setupAsync();
  }, []);

  return (
    <View style={{ paddingVertical: 5 }}>
      {answerType !== ChoicesAnswerType.YESNO && (
        <Text
          style={{
            textAlign: "center",
            color: "gray",
            fontSize: 13,
            marginBottom: 2,
          }}
        >
          You may need to scroll to see all options.
        </Text>
      )}
      <FlatList
        data={flatListData}
        renderItem={({ item, index }) => (
          <ChoiceItem
            multiple={answerType === ChoicesAnswerType.MULTIPLE_SELECTION}
            id={item.id}
            title={item.title}
            selected={(selected[index] && selected[index][1]) || false}
            onSelect={() => {
              const value = item.title;

              let newSelected: ChoicesWithMultipleAnswersAnswerChoices;
              if (answerType === ChoicesAnswerType.MULTIPLE_SELECTION) {
                newSelected = cloneDeep(latestSelected.current);
              } else {
                // Reset everything to `false` if it is a single-selection question.
                newSelected = initAnswerDataWithFlatListData();
              }
              newSelected[index][1] = !newSelected[index][1];
              latestSelected.current = newSelected;
              setSelected(newSelected);

              switch (answerType) {
                case ChoicesAnswerType.MULTIPLE_SELECTION:
                  onDataChange({
                    value: newSelected,
                  } as ChoicesWithMultipleAnswersAnswerData);
                  break;

                case ChoicesAnswerType.SINGLE_SELECTION:
                  // Single-selection question only need the selected key as the data.
                  onDataChange({
                    value,
                  } as ChoicesWithSingleAnswerAnswerData);
                  break;

                case ChoicesAnswerType.YESNO:
                  onDataChange({
                    value: value === YESNO_CHOICES_YES_VALUE,
                  } as YesNoAnswerData);
                  break;
              }
            }}
          />
        )}
        keyExtractor={(item) => item.id}
        extraData={selected}
        ref={listRef}
        style={{
          borderWidth: 1,
          borderColor: "lightgray",
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  item: {
    backgroundColor: "#f9c2ff",
    padding: 10,
    marginVertical: 8,
  },
  title: {
    fontSize: 20,
  },
});

export default ChoicesQuestionScreen;
