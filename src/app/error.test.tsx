import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/en.json";

let pathname = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

import RootError from "./error";

const PRIVATE_TITLE = "Cairo rooftop dinner";

function renderBoundary(path: string, error: Error, retry: () => void) {
  pathname = path;
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <RootError error={error} retry={retry} />
    </NextIntlClientProvider>,
  );
}

describe("root error boundary", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    consoleError.mockRestore();
  });

  it("T-001-45/AC-6 on / shows the home title and load error in an alert", () => {
    const { container } = renderBoundary(
      "/",
      new Error(`database call rejected for ${PRIVATE_TITLE}`),
      vi.fn(),
    );
    expect(screen.getByRole("heading").textContent).toBe(en.Home.title);
    expect(screen.getByRole("alert").textContent).toBe(en.Home.loadError);
    expect(screen.getByRole("button").textContent).toBe(en.Home.retry);
    expect(container.textContent).not.toContain(PRIVATE_TITLE);
  });

  it("T-001-45/AC-6 on / the retry button calls the retry function once", () => {
    const retry = vi.fn();
    renderBoundary("/", new Error("boom"), retry);
    fireEvent.click(screen.getByRole("button", { name: en.Home.retry }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("T-001-45/AC-6 on / reports the error once with console.error", () => {
    const error = new Error("boom");
    renderBoundary("/", error, vi.fn());
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(error);
  });

  it("T-001-45/AC-7 on another path shows route-neutral text and no Home text", () => {
    const { container } = renderBoundary("/account", new Error("boom"), vi.fn());
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe(en.errors.code.upstream);
    expect(screen.getByRole("button").textContent).toBe(en.common.retry);
    expect(container.textContent).not.toContain(en.Home.title);
    expect(container.textContent).not.toContain(en.Home.loadError);
  });

  it("T-001-45/AC-7 on another path the retry button calls retry once", () => {
    const retry = vi.fn();
    renderBoundary("/join/jt_abc", new Error("boom"), retry);
    fireEvent.click(screen.getByRole("button", { name: en.common.retry }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("T-001-45/AC-7 on another path reports the error once with console.error", () => {
    const error = new Error("boom");
    renderBoundary("/account", error, vi.fn());
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(error);
  });
});
