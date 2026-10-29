import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { FieldBlock } from "./field-block";

describe("FieldBlock", () => {
  afterEach(() => {
    cleanup();
  });

  it("labels its child input and shows the error in a p with the error id after it", () => {
    const { container } = render(
      <FieldBlock id="hp-x" label="Name" errorId="hp-x-error" error="Too long">
        <input id="hp-x" />
      </FieldBlock>,
    );
    const input = screen.getByLabelText("Name");
    expect(input.id).toBe("hp-x");
    const block = container.firstElementChild as HTMLElement;
    expect(block.tagName).toBe("DIV");
    expect(block.className).toBe("flex flex-col gap-2");
    const error = container.querySelector("#hp-x-error") as HTMLElement;
    expect(error.tagName).toBe("P");
    expect(error.textContent).toBe("Too long");
    expect(error.className).toBe("text-sm text-destructive text-start");
    expect(error.previousElementSibling).toBe(input);
  });

  it("renders no error element when error is null", () => {
    const { container } = render(
      <FieldBlock id="hp-x" label="Name" errorId="hp-x-error" error={null}>
        <input id="hp-x" />
      </FieldBlock>,
    );
    expect(container.querySelector("#hp-x-error")).toBeNull();
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });
});
