/**
 * T-001-48 — a throwing load on /account reaches the route's own error boundary.
 * There is no HTTP rendering until Playwright (roadmap item 5), so this cannot exercise Next's
 * own segment wiring (the framework catching the page's throw and mounting error.tsx). By the
 * closest in-process means: the page's default export is called with its loader's database call
 * rejecting, and the error it throws is handed to the route's error.tsx default export, as Next
 * does. AC-6's "the route renders error.tsx" step stays proven by the unit test on the boundary.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import AccountPage from "@/app/account/page";
import AccountError from "@/app/account/error";

const { loader } = vi.hoisted(() => ({ loader: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/account",
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock("@/server/auth/page-data", () => ({ loadAccountPage: loader }));

/** Open the page the way Next does; return the error it throws, as Next hands it to error.tsx. */
async function openThrowingPage(): Promise<Error> {
  loader.mockRejectedValue(new Error("connect ECONNREFUSED database"));
  try {
    await AccountPage({ searchParams: Promise.resolve({}) });
  } catch (thrown) {
    return thrown as Error;
  }
  throw new Error("the page did not throw");
}

function showBoundary(error: Error, retry: () => void) {
  return render(
    React.createElement(
      NextIntlClientProvider,
      { locale: "en", messages: en },
      React.createElement(AccountError, { error, retry }),
    ),
  );
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  loader.mockReset();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  consoleError.mockRestore();
});

describe("account page error boundary", () => {
  it("T-001-48/AC-6 a page whose loader throws shows the account title and upstream error in an alert, not the sign-in form", async () => {
    const error = await openThrowingPage();
    expect(error.message).toContain("ECONNREFUSED");

    showBoundary(error, vi.fn());
    expect(screen.getByRole("heading").textContent).toBe(en.Account.title);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(en.errors.code.upstream);
    expect(screen.queryByRole("button", { name: en.Account.submitSignIn })).toBeNull();
    expect(screen.getByRole("button", { name: en.common.retry })).toBeTruthy();
  });

  it("T-001-48/AC-6 pressing retry calls the retry function Next passes to the boundary", async () => {
    const error = await openThrowingPage();
    const retry = vi.fn();

    showBoundary(error, retry);
    fireEvent.click(screen.getByRole("button", { name: en.common.retry }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("T-001-48/AC-6 the boundary reports the thrown error once with console.error", async () => {
    const error = await openThrowingPage();

    showBoundary(error, vi.fn());
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(error);
  });
});
