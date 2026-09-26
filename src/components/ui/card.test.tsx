import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./card";

describe("Card", () => {
  it("uses card semantic surface classes", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Plan</CardTitle>
          <CardDescription>Waiting for answers</CardDescription>
        </CardHeader>
        <CardContent>Body</CardContent>
      </Card>,
    );
    expect(screen.getByText("Plan").className).toContain("text-start");
    const root = screen.getByText("Plan").closest("div.rounded-xl");
    expect(root?.className).toContain("bg-card");
    expect(root?.className).toContain("text-card-foreground");
  });
});
