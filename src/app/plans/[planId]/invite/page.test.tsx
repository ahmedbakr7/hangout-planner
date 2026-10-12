import { afterEach, describe, expect, it, vi } from "vitest";

const loadInvitePage = vi.fn();
const invitePanel = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
vi.mock("@/server/invites/page-data", () => ({
  loadInvitePage: (...args: unknown[]) => loadInvitePage(...args),
}));
vi.mock("@/components/invite-panel", () => ({
  InvitePanel: (props: unknown) => {
    invitePanel(props);
    return null;
  },
}));

import InvitePage from "./page";

async function open(page: unknown): Promise<{
  props: { children: { props: { planId: string; initialInvite: unknown } } };
}> {
  loadInvitePage.mockResolvedValue(page);
  return (await InvitePage({
    params: Promise.resolve({ planId: "pln_a" }),
  })) as never;
}

describe("invite page", () => {
  afterEach(() => {
    loadInvitePage.mockReset();
    invitePanel.mockReset();
  });

  it("T-001-41/AC-3 redirects to the confirmed page while locked", async () => {
    await expect(open({ kind: "locked" })).rejects.toThrow(
      "NEXT_REDIRECT /plans/pln_a/confirmed",
    );
  });

  it("T-001-41/AC-2 passes the loaded view to InvitePanel as initial data", async () => {
    const view = {
      join_path: "/join/jt_abc",
      invitations: [{ display_name: "Hana", distinguisher: "k7m2", status: "invited" }],
    };
    const tree = await open({ kind: "ok", view });
    const panel = tree.props.children;
    expect(panel.props.planId).toBe("pln_a");
    expect(panel.props.initialInvite).toEqual(view);
  });

  it("T-001-41/AC-4 passes no initial data when the caller is a participant or the plan is not found", async () => {
    for (const kind of ["organizer_only", "not_found"]) {
      const tree = await open({ kind });
      expect(tree.props.children.props.initialInvite).toBeNull();
    }
  });
});
