import { afterEach, describe, expect, it, vi } from "vitest";

const loadPlanJoinPage = vi.fn();
const joinPanel = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
vi.mock("@/server/join/page-data", () => ({
  loadPlanJoinPage: (...args: unknown[]) => loadPlanJoinPage(...args),
}));
vi.mock("@/components/join-panel", () => ({
  JoinPanel: (props: unknown) => {
    joinPanel(props);
    return null;
  },
}));

import PlanJoinPage from "./page";

type PanelProps = {
  planId: string;
  initialOpening: unknown;
  initialSignedIn: boolean;
};

async function open(page: unknown): Promise<{
  props: { children: { props: PanelProps } };
}> {
  loadPlanJoinPage.mockResolvedValue(page);
  return (await PlanJoinPage({
    params: Promise.resolve({ planId: "pln_a" }),
  })) as never;
}

function okPage(next: string, preview: unknown = null) {
  return {
    kind: "ok",
    opening: { plan_id: "pln_a", next, preview },
    signedIn: true,
  };
}

describe("plan join page", () => {
  afterEach(() => {
    loadPlanJoinPage.mockReset();
    joinPanel.mockReset();
  });

  it.each([
    ["organizer", "/plans/pln_a"],
    ["respond", "/plans/pln_a/respond"],
    ["proposal", "/plans/pln_a/proposal"],
    ["confirmed", "/plans/pln_a/confirmed"],
  ])("T-001-42/AC-3 redirects next %s to %s", async (next, target) => {
    await expect(open(okPage(next))).rejects.toThrow(`NEXT_REDIRECT ${target}`);
  });

  it("T-001-50/AC-2 does not redirect for next join", async () => {
    const tree = await open(okPage("join"));
    expect(tree.props.children.props.planId).toBe("pln_a");
  });

  it("T-001-42/AC-2 passes the opening and the signed-in state to JoinPanel", async () => {
    const preview = { title: "Thursday in Maadi", organizer_display_name: "Omar" };
    const tree = await open(okPage("join", preview));
    const panel = tree.props.children;
    expect(panel.props.planId).toBe("pln_a");
    expect(panel.props.initialOpening).toEqual({
      plan_id: "pln_a",
      next: "join",
      preview,
    });
    expect(panel.props.initialSignedIn).toBe(true);
  });

  it("T-001-42/AC-4 passes a null opening when the plan is not found", async () => {
    const tree = await open({ kind: "not_found" });
    expect(tree.props.children.props.initialOpening).toBeNull();
  });
});
