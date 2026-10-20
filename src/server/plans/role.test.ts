import { describe, expect, it } from "vitest";
import type { PlanRow } from "@/server/plans/http";
import { planRoleForCookies } from "@/server/plans/role";

const plan = {
  id: "pln_0000000000000000000000",
  organizerAccountId: "acc_0000000000000000000000",
  joinToken: "jt_presented",
} as PlanRow;

const noCookies = () => null;

describe("planRoleForCookies requestJoinToken", () => {
  it("treats a caller who presents the plan's join token as a link reader", async () => {
    expect(await planRoleForCookies(noCookies, plan, "jt_presented")).toBe(
      "link_reader",
    );
  });

  it("gives no role to a caller who presents a different join token", async () => {
    expect(await planRoleForCookies(noCookies, plan, "jt_other")).toBeNull();
  });

  it("sends no join token when the argument is omitted", async () => {
    expect(await planRoleForCookies(noCookies, plan)).toBeNull();
  });
});
