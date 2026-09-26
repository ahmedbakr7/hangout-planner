import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/en.json";
import { ConfirmedView } from "@/components/confirmed-view";

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
  "src/app/plans/[planId]/confirmed/page.tsx",
  "src/components/confirmed-view.tsx",
  "src/components/confirmed-view.test.tsx",
];

const PLAN_ID = "pln_confirmedaaaaaaaaaaaa";
const DINNER_ID = "stp_aaaaaaaaaaaaaaaaaaaaaa";
const COFFEE_ID = "stp_cccccccccccccccccccccc";
const CONFIRMED_GET = `/v1/plans/${PLAN_ID}/confirmed`;
const OPENING_GET = `/v1/plans/${PLAN_ID}/opening`;

const leakedExtras = {
  option_labels: ["Koshary"],
  option_label: "Koshary",
  starting_points: [{ name: "Helwan rooftop" }],
  other_starts: ["Zamalek dock"],
  map: "https://maps.example/secret",
  itinerary: { places: ["Secret Cafe"], travel: "0 min" },
  budget: { amount_minor: 50000, currency: "EGP" },
  threshold: 3,
  signals: { like_count: 4, dislike_count: 1 },
  invite_send: true,
};

const leakedFail = {
  error: { code: "upstream", message: "fail", fields: [] },
  title: "Someone else's private plan",
  places: ["Secret Cafe"],
  ...leakedExtras,
  participants: [{ display_name: "Secret Person" }],
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function dinnerStep(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    step_id: DINNER_ID,
    place_name: "Abu Tarek",
    amount_minor: 12000,
    currency: "EGP",
    ...overrides,
  };
}

function coffeeStep(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    step_id: COFFEE_ID,
    place_name: "Cilantro",
    amount_minor: 4000,
    currency: "EGP",
    ...overrides,
  };
}

function lockedBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    plan_id: PLAN_ID,
    title: "Thursday in Maadi",
    state: "locked",
    time: {
      local_date: "2026-10-02",
      local_time: "18:30",
      timezone: "Africa/Cairo",
    },
    steps: [dinnerStep(), coffeeStep()],
    legs: [
      {
        from_step_id: DINNER_ID,
        to_step_id: COFFEE_ID,
        duration_seconds: 840,
      },
    ],
    cohort: [
      { display_name: "Nour", distinguisher: "n8p1" },
      { display_name: "Alex", distinguisher: "a3k9" },
      { display_name: "Alex", distinguisher: "b4m2" },
    ],
    ...leakedExtras,
    ...overrides,
  };
}

function openingBody(next: string): Record<string, unknown> {
  return {
    plan_id: PLAN_ID,
    next,
    preview: {
      title: "Someone else's private plan",
      organizer_display_name: "Secret Person",
      timezone: "Africa/Cairo",
      windows: [],
      budget: { amount_minor: 50000, currency: "EGP" },
      step_names: ["Secret Cafe"],
    },
    ...leakedExtras,
  };
}

type FetchConfig = {
  get?: unknown | "fail" | "not_locked";
  opening?: string | "fail" | "missing";
};

function stubFetch(config: FetchConfig = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url === CONFIRMED_GET && method === "GET") {
      if (config.get === "fail") {
        return jsonResponse(500, leakedFail);
      }
      if (config.get === "not_locked") {
        return jsonResponse(409, {
          ...leakedFail,
          error: {
            code: "conflict",
            reason: "not_locked",
            message: "not locked",
            fields: [],
          },
        });
      }
      return jsonResponse(200, config.get ?? lockedBody());
    }
    if (url === OPENING_GET && method === "GET") {
      if (config.opening === "fail") {
        return jsonResponse(500, leakedFail);
      }
      if (config.opening === "missing") {
        return jsonResponse(404, {
          error: { code: "not_found", message: "not found", fields: [] },
        });
      }
      if (typeof config.opening === "string") {
        return jsonResponse(200, openingBody(config.opening));
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ConfirmedView planId={PLAN_ID} />
    </NextIntlClientProvider>,
  );
}

async function renderLoaded(config: FetchConfig = {}) {
  const fetchMock = stubFetch({ get: lockedBody(), ...config });
  renderView();
  expect(await screen.findByText("Abu Tarek")).toBeTruthy();
  return fetchMock;
}

function classTokens(el: Element): string[] {
  return el.className.split(/\s+/);
}

