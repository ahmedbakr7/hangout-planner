import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/en.json";
import { ProposalView } from "@/components/proposal-view";

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
  "src/app/plans/[planId]/proposal/page.tsx",
  "src/components/proposal-view.tsx",
  "src/components/proposal-view.test.tsx",
];

const PLAN_ID = "pln_proposalaaaaaaaaaaaa";
const DINNER_ID = "stp_aaaaaaaaaaaaaaaaaaaaaa";
const COFFEE_ID = "stp_cccccccccccccccccccccc";
const PROPOSAL_GET = `/v1/plans/${PLAN_ID}/proposal`;
const ATTEMPTS_POST = `/v1/plans/${PLAN_ID}/proposal-attempts`;
const LOCK_POST = `/v1/plans/${PLAN_ID}/lock`;
const DINNER_SWAP = `/v1/plans/${PLAN_ID}/steps/${DINNER_ID}/swap`;
const DINNER_SIGNAL = `/v1/plans/${PLAN_ID}/steps/${DINNER_ID}/signal`;

const leakedExtras = {
  title: "Someone else's private plan",
  places: ["Secret Cafe"],
  starting_points: [{ name: "Helwan rooftop" }],
  other_starts: ["Zamalek dock"],
  map: "https://maps.example/secret",
  itinerary: { places: ["Secret Cafe"], travel: "0 min" },
};

const leakedFail = {
  error: { code: "upstream", message: "fail", fields: [] },
  ...leakedExtras,
  participants: [{ display_name: "Secret Person" }],
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function organizerStep(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    step_id: DINNER_ID,
    name: "Dinner",
    option_label: "Koshary",
    place: { name: "Abu Tarek", amount_minor: 12000, currency: "EGP" },
    like_count: 1,
    dislike_count: 0,
    alternatives: [
      {
        google_place_id: "ChIJ-dinner-b",
        name: "Koshary El Tahrir",
        amount_minor: 9000,
        currency: "EGP",
      },
    ],
    ...overrides,
  };
}

function coffeeStep(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    step_id: COFFEE_ID,
    name: "Coffee",
    option_label: "Ahwa",
    place: { name: "Cilantro", amount_minor: 4000, currency: "EGP" },
    like_count: 0,
    dislike_count: 0,
    alternatives: [],
    ...overrides,
  };
}

function proposedBody(
  overrides: Record<string, unknown> = {},
  proposalOverrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    state: "proposed",
    block: null,
    proposal: {
      time: {
        local_date: "2026-10-02",
        local_time: "18:30",
        timezone: "Africa/Cairo",
      },
      attending_count: 2,
      cohort_size: 3,
      cohort: [
        { display_name: "Nour", distinguisher: "n8p1", attending: true },
        { display_name: "Alex", distinguisher: "a3k9", attending: true },
        { display_name: "Alex", distinguisher: "b4m2", attending: false },
      ],
      fairness_warning: false,
      steps: [organizerStep(), coffeeStep()],
      legs: [
        {
          from_step_id: DINNER_ID,
          to_step_id: COFFEE_ID,
          duration_seconds: 840,
        },
      ],
      ...proposalOverrides,
    },
    ...leakedExtras,
    ...overrides,
  };
}

function blockedBody(
  block: { time: boolean; budget: boolean; venue_data: boolean },
): Record<string, unknown> {
  return {
    state: "blocked",
    block,
    proposal: null,
    ...leakedExtras,
  };
}

function collectingBody(): Record<string, unknown> {
  return {
    state: "collecting",
    block: null,
    proposal: null,
    ...leakedExtras,
  };
}

type FetchConfig = {
  get?: unknown | "fail" | "locked" | "not_proposed";
  swap?: unknown | "fail";
  signal?: { signal: string } | "fail";
  lock?: "ok" | "fail";
  attempts?: unknown | "fail";
};

