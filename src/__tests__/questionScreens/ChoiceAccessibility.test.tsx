import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ChoiceItem } from "../../questionScreens/ChoicesQuestionScreen";
test.each([false, true])(
  "choice semantics convey checked state with multiple=%s",
  (multiple) => {
    const onSelect = jest.fn();
    const { rerender } = render(
      <ChoiceItem
        id="one"
        title="One"
        selected={false}
        multiple={multiple}
        onSelect={onSelect}
      />,
    );
    const role = multiple ? "checkbox" : "radio";
    expect(screen.getByRole(role, { checked: false })).toBeTruthy();
    fireEvent.press(screen.getByRole(role));
    expect(onSelect).toHaveBeenCalledTimes(1);
    rerender(
      <ChoiceItem
        id="one"
        title="One"
        selected
        multiple={multiple}
        disabled
        onSelect={onSelect}
      />,
    );
    expect(screen.getByRole(role, { checked: true })).toBeDisabled();
    fireEvent.press(screen.getByRole(role));
    expect(onSelect).toHaveBeenCalledTimes(1);
  },
);
