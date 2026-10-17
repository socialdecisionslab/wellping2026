import {
  act,
  fireEvent,
  waitFor,
  RenderAPI,
} from "@testing-library/react-native";
import { ReactTestInstance } from "react-test-renderer";

/**
 * This function is used when `fireEvent.changeText` is used (e.g. for
 * `MultipleTextQuestionScreen`).
 * The supported testing-library wait helper flushes React updates without
 * nesting independent asynchronous act() calls.
 */
export async function changeTextAndWaitForUpdateAsync(
  getElement: () => Promise<ReactTestInstance>,
  text: string,
) {
  const element = await getElement();
  await act(async () => {
    fireEvent.changeText(element, text);
    // The dropdown deliberately defers its consumer callback with setTimeout(0).
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  // Editable native inputs are intentionally uncontrolled: their visible text
  // is not reflected in React props. The callers assert emitted answer data and
  // validation callbacks after the deferred update above. Only controlled inputs
  // expose a value that can be checked through this renderer.
  if (element.props.value !== undefined) {
    await waitFor(async () => {
      expect((await getElement()).props.value).toStrictEqual(text);
    });
  }
}

const SLIDER_A11Y_LABEL = "slider input";
export const findSliderAsync = async ({ findAllByLabelText }: RenderAPI) => {
  const sliderInputs = await findAllByLabelText(SLIDER_A11Y_LABEL);
  expect(sliderInputs).toHaveLength(1);
  const sliderInput = sliderInputs[0];
  return sliderInput;
};
export const moveSlider = (sliderInput: ReactTestInstance, value: number) => {
  fireEvent(sliderInput, "onRNCSliderSlidingComplete", {
    nativeEvent: { value },
  });
};
