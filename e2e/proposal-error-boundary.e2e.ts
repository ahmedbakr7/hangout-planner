/**
 * T-001-39 — a throwing load on /plans/{planId}/proposal reaches the route's error boundary.
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
import ProposalPage from "@/app/plans/[planId]/proposal/page";
import ProposalError from "@/app/plans/[planId]/proposal/error";

const { loader } = vi.hoisted(() => ({ loader: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  redirect: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock("@/server/proposal/page-data", () => ({ loadProposalPage: loader }));

const AUTHORED_PLACE = "Plan B: Secret Cafe";

/** Open the page the way Next does; return the error it throws, as Next hands it to error.tsx. */
async function openThrowingPage(): Promise<Error> {
  loader.mockRejectedValue(new Error("connect ECONNREFUSED database"));
  try {
    await ProposalPage({ params: Promise.resolve({ planId: "pln_abc" }) });
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
      React.createElement(ProposalError, { error, retry }),
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

describe("proposal page error boundary", () => {
  it("T-001-39/AC-5 a page whose loader throws shows the title and the load error in an alert, and none of the plan's data", async () => {
    const error = await openThrowingPage();
    expect(error.message).toContain("ECONNREFUSED");

    showBoundary(error, vi.fn());
    expect(screen.getByText(en.proposal.title)).toBeTruthy();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(en.proposal.loadError);
    expect(document.body.textContent).not.toContain(AUTHORED_PLACE);
  });

  it("T-001-39/AC-5 pressing retry calls the retry function Next passes to the boundary", async () => {
    const error = await openThrowingPage();
    const retry = vi.fn();

    showBoundary(error, retry);
    fireEvent.click(screen.getByRole("button", { name: en.proposal.retry }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("T-001-39/AC-5 the boundary reports the thrown error once with console.error", async () => {
    const error = await openThrowingPage();

    showBoundary(error, vi.fn());
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(error);
  });
});
