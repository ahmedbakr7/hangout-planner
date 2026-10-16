import { afterEach, describe, expect, it, vi } from "vitest";

const loadConfirmedPage = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
vi.mock("@/server/plans/page-data", () => ({
  loadConfirmedPage: (...args: unknown[]) => loadConfirmedPage(...args),
}));
vi.mock("@/components/confirmed-view", () => ({
  ConfirmedView: () => null,
}));

import { ConfirmedView } from "@/components/confirmed-view";
import ConfirmedPage from "./page";

async function open(page: unknown): Promise<unknown> {
  loadConfirmedPage.mockResolvedValue(page);
  return ConfirmedPage({ params: Promise.resolve({ planId: "pln_a" }) });
}

describe("confirmed page", () => {
  afterEach(() => {
    loadConfirmedPage.mockReset();
  });

  it("T-001-55/AC-1 renders ConfirmedView for the planId", async () => {
    const element = (await open({ kind: "ok", doc: { steps: [] } })) as {
      props: { children: { type: unknown; props: Record<string, unknown> } };
    };
    const view = element.props.children;
    expect(view.type).toBe(ConfirmedView);
    expect(view.props.planId).toBe("pln_a");
  });

  it.each([
    ["organizer", "/plans/pln_a"],
    ["respond", "/plans/pln_a/respond"],
    ["proposal", "/plans/pln_a/proposal"],
    ["join", "/plans/pln_a/join"],
  ])(
    "T-001-50/AC-2 redirects a not_locked result with next %s to %s",
    async (next, target) => {
      await expect(open({ kind: "not_locked", next })).rejects.toThrow(
        `NEXT_REDIRECT ${target}`,
      );
    },
  );
});
