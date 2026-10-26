import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouteLoadError } from "./route-load-error";

describe("RouteLoadError", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    consoleError.mockRestore();
  });

  it("shows the title as a level-1 heading, the alert text and the retry label", () => {
    render(
      <RouteLoadError
        error={new Error("boom")}
        retry={vi.fn()}
        title="Plan"
        alert="Could not load"
        retryLabel="Try again"
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Plan");
    expect(screen.getByRole("alert").textContent).toBe("Could not load");
    expect(screen.getByRole("button").textContent).toBe("Try again");
  });

  it("shows no heading when no title is given", () => {
    render(
      <RouteLoadError
        error={new Error("boom")}
        retry={vi.fn()}
        alert="Could not load"
        retryLabel="Try again"
      />,
    );
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("Could not load");
  });

  it("calls retry once when the button is clicked", () => {
    const retry = vi.fn();
    render(
      <RouteLoadError
        error={new Error("boom")}
        retry={retry}
        alert="Could not load"
        retryLabel="Try again"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("logs the error once and keeps its message off the page", () => {
    const error = new Error("secret detail");
    const { container } = render(
      <RouteLoadError
        error={error}
        retry={vi.fn()}
        alert="Could not load"
        retryLabel="Try again"
      />,
    );
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(error);
    expect(container.textContent).not.toContain("secret detail");
  });
});
