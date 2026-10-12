import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../../messages/en.json";
import ProposalError from "./error";

const PRIVATE_TITLE = "Cairo rooftop dinner";

function renderBoundary(error: Error, retry: () => void) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ProposalError error={error} retry={retry} />
    </NextIntlClientProvider>,
  );
}

describe("proposal error boundary", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    consoleError.mockRestore();
  });

  it("T-001-39/AC-5 shows the title and the load error in an alert and none of the plan's data", () => {
    const { container } = renderBoundary(
      new Error(`database call rejected for ${PRIVATE_TITLE}`),
      vi.fn(),
    );
    expect(screen.getByText(en.proposal.title)).toBeTruthy();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(en.proposal.loadError);
    expect(container.textContent).not.toContain(PRIVATE_TITLE);
  });

  it("T-001-39/AC-5 retry button calls the retry function once", () => {
    const retry = vi.fn();
    renderBoundary(new Error("boom"), retry);
    fireEvent.click(screen.getByRole("button", { name: en.proposal.retry }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("T-001-39/AC-5 reports the error once with console.error", () => {
    const error = new Error("boom");
    renderBoundary(error, vi.fn());
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(error);
  });
});
