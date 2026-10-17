import { fireEvent, act, RenderAPI } from "@testing-library/react-native";
import { ReactTestInstance } from "react-test-renderer";

/** Native uncontrolled input text is not reflected back into React props.
 * Flush the input event; callers assert emitted/persisted answers, not `value`.
 */
export async function changeTextAndWaitForUpdateAsync(
  getElement: () => Promise<ReactTestInstance>,
  text: string,
) {
  const element = await getElement();
  await act(async () => {
    fireEvent.changeText(element, text);
  });
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
