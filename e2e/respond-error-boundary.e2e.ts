/**
 * T-001-40 — a throwing load on /plans/{planId}/respond reaches the route's error boundary.
 * There is no HTTP rendering until Playwright (roadmap item 5), so this cannot exercise Next's
 * own segment wiring (the framework catching the page's throw and mounting error.tsx). By the
 * closest in-process means: the page's default export is called with its loader rejecting, and
 * the error it throws is handed to the route's error.tsx default export, as Next does. The step
 * "the route renders error.tsx" stays proven by the unit test on the boundary.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import RespondPage from "@/app/plans/[planId]/respond/page";
import RespondError from "@/app/plans/[planId]/respond/error";

const { loader } = vi.hoisted(() => ({ loader: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  redirect: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock("@/server/response/page-data", () => ({ loadResponsePage: loader }));

const AUTHORED_TITLE = "Plan B: Secret Thursday in Maadi";

/** Open the page the way Next does; return the error it throws, as Next hands it to error.tsx. */
async function openThrowingPage(): Promise<Error> {
  loader.mockRejectedValue(new Error("connect ECONNREFUSED database"));
  try {
    await RespondPage({ params: Promise.resolve({ planId: "pln_abc" }) });
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
      React.createElement(RespondError, { error, retry }),
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

describe("respond page error boundary", () => {
  it("T-001-40/AC-5 a page whose loader throws shows the title and the upstream error in an alert and none of the plan's data", async () => {
    const error = await openThrowingPage();
    expect(error.message).toContain("ECONNREFUSED");

    showBoundary(error, vi.fn());
    expect(screen.getByRole("heading", { name: en.respond.title })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe(en.errors.code.upstream);
    expect(document.body.textContent).not.toContain(AUTHORED_TITLE);
    expect(screen.queryByLabelText("Earliest")).toBeNull();
  });

  it("T-001-40/AC-5 pressing retry calls the retry function Next passes to the boundary", async () => {
    const error = await openThrowingPage();
    const retry = vi.fn();

    showBoundary(error, retry);
    fireEvent.click(screen.getByRole("button", { name: en.common.retry }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("T-001-40/AC-5 the boundary reports the thrown error once with console.error", async () => {
    const error = await openThrowingPage();

    showBoundary(error, vi.fn());
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(error);
  });
});
