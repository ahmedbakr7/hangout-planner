import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../../messages/en.json";
import RespondError from "./error";

const PRIVATE_TITLE = "Cairo rooftop dinner";

function renderBoundary(error: Error, retry: () => void) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <RespondError error={error} retry={retry} />
    </NextIntlClientProvider>,
  );
}

describe("respond error boundary", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    consoleError.mockRestore();
  });

  it("T-001-40/AC-5 shows the title and the upstream error in an alert and none of the plan's data", () => {
    const { container } = renderBoundary(
      new Error(`database call rejected for ${PRIVATE_TITLE}`),
      vi.fn(),
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(en.errors.code.upstream);
    expect(screen.getByRole("heading", { name: en.respond.title })).toBeTruthy();
    expect(container.textContent).not.toContain(PRIVATE_TITLE);
    expect(screen.queryByLabelText(/approximate/i)).toBeNull();
  });

  it("T-001-40/AC-5 retry button calls the retry function once", () => {
    const retry = vi.fn();
    renderBoundary(new Error("boom"), retry);
    fireEvent.click(screen.getByRole("button", { name: en.common.retry }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("T-001-40/AC-5 reports the error once with console.error", () => {
    const error = new Error("boom");
    renderBoundary(error, vi.fn());
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(error);
  });
});
