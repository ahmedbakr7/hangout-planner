import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import AccountError from "./error";

function renderBoundary(error: Error, retry: () => void) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AccountError error={error} retry={retry} />
    </NextIntlClientProvider>,
  );
}

describe("account error boundary", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    consoleError.mockRestore();
  });

  it("T-001-48/AC-6 shows the account title and the upstream error in an alert", () => {
    const { container } = renderBoundary(
      new Error("database call rejected for acc_secret"),
      vi.fn(),
    );
    expect(screen.getByRole("heading").textContent).toBe(en.Account.title);
    expect(screen.getByRole("alert").textContent).toBe(en.errors.code.upstream);
    expect(screen.getByRole("button").textContent).toBe(en.common.retry);
    expect(container.textContent).not.toContain("acc_secret");
  });

  it("T-001-48/AC-6 the retry button calls the retry function once", () => {
    const retry = vi.fn();
    renderBoundary(new Error("boom"), retry);
    fireEvent.click(screen.getByRole("button", { name: en.common.retry }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("T-001-48/AC-6 reports the error once with console.error", () => {
    const error = new Error("boom");
    renderBoundary(error, vi.fn());
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(error);
  });
});

import ar from "../../../messages/ar.json";

describe("T-001-85 account error boundary copy", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    consoleError.mockRestore();
  });

  function checkBoundary(locale: "en" | "ar", messages: typeof en) {
    const error = new Error("database call rejected for acc_secret");
    const retry = vi.fn();
    const { container } = render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <AccountError error={error} retry={retry} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      messages.Account.title,
    );
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert").textContent).toBe(
      messages.errors.code.upstream,
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button").textContent).toBe(messages.common.retry);
    fireEvent.click(screen.getByRole("button"));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(error);
    expect(container.textContent).not.toContain("acc_secret");
  }

  it("T-001-85/AC-1 English shows the heading and one alert with the screen's texts", () => {
    checkBoundary("en", en);
  });

  it("T-001-85/AC-2 English shows one retry button that retries once, logs the error once and hides the message", () => {
    checkBoundary("en", en);
  });

  it("T-001-85/AC-4 Arabic shows the Arabic heading, alert and retry button", () => {
    checkBoundary("ar", ar as typeof en);
  });
});