function stubFetch(config: FetchConfig = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url === PROPOSAL_GET && method === "GET") {
      if (config.get === "fail") {
        return jsonResponse(500, leakedFail);
      }
      if (config.get === "locked") {
        return jsonResponse(409, {
          ...leakedFail,
          error: {
            code: "conflict",
            reason: "plan_locked",
            message: "locked",
            fields: [],
          },
        });
      }
      if (config.get === "not_proposed") {
        return jsonResponse(409, {
          ...leakedFail,
          error: {
            code: "conflict",
            reason: "not_proposed",
            message: "not proposed",
            fields: [],
          },
        });
      }
      return jsonResponse(200, config.get ?? proposedBody());
    }
    if (url === DINNER_SWAP && method === "POST") {
      if (config.swap === "fail") {
        return jsonResponse(409, {
          error: {
            code: "conflict",
            reason: "route_unavailable",
            message: "no route",
            fields: [],
          },
        });
      }
      return jsonResponse(200, config.swap ?? proposedBody());
    }
    if (url === DINNER_SIGNAL && method === "PUT") {
      if (config.signal === "fail") {
        return jsonResponse(403, {
          error: {
            code: "forbidden",
            reason: "not_cohort",
            message: "not cohort",
            fields: [],
          },
        });
      }
      return jsonResponse(200, config.signal ?? { signal: "like" });
    }
    if (url === LOCK_POST && method === "POST") {
      if (config.lock === "fail") {
        return jsonResponse(409, {
          error: {
            code: "conflict",
            reason: "not_proposed",
            message: "not proposed",
            fields: [],
          },
        });
      }
      return jsonResponse(200, {
        plan_id: PLAN_ID,
        title: "Thursday in Maadi",
        state: "locked",
        time: {
          local_date: "2026-10-02",
          local_time: "18:30",
          timezone: "Africa/Cairo",
        },
        steps: [
          {
            step_id: DINNER_ID,
            place_name: "Abu Tarek",
            amount_minor: 12000,
            currency: "EGP",
          },
        ],
        legs: [],
        cohort: [{ display_name: "Nour", distinguisher: "n8p1" }],
      });
    }
    if (url === ATTEMPTS_POST && method === "POST") {
      if (config.attempts === "fail") {
        return jsonResponse(409, {
          error: {
            code: "conflict",
            reason: "attempt_in_progress",
            message: "busy",
            fields: [],
          },
        });
      }
      return jsonResponse(200, config.attempts ?? proposedBody());
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ProposalView planId={PLAN_ID} />
    </NextIntlClientProvider>,
  );
}

async function renderLoaded(config: FetchConfig = {}) {
  const fetchMock = stubFetch({ get: proposedBody(), ...config });
  renderView();
  expect(await screen.findByText("Abu Tarek")).toBeTruthy();
  return fetchMock;
}

function classTokens(el: Element): string[] {
  return el.className.split(/\s+/);
}

function stepItem(name: string): HTMLElement {
  const heading = screen.getByRole("heading", { name, level: 2 });
  const item = heading.closest("li");
  if (!item) {
    throw new Error(`missing step ${name}`);
  }
  return item;
}

function expectLeakedAbsent(): void {
  expect(screen.queryByText("Someone else's private plan")).toBeNull();
  expect(screen.queryByText("Secret Cafe")).toBeNull();
  expect(screen.queryByText("Secret Person")).toBeNull();
  expect(screen.queryByText("Helwan rooftop")).toBeNull();
  expect(screen.queryByText("Zamalek dock")).toBeNull();
  expect(screen.queryByRole("img")).toBeNull();
  expect(document.querySelector("iframe")).toBeNull();
  expect(document.querySelector("img")).toBeNull();
}

