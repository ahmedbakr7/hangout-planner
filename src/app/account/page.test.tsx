import { afterEach, describe, expect, it, vi } from "vitest";

const loadAccountPage = vi.fn();
const accountGate = vi.fn();
const cookieGet = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => cookieGet(name) }),
}));
vi.mock("@/server/auth/page-data", () => ({
  loadAccountPage: (...args: unknown[]) => loadAccountPage(...args),
}));
vi.mock("@/components/account-gate", () => ({
  AccountGate: (props: unknown) => {
    accountGate(props);
    return null;
  },
}));

import AccountPage from "./page";

type GateProps = { next?: string; initialAccount: unknown };

async function open(
  page: unknown,
  next?: string | string[],
): Promise<{ props: { children: { props: GateProps } } }> {
  loadAccountPage.mockResolvedValue(page);
  return (await AccountPage({
    searchParams: Promise.resolve(next === undefined ? {} : { next }),
  })) as never;
}

describe("account page", () => {
  afterEach(() => {
    loadAccountPage.mockReset();
    accountGate.mockReset();
    cookieGet.mockReset();
  });

  it("T-001-48/AC-2 passes the account for the cookie to AccountGate as initial data and never the session", async () => {
    cookieGet.mockImplementation((name: string) =>
      name === "hp_session" ? { value: "tok_abc" } : undefined,
    );
    const view = {
      account: { id: "acc_1", email: "nour@example.com", display_name: "Nour" },
    };
    loadAccountPage.mockImplementation(
      async (read: (name: string) => string | null) =>
        read("hp_session") === "tok_abc"
          ? {
              kind: "ok",
              view,
              session: { ok: true, token: "tok_abc", sessionId: "ses_1", account: view.account },
            }
          : { kind: "signed_out" },
    );
    const tree = (await AccountPage({
      searchParams: Promise.resolve({}),
    })) as unknown as { props: { children: { props: GateProps } } };
    expect(tree.props.children.props.initialAccount).toEqual(view);
    expect(JSON.stringify(tree.props.children.props)).not.toContain("tok_abc");
    expect(JSON.stringify(tree.props.children.props)).not.toContain("ses_1");
  });

  it("T-001-48/AC-4 passes null initial data when there is no valid session and keeps the next value", async () => {
    const tree = await open({ kind: "signed_out" }, "/plans/new");
    expect(tree.props.children.props.initialAccount).toBeNull();
    expect(tree.props.children.props.next).toBe("/plans/new");
  });

  it("T-001-48/AC-4 takes the first value of a repeated next", async () => {
    const tree = await open({ kind: "signed_out" }, ["/invitations", "/"]);
    expect(tree.props.children.props.next).toBe("/invitations");
  });

  it("T-001-48/AC-6 lets a loader error propagate to the route's error boundary", async () => {
    loadAccountPage.mockRejectedValue(new Error("database down"));
    await expect(
      AccountPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("database down");
  });
});
