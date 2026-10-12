import { afterEach, describe, expect, it, vi } from "vitest";

const loadHomePage = vi.fn();
const homeList = vi.fn();
const cookieGet = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => cookieGet(name) }),
}));
vi.mock("@/server/plans/page-data", () => ({
  loadHomePage: (...args: unknown[]) => loadHomePage(...args),
}));
vi.mock("@/components/home-list", () => ({
  HomeList: (props: unknown) => {
    homeList(props);
    return null;
  },
}));

import HomePage from "./page";

async function open(page: unknown): Promise<{
  props: { children: { props: { initialPlans: unknown } } };
}> {
  loadHomePage.mockResolvedValue(page);
  return (await HomePage()) as never;
}

describe("home page", () => {
  afterEach(() => {
    loadHomePage.mockReset();
    homeList.mockReset();
    cookieGet.mockReset();
  });

  it("T-001-45/AC-2 passes the loaded plans for the cookie's account to HomeList as initial data", async () => {
    cookieGet.mockImplementation((name: string) =>
      name === "hp_session" ? { value: "tok_abc" } : undefined,
    );
    loadHomePage.mockImplementation(async (read: (name: string) => string | null) =>
      read("hp_session") === "tok_abc"
        ? {
            kind: "ok",
            view: {
              plans: [
                {
                  id: "pln_a",
                  title: "Thursday in Maadi",
                  answered_count: 1,
                  threshold: 3,
                  state: "collecting",
                },
              ],
              truncated: false,
            },
          }
        : { kind: "signed_out" },
    );
    const tree = (await HomePage()) as unknown as {
      props: { children: { props: { initialPlans: unknown } } };
    };
    expect(tree.props.children.props.initialPlans).toEqual({
      plans: [
        {
          id: "pln_a",
          title: "Thursday in Maadi",
          answered_count: 1,
          threshold: 3,
          state: "collecting",
        },
      ],
      truncated: false,
    });
  });

  it("T-001-45/AC-4 passes no initial data when there is no valid session", async () => {
    const tree = await open({ kind: "signed_out" });
    expect(tree.props.children.props.initialPlans).toBeNull();
  });

  it("T-001-45/AC-6 lets a loader error propagate to the route's error boundary", async () => {
    loadHomePage.mockRejectedValue(new Error("database down"));
    await expect(HomePage()).rejects.toThrow("database down");
  });
});