function expectNoInstall(): void {
  expect(screen.queryByText(/install/i)).toBeNull();
  expect(screen.queryByText(/app store/i)).toBeNull();
  expect(screen.queryByText(/google play/i)).toBeNull();
  expect(screen.queryByText(/native app/i)).toBeNull();
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

describe("ProposalView chrome", () => {
  it("composes shadcn primitives with DESIGN.md semantic classes and no raw hex", () => {
    const hex = new RegExp("#" + "[0-9a-fA-F]{3,8}\\b");
    const root = process.cwd();
    for (const relative of TICKET_FILES) {
      const source = readFileSync(join(root, relative), "utf8");
      expect(source, relative).not.toMatch(hex);
    }
    const view = readFileSync(join(root, "src/components/proposal-view.tsx"), "utf8");
    expect(view).toContain('from "@/components/ui/button"');
    expect(view).toContain('from "@/components/ui/card"');
    expect(view).toContain("bg-primary");
    expect(view).toContain("text-destructive");
    expect(view).toContain("text-warning");
    expect(view).toContain("text-muted-foreground");
    expect(view).not.toContain('className="danger"');
    expect(view).not.toContain("var(--accent)");
    expect(view).not.toContain("var(--danger)");
    expect(view.includes("style=" + "{{")).toBe(false);
    expect(view.toLowerCase()).not.toContain("<img");
    expect(view.toLowerCase()).not.toContain("iframe");
    expect(view).not.toContain("starting_points");
    const page = readFileSync(
      join(root, "src/app/plans/[planId]/proposal/page.tsx"),
      "utf8",
    );
    expect(page).toContain("ProposalView");
    expect(page).toContain("planId");
  });
});

describe("ProposalView", () => {
  beforeEach(() => {
    stubFetch({ get: proposedBody() });
  });

  it("while collecting this surface is not shown and leaked places stay omitted", async () => {
    stubFetch({ get: collectingBody() });
    renderView();
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(`/plans/${PLAN_ID}`);
    });
    expect(screen.queryByText("Abu Tarek")).toBeNull();
    expect(screen.queryByText("18:30")).toBeNull();
    expect(screen.queryByRole("button", { name: "Lock this outing" })).toBeNull();
    expectLeakedAbsent();
  });

  it("while blocked the organizer sees time, budget, and venue-data sentences in text-destructive, and lock is absent", async () => {
    stubFetch({
      get: blockedBody({ time: true, budget: true, venue_data: true }),
    });
    renderView();
    const time = await screen.findByText(
      "No time inside the windows works for the group.",
    );
    const budget = screen.getByText(
      "No place set covers every step under the budget.",
    );
    const venue = screen.getByText(
      "Venue or travel data is unavailable. Retry.",
    );
    expect(classTokens(time)).toContain("text-destructive");
    expect(classTokens(budget)).toContain("text-destructive");
    expect(classTokens(venue)).toContain("text-destructive");
    expect(screen.queryByRole("button", { name: "Lock this outing" })).toBeNull();
    expect(screen.queryByText("Abu Tarek")).toBeNull();
    expect(screen.queryByText("18:30")).toBeNull();
    expectLeakedAbsent();
  });

  it("when time and budget are both true both sentences are visible", async () => {
    stubFetch({
      get: blockedBody({ time: true, budget: true, venue_data: false }),
    });
    renderView();
    expect(
      await screen.findByText("No time inside the windows works for the group."),
    ).toBeTruthy();
    expect(
      screen.getByText("No place set covers every step under the budget."),
    ).toBeTruthy();
    expect(
      screen.queryByText("Venue or travel data is unavailable. Retry."),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Lock this outing" })).toBeNull();
  });

  it("a joined participant while blocked is shown the response surface", async () => {
    stubFetch({ get: "not_proposed" });
    renderView();
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(`/plans/${PLAN_ID}/respond`);
    });
    expect(screen.queryByText("Abu Tarek")).toBeNull();
    expect(
      screen.queryByText("No time inside the windows works for the group."),
    ).toBeNull();
    expectLeakedAbsent();
  });

  it("venue-data offers retry and a missing duration is blank and is not rendered as zero", async () => {
    const fetchMock = stubFetch({
      get: blockedBody({ time: false, budget: false, venue_data: true }),
      attempts: proposedBody(
        {},
        {
          steps: [organizerStep(), coffeeStep()],
          legs: [
            {
              from_step_id: DINNER_ID,
              to_step_id: COFFEE_ID,
              duration_seconds: 0,
            },
          ],
        },
      ),
    });
    renderView();
    const venue = await screen.findByText(
      "Venue or travel data is unavailable. Retry.",
    );
    expect(classTokens(venue)).toContain("text-destructive");
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(classTokens(retry)).not.toContain("bg-primary");
    expect(screen.queryByRole("button", { name: "Lock this outing" })).toBeNull();

    fireEvent.click(retry);
    expect(await screen.findByText("Abu Tarek")).toBeTruthy();
    const posted = fetchMock.mock.calls.find(
      (call) => String(call[0]) === ATTEMPTS_POST,
    );
    expect(posted?.[1]?.method).toBe("POST");
    expect(posted?.[1]?.credentials).toBe("same-origin");
    expect(posted?.[1]?.headers).toMatchObject({ "X-HP-Request": "1" });

    const dinner = stepItem("Dinner");
    const captions = dinner.querySelectorAll(".caption");
    const travel = captions[captions.length - 1];
    expect(travel?.textContent).toBe("");
    expect(travel?.textContent).not.toBe("0");
    expect(screen.queryByText("0 min")).toBeNull();
    expect(screen.queryByText(/^0$/)).toBeNull();
    expect(screen.queryByText("0s")).toBeNull();
  });

  it("a proposed itinerary shows the time with the timezone, who can make it, and cohort display names, and calls the set everyone only when the count equals the cohort size", async () => {
    await renderLoaded();
    expect(screen.getByText("2026-10-02 18:30 Africa/Cairo")).toBeTruthy();
    expect(screen.getByText("2 of 3 can make this time.")).toBeTruthy();
    expect(screen.queryByText("Everyone can make this time.")).toBeNull();
    expect(screen.getByText("Nour")).toBeTruthy();
    expect(screen.getAllByText("Alex")).toHaveLength(2);
    expect(screen.queryByText("n8p1")).toBeNull();
    expect(screen.getByText("a3k9")).toBeTruthy();
    expect(screen.getByText("b4m2")).toBeTruthy();

    cleanup();
    stubFetch({
      get: proposedBody(
        {},
        { attending_count: 3, cohort_size: 3 },
      ),
    });
    renderView();
    expect(await screen.findByText("Everyone can make this time.")).toBeTruthy();
    expect(screen.queryByText("3 of 3 can make this time.")).toBeNull();
  });

  it("each step shows the step name, option label, place name, and per-person amount with currency; legs show a travel duration; starting points and a map are absent", async () => {
    await renderLoaded();
    const dinner = stepItem("Dinner");
    expect(within(dinner).getByText("Dinner")).toBeTruthy();
    expect(within(dinner).getByText("Koshary")).toBeTruthy();
    expect(within(dinner).getByText("Abu Tarek")).toBeTruthy();
    expect(within(dinner).getByText("120.00 EGP")).toBeTruthy();
    const coffee = stepItem("Coffee");
    expect(within(coffee).getByText("Coffee")).toBeTruthy();
    expect(within(coffee).getByText("Ahwa")).toBeTruthy();
    expect(within(coffee).getByText("Cilantro")).toBeTruthy();
    expect(within(coffee).getByText("40.00 EGP")).toBeTruthy();
    expect(screen.getByText("14 min")).toBeTruthy();
    expectLeakedAbsent();
    expect(screen.queryByText("Helwan rooftop")).toBeNull();
  });

  it("the fairness warning uses text-warning, talks about travel time, includes no amount and no currency, and does not hide lock", async () => {
    await renderLoaded({
      get: proposedBody({}, { fairness_warning: true }),
    });
    const warning = screen.getByText("Travel time is uneven for this group.");
    expect(classTokens(warning)).toContain("text-warning");
    expect(warning.textContent?.toLowerCase()).toContain("travel time");
    expect(warning.textContent).not.toMatch(/EGP|USD|SAR|AED/);
    expect(warning.textContent).not.toMatch(/120|40|90/);
    expect(warning.textContent).not.toMatch(/amount|currency|£|\$/);
    const lock = screen.getByRole("button", { name: "Lock this outing" });
    expect(classTokens(lock)).toContain("bg-primary");
  });

  it("the organizer sees at most 3 alternatives; zero alternatives keeps the place and says there is no alternative; swap updates that place and counts show as none; lock uses bg-primary only while proposed", async () => {
    const fourAlts = [
      {
        google_place_id: "ChIJ-alt-one",
        name: "Alt One",
        amount_minor: 8000,
        currency: "EGP",
      },
      {
        google_place_id: "ChIJ-alt-two",
        name: "Alt Two",
        amount_minor: 7000,
        currency: "EGP",
      },
      {
        google_place_id: "ChIJ-alt-three",
        name: "Alt Three",
        amount_minor: 6000,
        currency: "EGP",
      },
      {
        google_place_id: "ChIJ-alt-four",
        name: "Alt Four",
        amount_minor: 5000,
        currency: "EGP",
      },
    ];
    const fetchMock = await renderLoaded({
      get: proposedBody(
        {},
        {
          steps: [
            organizerStep({ alternatives: fourAlts }),
            coffeeStep({ like_count: 2, dislike_count: 1 }),
          ],
        },
      ),
      swap: proposedBody(
        {},
        {
          steps: [
            organizerStep({
              place: {
                name: "Koshary El Tahrir",
                amount_minor: 9000,
                currency: "EGP",
              },
              like_count: 0,
              dislike_count: 0,
              alternatives: [
                {
                  google_place_id: "ChIJ-dinner-a",
                  name: "Abu Tarek",
                  amount_minor: 12000,
                  currency: "EGP",
                },
              ],
            }),
            coffeeStep({ like_count: 2, dislike_count: 1 }),
          ],
        },
      ),
    });

    expect(screen.getByText("Alt One")).toBeTruthy();
    expect(screen.getByText("Alt Two")).toBeTruthy();
    expect(screen.getByText("Alt Three")).toBeTruthy();
    expect(screen.queryByText("Alt Four")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Use this place" })).toHaveLength(
      3,
    );
    expect(screen.getByText("Cilantro")).toBeTruthy();
    expect(within(stepItem("Coffee")).getByText("There is no alternative.")).toBeTruthy();
    expect(within(stepItem("Coffee")).queryByRole("button", { name: "Use this place" })).toBeNull();

    const lock = screen.getByRole("button", { name: "Lock this outing" });
    expect(classTokens(lock)).toContain("bg-primary");
    const swapButtons = screen.getAllByRole("button", { name: "Use this place" });
    const swap = swapButtons[0];
    expect(swap).toBeTruthy();
    expect(classTokens(swap as HTMLElement)).not.toContain("bg-primary");

    fireEvent.click(swap as HTMLElement);
    expect(await screen.findByText("No likes or dislikes yet.")).toBeTruthy();
    expect(screen.getByText("Koshary El Tahrir")).toBeTruthy();
    const swapped = fetchMock.mock.calls.find(
      (call) => String(call[0]) === DINNER_SWAP,
    );
    expect(swapped?.[1]?.method).toBe("POST");
    expect(swapped?.[1]?.credentials).toBe("same-origin");
    expect(swapped?.[1]?.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-HP-Request": "1",
    });
    expect(JSON.parse(String(swapped?.[1]?.body))).toEqual({
      google_place_id: "ChIJ-alt-one",
    });
    expect(screen.getByRole("button", { name: "Lock this outing" })).toBeTruthy();
  });

  it("a cohort member sees their own signal and does not see counts, swap, or lock; a joined person outside the cohort sees the itinerary without signal controls; chrome may name Google Places and Google Maps routing and offers no native-app install step", async () => {
    const cohortProposal = proposedBody(
      {},
      {
        steps: [
          {
            step_id: DINNER_ID,
            name: "Dinner",
            option_label: "Koshary",
            place: { name: "Abu Tarek", amount_minor: 12000, currency: "EGP" },
            my_signal: "like",
          },
          {
            step_id: COFFEE_ID,
            name: "Coffee",
            option_label: "Ahwa",
            place: { name: "Cilantro", amount_minor: 4000, currency: "EGP" },
            my_signal: "unset",
          },
        ],
      },
    );
    const fetchMock = stubFetch({
      get: cohortProposal,
      signal: { signal: "dislike" },
    });
    renderView();
    expect(await screen.findByText("Abu Tarek")).toBeTruthy();
    const like = screen.getAllByRole("button", { name: "Like" })[0];
    expect(like?.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText("No likes or dislikes yet.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Use this place" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Lock this outing" })).toBeNull();
    expect(
      screen.getByText(
        "Places from Google Places. Travel times from Google Maps routing.",
      ),
    ).toBeTruthy();
    expectNoInstall();

    fireEvent.click(screen.getAllByRole("button", { name: "Dislike" })[0] as HTMLElement);
    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: "Dislike" })[0]?.getAttribute(
          "aria-pressed",
        ),
      ).toBe("true");
    });
    const signaled = fetchMock.mock.calls.find(
      (call) => String(call[0]) === DINNER_SIGNAL,
    );
    expect(signaled?.[1]?.method).toBe("PUT");
    expect(signaled?.[1]?.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-HP-Request": "1",
    });
    expect(JSON.parse(String(signaled?.[1]?.body))).toEqual({ signal: "dislike" });

    cleanup();
    stubFetch({
      get: proposedBody(
        {},
        {
          steps: [
            {
              step_id: DINNER_ID,
              name: "Dinner",
              option_label: "Koshary",
              place: { name: "Abu Tarek", amount_minor: 12000, currency: "EGP" },
            },
            {
              step_id: COFFEE_ID,
              name: "Coffee",
              option_label: "Ahwa",
              place: { name: "Cilantro", amount_minor: 4000, currency: "EGP" },
            },
          ],
        },
      ),
    });
    renderView();
    expect(await screen.findByText("Abu Tarek")).toBeTruthy();
    expect(screen.getByText("Cilantro")).toBeTruthy();
    expect(screen.getByText("14 min")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Like" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Dislike" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear signal" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Use this place" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Lock this outing" })).toBeNull();
    expect(
      screen.getByText(
        "Places from Google Places. Travel times from Google Maps routing.",
      ),
    ).toBeTruthy();
    expectNoInstall();
  });

  it("a load failure uses text-destructive and retry and omits another plan's places; a locked open shows the confirmed surface", async () => {
    let gets = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === PROPOSAL_GET && method === "GET") {
        gets += 1;
        if (gets === 1) {
          return jsonResponse(500, leakedFail);
        }
        return jsonResponse(200, proposedBody());
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderView();

    const alert = await screen.findByRole("alert");
    expect(classTokens(alert)).toContain("text-destructive");
    expect(alert.textContent).toBe("This proposal could not be loaded.");
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(classTokens(retry)).not.toContain("bg-primary");
    expectLeakedAbsent();
    expect(screen.queryByText("Abu Tarek")).toBeNull();

    fireEvent.click(retry);
    expect(await screen.findByText("Abu Tarek")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expectLeakedAbsent();
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe("same-origin");

    cleanup();
    router.replace.mockReset();
    stubFetch({ get: "locked" });
    renderView();
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(`/plans/${PLAN_ID}/confirmed`);
    });
    expect(screen.queryByText("Abu Tarek")).toBeNull();
    expectLeakedAbsent();
    expect(screen.queryByRole("button", { name: "Lock this outing" })).toBeNull();
  });

  it("lock posts with CSRF and is the primary action while swap and retry stay secondary", async () => {
    const fetchMock = await renderLoaded({ lock: "ok" });
    const lock = screen.getByRole("button", { name: "Lock this outing" });
    expect(classTokens(lock)).toContain("bg-primary");
    expect(
      classTokens(screen.getByRole("button", { name: "Use this place" })),
    ).not.toContain("bg-primary");
    fireEvent.click(lock);
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(`/plans/${PLAN_ID}/confirmed`);
    });
    const posted = fetchMock.mock.calls.find(
      (call) => String(call[0]) === LOCK_POST,
    );
    expect(posted?.[1]?.method).toBe("POST");
    expect(posted?.[1]?.credentials).toBe("same-origin");
    expect(posted?.[1]?.headers).toMatchObject({ "X-HP-Request": "1" });
  });
});
