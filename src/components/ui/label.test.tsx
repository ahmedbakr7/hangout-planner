import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { Label } from "./label";

describe("Label", () => {
  it("renders a label with start-aligned type", () => {
    render(<Label htmlFor="title">Title</Label>);
    const el = screen.getByText("Title");
    expect(el.tagName).toBe("LABEL");
    expect(el.getAttribute("for")).toBe("title");
    expect(el.className).toContain("text-start");
  });
});
