import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/en.json";
import { OrganizerPlan } from "@/components/organizer-plan";

const { router } = vi.hoisted(() => ({
  router: {
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

const TICKET_FILES = [
  "src/app/plans/[planId]/page.tsx",
  "src/components/organizer-plan.tsx",
  "src/components/organizer-plan.test.tsx",
];

const collectingId = "pln_collectingaaaaaaaaaaaa";
const blockedId = "pln_blockedaaaaaaaaaaaaaa";
const proposedId = "pln_proposedaaaaaaaaaaaaa";
const lockedId = "pln_lockedaaaaaaaaaaaaaaa";

const openEditable = {
  title: true,
  timezone: true,
  windows: true,
  budget: "any" as const,
  currency: true,
  threshold: "any" as const,
  steps: true,
};

const answeredEditable = {
  title: true,
  timezone: false,
  windows: false,
  budget: "raise" as const,
  currency: false,
  threshold: "lower" as const,
  steps: false,
};

const blockedEditable = {
  title: true,
  timezone: false,
  windows: false,
  budget: "raise" as const,
  currency: false,
  threshold: "frozen" as const,
  steps: false,
};

const proposedEditable = {
  title: true,
  timezone: false,
  windows: false,
  budget: "frozen" as const,
  currency: false,
  threshold: "frozen" as const,
  steps: false,
};

const leakedPlan = {
  id: "pln_otheraccountaaaaaaaaa",
  title: "Someone else's private plan",
  state: "collecting",
  timezone: "Africa/Cairo",
  windows: [
    {
      id: "win_otheraaaaaaaaaaaaaaaa",
      local_date: "2026-11-01",
      start_local: "12:00",
      end_local: "14:00",
    },
  ],
  budget: { amount_minor: 90000, currency: "USD" },
  steps: [
    {
      id: "stp_otheraaaaaaaaaaaaaaaa",
      name: "Hidden venue",
      options: [{ id: "opt_otheraaaaaaaaaaaaaaaa", label: "Secret Cafe" }],
    },
  ],
  threshold: 9,
  answered_count: 9,
  in_progress_count: 1,
  participants: [
    {
      id: "prt_secretaaaaaaaaaaaaaaa",
      display_name: "Secret Person",
      distinguisher: "zzzz",
      status: "answered",
    },
  ],
  editable: openEditable,
};

function basePlan(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: "Thursday in Maadi",
    state: "collecting",
    timezone: "Africa/Cairo",
    windows: [
      {
        id: "win_aaaaaaaaaaaaaaaaaaaaaa",
        local_date: "2026-10-02",
        start_local: "18:00",
        end_local: "23:00",
      },
    ],
    budget: { amount_minor: 50000, currency: "EGP" },
    steps: [
      {
        id: "stp_aaaaaaaaaaaaaaaaaaaaaa",
        name: "Dinner",
        options: [
          { id: "opt_aaaaaaaaaaaaaaaaaaaaaa", label: "Koshary" },
          { id: "opt_bbbbbbbbbbbbbbbbbbbbbb", label: "Grills" },
        ],
      },
    ],
    threshold: 3,
    answered_count: 1,
    in_progress_count: 2,
    participants: [
      {
        id: "prt_hanaaaaaaaaaaaaaaaaa",
        display_name: "Hana",
        distinguisher: "k7m2",
        status: "answered",
        start: "Helwan rooftop",
        start_name: "Helwan rooftop",
        picks: ["Koshary"],
      },
      {
        id: "prt_alexoneaaaaaaaaaaaaa",
        display_name: "Alex",
        distinguisher: "a3k9",
        status: "in_progress",
      },
      {
        id: "prt_alextwoaaaaaaaaaaaaa",
        display_name: "Alex",
        distinguisher: "b4m2",
        status: "answered",
      },
    ],
    editable: answeredEditable,
    itinerary: {
      time: "19:00",
      places: ["Secret Cafe"],
      travel: "12 min",
    },
    proposal: { time: "19:00", place: "Secret Cafe" },
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubPlanFetch(
  planId: string,
  config: {
    get?: unknown | "fail" | "locked";
    getStatus?: number;
    patch?: unknown | "frozen" | "fail";
  } = {},
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url === `/v1/plans/${planId}` && method === "GET") {
      if (config.get === "fail") {
        return jsonResponse(config.getStatus ?? 500, {
          error: { code: "upstream", message: "fail", fields: [] },
          ...leakedPlan,
        });
      }
      if (config.get === "locked") {
        return jsonResponse(409, {
          error: {
            code: "conflict",
            reason: "plan_locked",
            message: "locked",
            fields: [],
          },
          title: "Sunday brunch",
          participants: [
            {
              id: "prt_lockedaaaaaaaaaaaaaa",
              display_name: "Locked Person",
              distinguisher: "l0ck",
              status: "answered",
            },
          ],
          itinerary: { place: "Secret Cafe" },
        });
      }
      return jsonResponse(200, config.get ?? basePlan(planId));
    }
    if (url === `/v1/plans/${planId}` && method === "PATCH") {
      if (config.patch === "frozen") {
        return jsonResponse(409, {
          error: {
            code: "conflict",
            reason: "field_frozen",
            message: "frozen",
            fields: [{ path: "budget", code: "frozen" }],
          },
        });
      }
      if (config.patch === "fail") {
        return jsonResponse(500, {
          error: { code: "upstream", message: "fail", fields: [] },
        });
      }
      return jsonResponse(200, config.patch ?? basePlan(planId));
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderPlan(planId: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <OrganizerPlan planId={planId} />
    </NextIntlClientProvider>,
  );
}

function participantItem(name: string, index = 0): HTMLElement {
  const matches = screen.getAllByText(name);
  const item = matches[index]?.closest("li");
  if (!item) {
    throw new Error(`no list item for ${name}`);
  }
  return item;
}

function classTokens(el: Element): string[] {
  return el.className.split(/\s+/);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  router.push.mockReset();
  router.replace.mockReset();
  router.refresh.mockReset();
  document.cookie = "hp_locale=;path=/;max-age=0";
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
});

describe("OrganizerPlan chrome", () => {
  it("composes shadcn primitives with DESIGN.md semantic classes and no raw hex", () => {
    const hex = new RegExp("#" + "[0-9a-fA-F]{3,8}\\b");
    const root = process.cwd();
    for (const relative of TICKET_FILES) {
      const source = readFileSync(join(root, relative), "utf8");
      expect(source, relative).not.toMatch(hex);
    }
    const plan = readFileSync(join(root, "src/components/organizer-plan.tsx"), "utf8");
    expect(plan).toContain('from "@/components/ui/button"');
    expect(plan).toContain('from "@/components/ui/input"');
    expect(plan).toContain('from "@/components/ui/label"');
    expect(plan).toContain('from "@/components/ui/card"');
    expect(plan).toContain("bg-primary");
    expect(plan).toContain("text-destructive");
    expect(plan).toContain("text-muted-foreground");
    expect(plan).toContain("text-success");
    expect(plan).toContain("text-warning");
    expect(plan).not.toContain('className="danger"');
    expect(plan).not.toContain("var(--accent)");
    expect(plan).not.toContain("var(--danger)");
    expect(plan.includes("style=" + "{{")).toBe(false);
  });
});

describe("OrganizerPlan", () => {
  beforeEach(() => {
    stubPlanFetch(collectingId);
  });

  it("shows answered count, in-progress count, threshold, and each participant display name with status in progress or answered", async () => {
    stubPlanFetch(collectingId, { get: basePlan(collectingId) });
    renderPlan(collectingId);

    expect(await screen.findByText("Thursday in Maadi")).toBeTruthy();
    expect(screen.getByText("1 answered of 3")).toBeTruthy();
    expect(screen.getByText("2 in progress")).toBeTruthy();

    const hana = participantItem("Hana");
    expect(hana.textContent).toContain("answered");
    expect(hana.textContent).not.toContain("in progress");
    expect(hana.querySelector(".text-success")?.textContent).toBe("answered");

    const alexInProgress = participantItem("Alex", 0);
    expect(alexInProgress.textContent).toContain("in progress");
    expect(alexInProgress.querySelector(".text-warning")?.textContent).toBe(
      "in progress",
    );

    const alexAnswered = participantItem("Alex", 1);
    expect(alexAnswered.textContent).toContain("answered");
    expect(alexAnswered.querySelector(".text-success")?.textContent).toBe("answered");
  });

  it("shows the distinguisher only when another row in that list has the same display name, and the list has no starting points and no step picks", async () => {
    stubPlanFetch(collectingId, { get: basePlan(collectingId) });
    renderPlan(collectingId);

    expect(await screen.findByText("Hana")).toBeTruthy();
    expect(participantItem("Hana").textContent).not.toContain("k7m2");
    expect(screen.queryByText("k7m2")).toBeNull();

    expect(participantItem("Alex", 0).textContent).toContain("a3k9");
    expect(participantItem("Alex", 1).textContent).toContain("b4m2");
    expect(screen.getByText("a3k9")).toBeTruthy();
    expect(screen.getByText("b4m2")).toBeTruthy();

    expect(screen.queryByText("Helwan rooftop")).toBeNull();
    expect(participantItem("Hana").textContent).not.toContain("Helwan");
    expect(participantItem("Hana").textContent).not.toContain("Koshary");
    expect(participantItem("Alex", 0).textContent).not.toContain("Koshary");
    expect(participantItem("Alex", 0).textContent).not.toContain("Grills");
  });

  it("while collecting there is no itinerary, and the waiting copy uses text-muted-foreground", async () => {
    stubPlanFetch(collectingId, {
      get: basePlan(collectingId, {
        answered_count: 0,
        in_progress_count: 0,
        participants: [],
        editable: openEditable,
      }),
    });
    renderPlan(collectingId);

    const waiting = await screen.findByText("The proposal waits for answers.");
    expect(classTokens(waiting)).toContain("text-muted-foreground");
    expect(classTokens(waiting)).not.toContain("text-destructive");
    expect(screen.queryByRole("link", { name: "Open proposal" })).toBeNull();
    expect(screen.queryByText("Secret Cafe")).toBeNull();
    expect(screen.queryByText("12 min")).toBeNull();
    expect(screen.queryByText(/itinerary/i)).toBeNull();
    expect(screen.getByText("0 answered of 3")).toBeTruthy();
    expect(screen.getByText("0 in progress")).toBeTruthy();
    expect(classTokens(screen.getByRole("link", { name: "Invite" }))).toContain(
      "bg-primary",
    );
    expect(
      classTokens(screen.getByRole("button", { name: "Save" })),
    ).not.toContain("bg-primary");
  });

  it("while blocked or proposed the same counts remain and there is a way to the proposal surface; the itinerary is not duplicated on this page", async () => {
    stubPlanFetch(blockedId, {
      get: basePlan(blockedId, {
        state: "blocked",
        title: "Friday downtown",
        editable: blockedEditable,
      }),
    });
    renderPlan(blockedId);

    expect(await screen.findByText("Friday downtown")).toBeTruthy();
    expect(screen.getByText("1 answered of 3")).toBeTruthy();
    expect(screen.getByText("2 in progress")).toBeTruthy();
    const blockedProposal = screen.getByRole("link", { name: "Open proposal" });
    expect(blockedProposal.getAttribute("href")).toBe(
      `/plans/${blockedId}/proposal`,
    );
    expect(classTokens(blockedProposal)).toContain("bg-primary");
    expect(classTokens(screen.getByRole("link", { name: "Invite" }))).not.toContain(
      "bg-primary",
    );
    expect(screen.queryByText("The proposal waits for answers.")).toBeNull();
    expect(screen.queryByText("Secret Cafe")).toBeNull();
    expect(screen.queryByText(/itinerary/i)).toBeNull();

    cleanup();

    stubPlanFetch(proposedId, {
      get: basePlan(proposedId, {
        state: "proposed",
        title: "Saturday walk",
        editable: proposedEditable,
      }),
    });
    renderPlan(proposedId);

    expect(await screen.findByText("Saturday walk")).toBeTruthy();
    expect(screen.getByText("1 answered of 3")).toBeTruthy();
    expect(screen.getByText("2 in progress")).toBeTruthy();
    const proposedProposal = screen.getByRole("link", { name: "Open proposal" });
    expect(proposedProposal.getAttribute("href")).toBe(
      `/plans/${proposedId}/proposal`,
    );
    expect(classTokens(proposedProposal)).toContain("bg-primary");
    expect(classTokens(screen.getByRole("link", { name: "Invite" }))).not.toContain(
      "bg-primary",
    );
    expect(screen.queryByText("Secret Cafe")).toBeNull();
    expect(screen.queryByText("12 min")).toBeNull();
    expect(screen.queryByText(/itinerary/i)).toBeNull();
  });

  it("edit controls follow editable for the current state, budget shows the currency, and a rejected edit leaves the stored value and says the field can no longer be changed", async () => {
    stubPlanFetch(collectingId, {
      get: basePlan(collectingId, {
        answered_count: 0,
        in_progress_count: 0,
        participants: [],
        editable: openEditable,
      }),
    });
    renderPlan(collectingId);

    expect(await screen.findByLabelText("Plan title")).toBeTruthy();
    expect((screen.getByLabelText("Plan title") as HTMLInputElement).disabled).toBe(
      false,
    );
    expect((screen.getByLabelText("Timezone") as HTMLInputElement).disabled).toBe(
      false,
    );
    expect((screen.getByLabelText("Date") as HTMLInputElement).disabled).toBe(
      false,
    );
    expect((screen.getByLabelText("Currency") as HTMLSelectElement).disabled).toBe(
      false,
    );
    expect((screen.getByLabelText("Currency") as HTMLSelectElement).value).toBe(
      "EGP",
    );
    expect(
      (screen.getByLabelText("Per-person amount") as HTMLInputElement).value,
    ).toBe("500.00");
    expect(
      (screen.getByLabelText("Step name") as HTMLInputElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByLabelText("Answered threshold") as HTMLInputElement).disabled,
    ).toBe(false);
    expect(
      classTokens(screen.getByRole("button", { name: "Save" })),
    ).not.toContain("bg-primary");

    cleanup();

    const fetchMock = stubPlanFetch(collectingId, {
      get: basePlan(collectingId),
      patch: "frozen",
    });
    renderPlan(collectingId);

    await screen.findByLabelText("Plan title");
    expect((screen.getByLabelText("Plan title") as HTMLInputElement).disabled).toBe(
      false,
    );
    expect((screen.getByLabelText("Timezone") as HTMLInputElement).disabled).toBe(
      true,
    );
    expect((screen.getByLabelText("Date") as HTMLInputElement).disabled).toBe(
      true,
    );
    expect((screen.getByLabelText("Currency") as HTMLSelectElement).disabled).toBe(
      true,
    );
    expect((screen.getByLabelText("Currency") as HTMLSelectElement).value).toBe(
      "EGP",
    );
    expect(
      (screen.getByLabelText("Per-person amount") as HTMLInputElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByLabelText("Step name") as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("Answered threshold") as HTMLInputElement).disabled,
    ).toBe(false);
    expect(
      screen.getAllByText("This can no longer be changed.").length,
    ).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Per-person amount"), {
      target: { value: "100.00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(
        (screen.getByLabelText("Per-person amount") as HTMLInputElement).value,
      ).toBe("500.00");
    });
    expect(
      (screen.getByLabelText("Per-person amount") as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      screen.getAllByText("This can no longer be changed.").length,
    ).toBeGreaterThan(0);
    expect(screen.getByLabelText("Per-person amount").getAttribute("aria-invalid")).toBe(
      "true",
    );

    const patchCall = fetchMock.mock.calls.find(
      (call) => (call[1]?.method ?? "GET") === "PATCH",
    );
    expect(patchCall?.[1]?.credentials).toBe("same-origin");
    expect(patchCall?.[1]?.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-HP-Request": "1",
    });
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
      budget: { amount_minor: 10000, currency: "EGP" },
    });
  });

  it("an invite action is present while collecting, blocked, or proposed", async () => {
    stubPlanFetch(collectingId, { get: basePlan(collectingId) });
    renderPlan(collectingId);
    const collectingInvite = await screen.findByRole("link", { name: "Invite" });
    expect(collectingInvite.getAttribute("href")).toBe(
      `/plans/${collectingId}/invite`,
    );
    expect(classTokens(collectingInvite)).toContain("bg-primary");

    cleanup();
    stubPlanFetch(blockedId, {
      get: basePlan(blockedId, {
        state: "blocked",
        editable: blockedEditable,
      }),
    });
    renderPlan(blockedId);
    const blockedInvite = await screen.findByRole("link", { name: "Invite" });
    expect(blockedInvite.getAttribute("href")).toBe(`/plans/${blockedId}/invite`);
    expect(classTokens(blockedInvite)).not.toContain("bg-primary");

    cleanup();
    stubPlanFetch(proposedId, {
      get: basePlan(proposedId, {
        state: "proposed",
        editable: proposedEditable,
      }),
    });
    renderPlan(proposedId);
    const proposedInvite = await screen.findByRole("link", { name: "Invite" });
    expect(proposedInvite.getAttribute("href")).toBe(
      `/plans/${proposedId}/invite`,
    );
    expect(classTokens(proposedInvite)).not.toContain("bg-primary");
  });

  it("a locked open shows the confirmed surface instead of this page", async () => {
    stubPlanFetch(lockedId, { get: "locked" });
    renderPlan(lockedId);

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(
        `/plans/${lockedId}/confirmed`,
      );
    });
    expect(screen.queryByText("Sunday brunch")).toBeNull();
    expect(screen.queryByText("Locked Person")).toBeNull();
    expect(screen.queryByText("Secret Cafe")).toBeNull();
    expect(screen.queryByRole("link", { name: "Invite" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Open proposal" })).toBeNull();
  });

  it("a load failure uses text-destructive and retry and omits any other plan's title, people, and places", async () => {
    let gets = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === `/v1/plans/${collectingId}` && method === "GET") {
        gets += 1;
        if (gets === 1) {
          return jsonResponse(500, {
            error: { code: "upstream", message: "fail", fields: [] },
            ...leakedPlan,
          });
        }
        return jsonResponse(200, basePlan(collectingId));
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPlan(collectingId);

    const alert = await screen.findByRole("alert");
    expect(classTokens(alert)).toContain("text-destructive");
    expect(alert.textContent).toBe("This plan could not be loaded.");
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(classTokens(retry)).not.toContain("bg-primary");
    expect(screen.queryByText("Someone else's private plan")).toBeNull();
    expect(screen.queryByText("Secret Person")).toBeNull();
    expect(screen.queryByText("Hidden venue")).toBeNull();
    expect(screen.queryByText("Secret Cafe")).toBeNull();
    expect(screen.queryByText("Thursday in Maadi")).toBeNull();
    expect(screen.queryByText("Hana")).toBeNull();
    expect(screen.queryByText("Alex")).toBeNull();

    fireEvent.click(retry);

    expect(await screen.findByText("Thursday in Maadi")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Someone else's private plan")).toBeNull();
    expect(screen.queryByText("Secret Person")).toBeNull();

    const planGets = fetchMock.mock.calls.filter(
      (call) => String(call[0]) === `/v1/plans/${collectingId}`,
    );
    expect(planGets.length).toBeGreaterThanOrEqual(2);
    expect(planGets[0]?.[1]?.credentials).toBe("same-origin");
  });
});
