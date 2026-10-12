import { afterEach, describe, expect, it, vi } from "vitest";

const loadResponsePage = vi.fn();
const responseForm = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
vi.mock("@/server/response/page-data", () => ({
  loadResponsePage: (...args: unknown[]) => loadResponsePage(...args),
}));
vi.mock("@/components/response-form", () => ({
  ResponseForm: (props: unknown) => {
    responseForm(props);
    return null;
  },
}));

import RespondPage from "./page";

async function open(page: unknown): Promise<{
  props: { children: { props: { planId: string; initialResponse: unknown } } };
}> {
  loadResponsePage.mockResolvedValue(page);
  return (await RespondPage({
    params: Promise.resolve({ planId: "pln_a" }),
  })) as never;
}

describe("respond page", () => {
  afterEach(() => {
    loadResponsePage.mockReset();
    responseForm.mockReset();
  });

  it("T-001-40/AC-3 redirects to the proposal page while proposed", async () => {
    await expect(open({ kind: "proposed" })).rejects.toThrow(
      "NEXT_REDIRECT /plans/pln_a/proposal",
    );
  });

  it("T-001-40/AC-3 redirects to the confirmed page while locked", async () => {
    await expect(open({ kind: "locked" })).rejects.toThrow(
      "NEXT_REDIRECT /plans/pln_a/confirmed",
    );
  });

  it("T-001-40/AC-2 passes the loaded view to ResponseForm as initial data", async () => {
    const view = { title: "Thursday in Maadi", plan_state: "collecting" };
    const tree = await open({ kind: "ok", view });
    const form = tree.props.children;
    expect(form.props.planId).toBe("pln_a");
    expect(form.props.initialResponse).toEqual(view);
  });

  it("T-001-40/AC-4 passes no initial data when the plan is not found", async () => {
    const tree = await open({ kind: "not_found" });
    expect(tree.props.children.props.initialResponse).toBeNull();
  });
});
