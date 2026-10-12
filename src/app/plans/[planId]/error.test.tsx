import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../messages/en.json";
import OrganizerPlanError from "./error";

const PRIVATE_TITLE = "Cairo rooftop dinner";

function renderBoundary(error: Error, retry: () => void) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <OrganizerPlanError error={error} retry={retry} />
    </NextIntlClientProvider>,
  );
}

describe("organizer plan error boundary", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    consoleError.mockRestore();
  });

  it("T-001-37/AC-1 shows the load error in an alert and none of the plan's data", () => {
    const { container } = renderBoundary(
      new Error(`database call rejected for ${PRIVATE_TITLE}`),
      vi.fn(),
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(en.plans.loadError);
    expect(container.textContent).not.toContain(PRIVATE_TITLE);
    expect(screen.queryByText(en.plans.invite)).toBeNull();
    expect(screen.queryByText(en.plans.statusAnswered)).toBeNull();
  });

  it("T-001-37/AC-2 retry button calls the retry function once", () => {
    const retry = vi.fn();
    renderBoundary(new Error("boom"), retry);
    fireEvent.click(screen.getByRole("button", { name: en.plans.retry }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("T-001-37/AC-3 reports the error once with console.error", () => {
    const error = new Error("boom");
    renderBoundary(error, vi.fn());
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(error);
  });
});
