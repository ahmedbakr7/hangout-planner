import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { Input } from "./input";

describe("Input", () => {
  it("renders with input, ring, and logical start alignment classes", () => {
    render(<Input aria-label="Title" />);
    const el = screen.getByRole("textbox", { name: "Title" });
    expect(el.className).toContain("border-input");
    expect(el.className).toContain("ring-ring");
    expect(el.className).toContain("text-start");
    expect(el.className).toContain("rounded-sm");
  });
});
