import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  it("renders a button with the primary semantic classes by default", () => {
    render(<Button>Save</Button>);
    const el = screen.getByRole("button", { name: "Save" });
    expect(el.tagName).toBe("BUTTON");
    expect(el.className).toContain("bg-primary");
    expect(el.className).toContain("text-primary-foreground");
    expect(el.className).toContain("ring-ring");
    expect(el.className).toContain("rounded-sm");
  });

  it("applies ghost hover using the accent pair, not the brand CTA", () => {
    render(<Button variant="ghost">More</Button>);
    const el = screen.getByRole("button", { name: "More" });
    expect(el.className).toContain("hover:bg-accent");
    expect(el.className).not.toContain("bg-primary");
  });
});
