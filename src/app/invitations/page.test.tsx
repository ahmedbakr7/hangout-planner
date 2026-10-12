import { afterEach, describe, expect, it, vi } from "vitest";

const loadInvitationsPage = vi.fn();
const invitationsList = vi.fn();
const cookieGet = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => cookieGet(name) }),
}));
vi.mock("@/server/invites/page-data", () => ({
  loadInvitationsPage: (...args: unknown[]) => loadInvitationsPage(...args),
}));
vi.mock("@/components/invite-panel", () => ({
  InvitationsList: (props: unknown) => {
    invitationsList(props);
    return null;
  },
}));

import InvitationsPage from "./page";

async function open(page: unknown): Promise<{
  props: { children: { props: { initialInbox: unknown } } };
}> {
  loadInvitationsPage.mockResolvedValue(page);
  return (await InvitationsPage()) as never;
}

describe("invitations page", () => {
  afterEach(() => {
    loadInvitationsPage.mockReset();
    invitationsList.mockReset();
    cookieGet.mockReset();
  });

  it("T-001-47/AC-2 passes the inbox loaded for the cookie's account to InvitationsList as initial data", async () => {
    const view = {
      invitations: [
        {
          plan_id: "pln_a",
          title: "Thursday in Maadi",
          organizer_display_name: "Omar",
        },
      ],
      truncated: false,
    };
    cookieGet.mockImplementation((name: string) =>
      name === "hp_session" ? { value: "tok_abc" } : undefined,
    );
    loadInvitationsPage.mockImplementation(
      async (read: (name: string) => string | null) =>
        read("hp_session") === "tok_abc"
          ? { kind: "ok", view }
          : { kind: "signed_out" },
    );
    const tree = (await InvitationsPage()) as unknown as {
      props: { children: { props: { initialInbox: unknown } } };
    };
    expect(tree.props.children.props.initialInbox).toEqual(view);
  });

  it("T-001-47/AC-4 passes no initial data when there is no valid session", async () => {
    const tree = await open({ kind: "signed_out" });
    expect(tree.props.children.props.initialInbox).toBeNull();
  });

  it("T-001-47/AC-6 lets a loader error propagate to the route's error boundary", async () => {
    loadInvitationsPage.mockRejectedValue(new Error("database down"));
    await expect(InvitationsPage()).rejects.toThrow("database down");
  });
});
