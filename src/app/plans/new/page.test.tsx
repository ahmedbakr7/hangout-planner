import { afterEach, describe, expect, it, vi } from "vitest";

const loadCreatePlanPage = vi.fn();
const createForm = vi.fn();
const cookieGet = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => cookieGet(name) }),
}));
vi.mock("@/server/plans/page-data", () => ({
  loadCreatePlanPage: (...args: unknown[]) => loadCreatePlanPage(...args),
}));
vi.mock("@/components/create-form", () => ({
  CreateForm: (props: unknown) => {
    createForm(props);
    return null;
  },
}));

import CreatePlanPage from "./page";

async function open(page: unknown): Promise<{
  props: { children: { props: { initialCurrencies: unknown } } };
}> {
  loadCreatePlanPage.mockResolvedValue(page);
  return (await CreatePlanPage()) as never;
}

describe("create plan page", () => {
  afterEach(() => {
    loadCreatePlanPage.mockReset();
    createForm.mockReset();
    cookieGet.mockReset();
  });

  it("T-001-46/AC-2 passes the currency list for the cookie's account to CreateForm as initial data", async () => {
    cookieGet.mockImplementation((name: string) =>
      name === "hp_session" ? { value: "tok_abc" } : undefined,
    );
    loadCreatePlanPage.mockImplementation(
      async (read: (name: string) => string | null) =>
        read("hp_session") === "tok_abc"
          ? {
              kind: "ok",
              view: {
                currencies: [
                  { code: "EGP", exponent: 2 },
                  { code: "USD", exponent: 2 },
                ],
              },
            }
          : { kind: "signed_out" },
    );
    const tree = (await CreatePlanPage()) as unknown as {
      props: { children: { props: { initialCurrencies: unknown } } };
    };
    expect(tree.props.children.props.initialCurrencies).toEqual({
      currencies: [
        { code: "EGP", exponent: 2 },
        { code: "USD", exponent: 2 },
      ],
    });
  });

  it("T-001-46/AC-4 passes no initial data when there is no valid session", async () => {
    const tree = await open({ kind: "signed_out" });
    expect(tree.props.children.props.initialCurrencies).toBeNull();
  });

  it("T-001-46/AC-6 lets a loader error propagate to the route's error boundary", async () => {
    loadCreatePlanPage.mockRejectedValue(new Error("database down"));
    await expect(CreatePlanPage()).rejects.toThrow("database down");
  });
});