function placeItem(name: string): HTMLElement {
  const place = screen.getByText(name);
  const item = place.closest("li");
  if (!item) {
    throw new Error(`missing place ${name}`);
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

function expectForbiddenControlsAbsent(): void {
  expect(screen.queryByRole("button", { name: /unlock/i })).toBeNull();
  expect(screen.queryByText(/unlock/i)).toBeNull();
  expect(screen.queryByRole("button", { name: "Like" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Dislike" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Clear signal" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Use this place" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Lock this outing" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
  expect(screen.queryByRole("button", { name: /invite/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /send/i })).toBeNull();
  expect(screen.queryByLabelText(/budget/i)).toBeNull();
  expect(screen.queryByLabelText(/threshold/i)).toBeNull();
  expect(screen.queryByLabelText(/display name/i)).toBeNull();
  expect(screen.queryByLabelText(/start/i)).toBeNull();
  expect(screen.queryByText("Koshary")).toBeNull();
  expect(screen.queryByText("Helwan rooftop")).toBeNull();
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

describe("ConfirmedView chrome", () => {
  it("composes shadcn primitives with DESIGN.md semantic classes and no raw hex", () => {
    const hex = new RegExp("#" + "[0-9a-fA-F]{3,8}\\b");
    const root = process.cwd();
    for (const relative of TICKET_FILES) {
      const source = readFileSync(join(root, relative), "utf8");
      expect(source, relative).not.toMatch(hex);
    }
    const view = readFileSync(join(root, "src/components/confirmed-view.tsx"), "utf8");
    expect(view).toContain('from "@/components/ui/button"');
    expect(view).toContain('from "@/components/ui/card"');
    expect(view).toContain("text-success");
    expect(view).toContain("text-destructive");
    expect(view).toContain("text-muted-foreground");
    expect(view).toContain("bg-background");
    expect(view).toContain('variant="secondary"');
    expect(view).not.toContain("bg-primary");
    expect(view).not.toContain('className="danger"');
    expect(view).not.toContain("var(--accent)");
    expect(view).not.toContain("var(--danger)");
    expect(view.includes("style=" + "{{")).toBe(false);
    expect(view.toLowerCase()).not.toContain("<img");
    expect(view.toLowerCase()).not.toContain("iframe");
    expect(view).not.toContain("starting_points");
    expect(view.toLowerCase()).not.toContain("unlock");
    const page = readFileSync(
      join(root, "src/app/plans/[planId]/confirmed/page.tsx"),
      "utf8",
    );
    expect(page).toContain("ConfirmedView");
    expect(page).toContain("planId");
  });
});

describe("ConfirmedView", () => {
  beforeEach(() => {
    stubFetch({ get: lockedBody() });
  });

  it("before lock this surface is absent, and opening it shows the current surface for that person and state", async () => {
    stubFetch({ get: "not_locked", opening: "organizer" });
    renderView();
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(`/plans/${PLAN_ID}`);
    });
    expect(screen.queryByText("Locked")).toBeNull();
    expect(screen.queryByText("Thursday in Maadi")).toBeNull();
    expect(screen.queryByText("Abu Tarek")).toBeNull();
    expect(screen.queryByText("18:30")).toBeNull();
    expectForbiddenControlsAbsent();
    expectLeakedAbsent();

    cleanup();
    router.replace.mockReset();
    stubFetch({ get: "not_locked", opening: "respond" });
    renderView();
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(`/plans/${PLAN_ID}/respond`);
    });
    expect(screen.queryByText("Locked")).toBeNull();
    expect(screen.queryByText("Abu Tarek")).toBeNull();
    expectLeakedAbsent();

    cleanup();
    router.replace.mockReset();
    stubFetch({ get: "not_locked", opening: "proposal" });
    renderView();
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(`/plans/${PLAN_ID}/proposal`);
    });
    expect(screen.queryByText("Locked")).toBeNull();
    expect(screen.queryByText("Abu Tarek")).toBeNull();
    expect(screen.queryByRole("button", { name: "Lock this outing" })).toBeNull();
    expectLeakedAbsent();
  });

  it("the loaded outing shows state locked, the authored title, the time with the timezone, each step's place name and per-person amount with currency, the travel duration between consecutive places, and the cohort display names", async () => {
    await renderLoaded();
    const locked = screen.getByText("Locked");
    expect(classTokens(locked)).toContain("text-success");
    expect(screen.getByRole("heading", { name: "Thursday in Maadi" })).toBeTruthy();
    expect(screen.getByText("2026-10-02 18:30 Africa/Cairo")).toBeTruthy();

    const dinner = placeItem("Abu Tarek");
    expect(within(dinner).getByText("Abu Tarek")).toBeTruthy();
    expect(within(dinner).getByText("120.00 EGP")).toBeTruthy();
    const coffee = placeItem("Cilantro");
    expect(within(coffee).getByText("Cilantro")).toBeTruthy();
    expect(within(coffee).getByText("40.00 EGP")).toBeTruthy();
    expect(screen.getByText("14 min")).toBeTruthy();

    expect(screen.getByText("Nour")).toBeTruthy();
    expect(screen.getAllByText("Alex")).toHaveLength(2);

    cleanup();
    stubFetch({
      get: lockedBody({
        steps: [dinnerStep(), coffeeStep()],
        legs: [
          {
            from_step_id: DINNER_ID,
            to_step_id: COFFEE_ID,
            duration_seconds: 0,
          },
        ],
      }),
    });
    renderView();
    expect(await screen.findByText("Abu Tarek")).toBeTruthy();
    const dinnerBlank = placeItem("Abu Tarek");
    const captions = dinnerBlank.querySelectorAll(".caption");
    const travel = captions[captions.length - 1];
    expect(travel?.textContent).toBe("");
    expect(travel?.textContent).not.toBe("0");
    expect(screen.queryByText("0 min")).toBeNull();
    expect(screen.queryByText(/^0$/)).toBeNull();
    expect(screen.queryByText("0s")).toBeNull();
  });

  it("the distinguisher is shown only when cohort names collide", async () => {
    await renderLoaded();
    expect(screen.queryByText("n8p1")).toBeNull();
    expect(screen.getByText("a3k9")).toBeTruthy();
    expect(screen.getByText("b4m2")).toBeTruthy();

    cleanup();
    stubFetch({
      get: lockedBody({
        cohort: [
          { display_name: "Nour", distinguisher: "n8p1" },
          { display_name: "Hana", distinguisher: "h2k4" },
        ],
      }),
    });
    renderView();
    expect(await screen.findByText("Nour")).toBeTruthy();
    expect(screen.getByText("Hana")).toBeTruthy();
    expect(screen.queryByText("n8p1")).toBeNull();
    expect(screen.queryByText("h2k4")).toBeNull();
  });

  it("the surface has no unlock, no signals, no starting points, no option labels, no swap, no response fields, no budget editing, no threshold, and no invite send", async () => {
    await renderLoaded();
    expectForbiddenControlsAbsent();
    expect(screen.queryByText("Koshary")).toBeNull();
    expect(screen.queryByLabelText(/window/i)).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  it("the share link and an invitations row for a locked plan land on this surface", () => {
    const root = process.cwd();
    const page = readFileSync(
      join(root, "src/app/plans/[planId]/confirmed/page.tsx"),
      "utf8",
    );
    expect(page).toContain("ConfirmedView");
    expect(page).toContain("planId");

    const joinPanel = readFileSync(
      join(root, "src/components/join-panel.tsx"),
      "utf8",
    );
    expect(joinPanel).toContain("`/plans/${planId}/confirmed`");

    const invite = readFileSync(
      join(root, "src/components/invite-panel.tsx"),
      "utf8",
    );
    expect(invite).toContain("`/plans/${planId}/confirmed`");

    const opening = readFileSync(join(root, "src/server/join/open.ts"), "utf8");
    expect(opening).toContain('state === "locked" ? "confirmed"');
  });

  it("chrome may name Google Places and Google Maps routing, and there is no map image and no native-app install step", async () => {
    await renderLoaded();
    expect(
      screen.getByText(
        "Places from Google Places. Travel times from Google Maps routing.",
      ),
    ).toBeTruthy();
    expectLeakedAbsent();
    expect(screen.queryByRole("img")).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
    expectNoInstall();
  });

  it("a load failure uses text-destructive and retry and omits another plan's title and places", async () => {
    let gets = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === CONFIRMED_GET && method === "GET") {
        gets += 1;
        if (gets === 1) {
          return jsonResponse(500, leakedFail);
        }
        return jsonResponse(200, lockedBody());
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderView();

    const alert = await screen.findByRole("alert");
    expect(classTokens(alert)).toContain("text-destructive");
    expect(alert.textContent).toBe("This outing could not be loaded.");
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(classTokens(retry)).not.toContain("bg-primary");
    expect(screen.queryByText("Thursday in Maadi")).toBeNull();
    expect(screen.queryByText("Abu Tarek")).toBeNull();
    expectLeakedAbsent();

    fireEvent.click(retry);
    expect(await screen.findByText("Abu Tarek")).toBeTruthy();
    expect(screen.getByText("Thursday in Maadi")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expectLeakedAbsent();
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe("same-origin");
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toBeUndefined();
  });

  it("retry stays secondary while copy, save, and swap stay off this surface", async () => {
    stubFetch({ get: "fail" });
    renderView();
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(classTokens(retry)).not.toContain("bg-primary");
    expect(retry.className).toMatch(/secondary/);
    expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Use this place" })).toBeNull();
  });
});
