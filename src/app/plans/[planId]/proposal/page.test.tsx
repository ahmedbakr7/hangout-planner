import { afterEach, describe, expect, it, vi } from "vitest";

const loadProposalPage = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
vi.mock("@/server/proposal/page-data", () => ({
  loadProposalPage: (...args: unknown[]) => loadProposalPage(...args),
}));
vi.mock("@/components/proposal-view", () => ({
  ProposalView: () => null,
}));

import ProposalPage from "./page";

async function open(kind: string): Promise<unknown> {
  loadProposalPage.mockResolvedValue({ kind });
  return ProposalPage({ params: Promise.resolve({ planId: "pln_a" }) });
}

describe("proposal page redirects", () => {
  afterEach(() => {
    loadProposalPage.mockReset();
  });

  it("T-001-39/AC-3 redirects to the confirmed page when the plan is locked", async () => {
    await expect(open("locked")).rejects.toThrow("NEXT_REDIRECT /plans/pln_a/confirmed");
  });

  it("T-001-39/AC-3 redirects the organizer to the plan page while collecting", async () => {
    await expect(open("collecting")).rejects.toThrow("NEXT_REDIRECT /plans/pln_a");
  });

  it("T-001-39/AC-3 redirects a participant to the respond page while collecting or blocked", async () => {
    await expect(open("not_proposed")).rejects.toThrow("NEXT_REDIRECT /plans/pln_a/respond");
  });

  it("T-001-39/AC-3 does not redirect when the proposal cannot be loaded", async () => {
    await expect(open("not_found")).resolves.toBeTruthy();
  });
});
