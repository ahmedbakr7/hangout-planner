import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/en.json";
import { ResponseForm } from "@/components/response-form";

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
  "src/app/plans/[planId]/respond/page.tsx",
  "src/components/response-form.tsx",
  "src/components/response-form.test.tsx",
];

const PLAN_ID = "pln_respondaaaaaaaaaaaaaa";
const RESPONSE_GET = `/v1/plans/${PLAN_ID}/response`;
const RESPONSE_PUT = `/v1/plans/${PLAN_ID}/response`;
const SEARCH_PREFIX = `/v1/plans/${PLAN_ID}/place-searches`;

const windowOne = {
  id: "win_aaaaaaaaaaaaaaaaaaaaaa",
  local_date: "2026-10-02",
  start_local: "18:00",
  end_local: "23:00",
};

const windowTwo = {
  id: "win_bbbbbbbbbbbbbbbbbbbbbb",
  local_date: "2026-10-03",
  start_local: "17:00",
  end_local: "22:00",
};

const dinner = {
  id: "stp_aaaaaaaaaaaaaaaaaaaaaa",
  name: "Dinner",
  options: [
    { id: "opt_aaaaaaaaaaaaaaaaaaaaaa", label: "Koshary" },
    { id: "opt_bbbbbbbbbbbbbbbbbbbbbb", label: "Grills" },
  ],
};

const coffee = {
  id: "stp_cccccccccccccccccccccc",
  name: "Coffee",
  options: [
    { id: "opt_cccccccccccccccccccccc", label: "Ahwa" },
    { id: "opt_dddddddddddddddddddddd", label: "Specialty" },
  ],
};

const emptyResponse = {
  complete: false,
  windows: [],
  start: null,
  picks: [],
};

const leakedExtras = {
  answered_count: 4,
  threshold: 6,
  participants: [
    {
      display_name: "Secret Person",
      start: "Helwan rooftop",
    },
  ],
  other_starting_points: [{ name: "Zamalek dock" }],
  itinerary: { places: ["Secret Cafe"] },
  map: "https://maps.example/secret",
};

const collectingBody = {
  title: "Thursday in Maadi",
  plan_state: "collecting" as const,
  timezone: "Africa/Cairo",
  budget: { amount_minor: 50000, currency: "EGP" },
  windows: [windowOne, windowTwo],
  steps: [dinner, coffee],
  response: emptyResponse,
  ...leakedExtras,
};

const blockedBody = {
  ...collectingBody,
  plan_state: "blocked" as const,
};

const leakedFail = {
  error: { code: "upstream", message: "fail", fields: [] },
  title: "Someone else's private plan",
  organizer_display_name: "Hidden Host",
  participants: [{ display_name: "Secret Person", status: "answered" }],
  places: ["Secret Cafe"],
  start: { name: "Hidden venue" },
  answered_count: 9,
  threshold: 3,
};

const searchHits = {
  results: [{ google_place_id: "ChIJ-maadi", name: "Maadi, Cairo" }],
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type FetchConfig = {
  get?:
    | "collecting"
    | "blocked"
    | "fail"
    | "proposed"
    | "locked"
    | "complete"
    | "draft";
  put?: "ok-incomplete" | "ok-complete" | "fail" | "invalid";
  search?: "ok" | "fail" | "empty";
};

function getBody(kind: NonNullable<FetchConfig["get"]>): {
  status: number;
  body: unknown;
} {
  if (kind === "fail") {
    return { status: 500, body: leakedFail };
  }
  if (kind === "proposed") {
    return {
      status: 409,
      body: {
        ...leakedFail,
        error: {
          code: "conflict",
          reason: "responses_closed",
          message: "closed",
          fields: [],
        },
      },
    };
  }
  if (kind === "locked") {
    return {
      status: 409,
      body: {
        ...leakedFail,
        error: {
          code: "conflict",
          reason: "plan_locked",
          message: "locked",
          fields: [],
        },
      },
    };
  }
  if (kind === "complete") {
    return {
      status: 200,
      body: {
        ...collectingBody,
        response: {
          complete: true,
          windows: [
            {
              window_id: windowOne.id,
              kind: "free",
              earliest_local: "18:30",
              latest_local: "21:00",
            },
            { window_id: windowTwo.id, kind: "busy" },
          ],
          start: { name: "Maadi, Cairo", google_place_id: "ChIJ-hidden", lat: 29.96 },
          picks: [
            { step_id: dinner.id, option_id: dinner.options[0]?.id },
            { step_id: coffee.id, option_id: coffee.options[0]?.id },
          ],
        },
      },
    };
  }
  if (kind === "draft") {
    return {
      status: 200,
      body: {
        ...collectingBody,
        response: {
          complete: false,
          windows: [{ window_id: windowOne.id, kind: "busy" }],
          start: { name: "Maadi, Cairo" },
          picks: [{ step_id: dinner.id, option_id: dinner.options[0]?.id }],
        },
      },
    };
  }
  if (kind === "blocked") {
    return { status: 200, body: blockedBody };
  }
  return { status: 200, body: collectingBody };
}

function stubFetch(config: FetchConfig = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url === RESPONSE_GET && method === "GET") {
      const result = getBody(config.get ?? "collecting");
      return jsonResponse(result.status, result.body);
    }
    if (url.startsWith(SEARCH_PREFIX) && method === "GET") {
      if (config.search === "fail") {
        return jsonResponse(500, {
          error: { code: "upstream", message: "search fail", fields: [] },
        });
      }
      if (config.search === "empty") {
        return jsonResponse(200, { results: [] });
      }
      return jsonResponse(200, searchHits);
    }
    if (url === RESPONSE_PUT && method === "PUT") {
      if (config.put === "fail") {
        return jsonResponse(500, {
          error: { code: "upstream", message: "save failed", fields: [] },
          answered_count: 99,
        });
      }
      if (config.put === "invalid") {
        return jsonResponse(400, {
          error: {
            code: "validation_failed",
            message: "invalid",
            fields: [{ path: "windows[0].earliest_local", code: "outside_window" }],
          },
        });
      }
      if (config.put === "ok-complete") {
        return jsonResponse(200, {
          complete: true,
          first_completion: true,
          plan_state: "collecting",
        });
      }
      return jsonResponse(200, {
        complete: false,
        first_completion: false,
        plan_state: "collecting",
      });
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderForm() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ResponseForm planId={PLAN_ID} />
    </NextIntlClientProvider>,
  );
}

async function renderLoaded(config: FetchConfig = {}) {
  const fetchMock = stubFetch({ get: "collecting", ...config });
  renderForm();
  await screen.findByLabelText(/approximate/i);
  return fetchMock;
}

function putCall(fetchMock: ReturnType<typeof stubFetch>): RequestInit | undefined {
  const match = fetchMock.mock.calls.find(
    (call) => String(call[0]) === RESPONSE_PUT && (call[1]?.method ?? "GET") === "PUT",
  );
  return match?.[1];
}

function getCall(fetchMock: ReturnType<typeof stubFetch>): RequestInit | undefined {
  const match = fetchMock.mock.calls.find(
    (call) => String(call[0]) === RESPONSE_GET && (call[1]?.method ?? "GET") === "GET",
  );
  return match?.[1];
}

function classTokens(el: Element): string[] {
  return el.className.split(/\s+/);
}

function expectForbiddenAbsent(): void {
  expect(screen.queryByText("4 of 6 answered")).toBeNull();
  expect(screen.queryByText("answered")).toBeNull();
  expect(screen.queryByText("Secret Person")).toBeNull();
  expect(screen.queryByText("Helwan rooftop")).toBeNull();
  expect(screen.queryByText("Zamalek dock")).toBeNull();
  expect(screen.queryByText("Secret Cafe")).toBeNull();
  expect(screen.queryByText("Someone else's private plan")).toBeNull();
  expect(screen.queryByText("Hidden Host")).toBeNull();
  expect(screen.queryByText("Hidden venue")).toBeNull();
  expect(screen.queryByRole("img")).toBeNull();
  expect(document.querySelector("iframe")).toBeNull();
  expect(document.querySelector("img")).toBeNull();
}

function firstWindow(): HTMLElement {
  const date = screen.getByText("2026-10-02 18:00-23:00");
  const fieldset = date.closest("fieldset");
  if (!fieldset) {
    throw new Error("missing first window fieldset");
  }
  return fieldset;
}

function dinnerStep(): HTMLElement {
  const name = screen.getByText("Dinner");
  const fieldset = name.closest("fieldset");
  if (!fieldset) {
    throw new Error("missing dinner fieldset");
  }
  return fieldset;
}

function coffeeStep(): HTMLElement {
  const name = screen.getByText("Coffee");
  const fieldset = name.closest("fieldset");
  if (!fieldset) {
    throw new Error("missing coffee fieldset");
  }
  return fieldset;
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

describe("ResponseForm chrome", () => {
  it("composes shadcn primitives with DESIGN.md semantic classes and no raw hex", () => {
    const hex = new RegExp("#" + "[0-9a-fA-F]{3,8}\\b");
    const root = process.cwd();
    for (const relative of TICKET_FILES) {
      const source = readFileSync(join(root, relative), "utf8");
      expect(source, relative).not.toMatch(hex);
    }
    const form = readFileSync(join(root, "src/components/response-form.tsx"), "utf8");
    expect(form).toContain('from "@/components/ui/button"');
    expect(form).toContain('from "@/components/ui/input"');
    expect(form).toContain('from "@/components/ui/label"');
    expect(form).toContain('from "@/components/ui/card"');
    expect(form).toContain("bg-primary");
    expect(form).toContain("text-destructive");
    expect(form).not.toContain('className="danger"');
    expect(form).not.toContain("var(--accent)");
    expect(form).not.toContain("var(--danger)");
    expect(form.includes("style=" + "{{")).toBe(false);
    expect(form.toLowerCase()).not.toContain("<img");
    expect(form.toLowerCase()).not.toContain("iframe");
    expect(form).not.toContain("answered_count");
    expect(form).not.toContain("threshold");
    const page = readFileSync(
      join(root, "src/app/plans/[planId]/respond/page.tsx"),
      "utf8",
    );
    expect(page).toContain("ResponseForm");
    expect(page).toContain("planId");
  });
});

describe("ResponseForm", () => {
  beforeEach(() => {
    stubFetch({ get: "collecting" });
  });

  it("shows the plan budget with currency, every day window, every step name, every option label, and an approximate start control", async () => {
    const fetchMock = await renderLoaded();
    expect(screen.getByText(/500\.00/)).toBeTruthy();
    expect(screen.getByText(/EGP/)).toBeTruthy();
    expect(screen.getByText("Africa/Cairo")).toBeTruthy();
    expect(screen.getByText("2026-10-02 18:00-23:00")).toBeTruthy();
    expect(screen.getByText("2026-10-03 17:00-22:00")).toBeTruthy();
    expect(screen.getByText("Dinner")).toBeTruthy();
    expect(screen.getByText("Coffee")).toBeTruthy();
    expect(screen.getByText("Koshary")).toBeTruthy();
    expect(screen.getByText("Grills")).toBeTruthy();
    expect(screen.getByText("Ahwa")).toBeTruthy();
    expect(screen.getByText("Specialty")).toBeTruthy();
    expect(screen.getByLabelText(/approximate/i)).toBeTruthy();
    expect(getCall(fetchMock)?.credentials).toBe("same-origin");
  });

  it("omits answered count, threshold, other participants, other starting points, and any map", async () => {
    await renderLoaded();
    expectForbiddenAbsent();
    expect(screen.queryByText("4")).toBeNull();
    expect(screen.queryByText("6")).toBeNull();
    expect(screen.queryByText(/map/i)).toBeNull();
    const save = screen.getByRole("button", { name: "Save" });
    expect(classTokens(save)).not.toContain("bg-primary");
  });

  it("confirming a search result shows that place's name; incomplete and complete saves keep fields editable", async () => {
    const fetchMock = await renderLoaded({
      search: "ok",
      put: "ok-incomplete",
    });
    fireEvent.change(screen.getByLabelText(/approximate/i), {
      target: { value: "Maadi" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("Maadi, Cairo")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm this place" }));
    expect(screen.getByText("Maadi, Cairo")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();

    fireEvent.click(within(firstWindow()).getByLabelText("Busy"));
    fireEvent.click(within(dinnerStep()).getByLabelText("Koshary"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("This response is not complete yet.")).toBeTruthy();
    expect((screen.getByLabelText(/approximate/i) as HTMLInputElement).disabled).toBe(
      false,
    );
    expect(within(firstWindow()).getByLabelText("Busy")).toBeTruthy();
    expect((within(dinnerStep()).getByLabelText("Koshary") as HTMLInputElement).disabled).toBe(
      false,
    );
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();

    const posted = putCall(fetchMock);
    expect(posted?.credentials).toBe("same-origin");
    expect(posted?.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-HP-Request": "1",
    });
    const incompleteBody = JSON.parse(String(posted?.body)) as {
      start_place_id?: string;
      windows: unknown[];
      picks: unknown[];
    };
    expect(incompleteBody.start_place_id).toBe("ChIJ-maadi");

    cleanup();
    router.push.mockReset();
    const completeMock = stubFetch({ get: "collecting", search: "ok", put: "ok-complete" });
    renderForm();
    await screen.findByLabelText(/approximate/i);
    fireEvent.click(within(firstWindow()).getByLabelText("Free"));
    fireEvent.change(within(firstWindow()).getByLabelText("Earliest"), {
      target: { value: "18:30" },
    });
    fireEvent.change(within(firstWindow()).getByLabelText("Latest"), {
      target: { value: "21:00" },
    });
    const second = screen.getByText("2026-10-03 17:00-22:00").closest("fieldset");
    if (!second) {
      throw new Error("missing second window");
    }
    fireEvent.click(within(second).getByLabelText("Busy"));
    fireEvent.change(screen.getByLabelText(/approximate/i), {
      target: { value: "Maadi" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByText("Maadi, Cairo");
    fireEvent.click(screen.getByRole("button", { name: "Confirm this place" }));
    fireEvent.click(within(dinnerStep()).getByLabelText("Koshary"));
    fireEvent.click(within(coffeeStep()).getByLabelText("Ahwa"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Answers saved.")).toBeTruthy();
    expect((within(firstWindow()).getByLabelText("Earliest") as HTMLInputElement).disabled).toBe(
      false,
    );
    expect((within(dinnerStep()).getByLabelText("Koshary") as HTMLInputElement).disabled).toBe(
      false,
    );
    expect(classTokens(screen.getByRole("button", { name: "Save" }))).not.toContain(
      "bg-primary",
    );
    const completePosted = putCall(completeMock);
    expect(JSON.parse(String(completePosted?.body))).toEqual({
      windows: [
        {
          window_id: windowOne.id,
          kind: "free",
          earliest_local: "18:30",
          latest_local: "21:00",
        },
        { window_id: windowTwo.id, kind: "busy" },
      ],
      picks: [
        { step_id: dinner.id, option_id: dinner.options[0]?.id },
        { step_id: coffee.id, option_id: coffee.options[0]?.id },
      ],
      start_place_id: "ChIJ-maadi",
    });
  });

  it("a save failure keeps the entered values and the previous answered count and uses text-destructive", async () => {
    const fetchMock = await renderLoaded({ put: "fail" });
    fireEvent.click(within(firstWindow()).getByLabelText("Busy"));
    fireEvent.change(screen.getByLabelText(/approximate/i), {
      target: { value: "keep this start" },
    });
    fireEvent.click(within(dinnerStep()).getByLabelText("Grills"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const alert = await screen.findByRole("alert");
    expect(classTokens(alert)).toContain("text-destructive");
    expect(alert.textContent).toBe("A data source is unavailable. Retry.");
    expect((screen.getByLabelText(/approximate/i) as HTMLInputElement).value).toBe(
      "keep this start",
    );
    expect((within(dinnerStep()).getByLabelText("Grills") as HTMLInputElement).checked).toBe(
      true,
    );
    expect((within(firstWindow()).getByLabelText("Busy") as HTMLInputElement).checked).toBe(
      true,
    );
    expect(screen.queryByText("99")).toBeNull();
    expect(screen.queryByText("4 of 6 answered")).toBeNull();
    expect(screen.queryByText("Answers saved.")).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
    expect(putCall(fetchMock)?.credentials).toBe("same-origin");
  });

  it("a save that misses a valid window, a start, or one label on a step stays incomplete and identifies those fields", async () => {
    const fetchMock = await renderLoaded({ put: "ok-incomplete" });
    fireEvent.click(within(firstWindow()).getByLabelText("Free"));
    fireEvent.change(within(firstWindow()).getByLabelText("Earliest"), {
      target: { value: "17:00" },
    });
    fireEvent.change(within(firstWindow()).getByLabelText("Latest"), {
      target: { value: "21:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("This time is outside the window.")).toBeTruthy();
    expect(screen.getAllByText("This is required.").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Choose one option.").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("This response is not complete yet.")).toBeTruthy();
    expect(
      within(firstWindow()).getByLabelText("Earliest").getAttribute("aria-invalid"),
    ).toBe("true");
    expect(screen.getByLabelText(/approximate/i).getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect((within(firstWindow()).getByLabelText("Earliest") as HTMLInputElement).value).toBe(
      "17:00",
    );
    expect(putCall(fetchMock)).toBeUndefined();
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("while proposed this open shows the proposal surface, and while locked it shows the confirmed surface", async () => {
    stubFetch({ get: "proposed" });
    renderForm();
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(`/plans/${PLAN_ID}/proposal`);
    });
    expect(screen.queryByLabelText(/approximate/i)).toBeNull();
    expect(screen.queryByText("Thursday in Maadi")).toBeNull();
    expectForbiddenAbsent();

    cleanup();
    router.replace.mockReset();
    stubFetch({ get: "locked" });
    renderForm();
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(`/plans/${PLAN_ID}/confirmed`);
    });
    expect(screen.queryByLabelText(/approximate/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expectForbiddenAbsent();
  });

  it("switching language keeps unsaved response input", async () => {
    await renderLoaded();
    fireEvent.click(within(firstWindow()).getByLabelText("Free"));
    fireEvent.change(within(firstWindow()).getByLabelText("Earliest"), {
      target: { value: "19:00" },
    });
    fireEvent.change(within(firstWindow()).getByLabelText("Latest"), {
      target: { value: "21:30" },
    });
    fireEvent.change(screen.getByLabelText(/approximate/i), {
      target: { value: "keep this query" },
    });
    fireEvent.click(within(dinnerStep()).getByLabelText("Grills"));

    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), {
      target: { value: "ar" },
    });

    expect(document.cookie).toMatch(/(?:^|; )hp_locale=ar(?:;|$)/);
    expect(document.documentElement.dir).toBe("rtl");
    expect(
      (screen.getByLabelText("نقطة الانطلاق التقريبية") as HTMLInputElement).value,
    ).toBe("keep this query");
    const windowAr = screen.getByText("2026-10-02 18:00-23:00").closest("fieldset");
    if (!windowAr) {
      throw new Error("missing window after locale switch");
    }
    expect((within(windowAr).getByLabelText("أقرب وقت") as HTMLInputElement).value).toBe(
      "19:00",
    );
    expect((within(windowAr).getByLabelText("آخر وقت") as HTMLInputElement).value).toBe(
      "21:30",
    );
    expect((within(dinnerStep()).getByLabelText("Grills") as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it("a failed open uses text-destructive for this plan and omits another plan's title, people, and places", async () => {
    stubFetch({ get: "fail" });
    renderForm();
    const alert = await screen.findByRole("alert");
    expect(classTokens(alert)).toContain("text-destructive");
    expect(alert.textContent).toBe("A data source is unavailable. Retry.");
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(classTokens(retry)).not.toContain("bg-primary");
    expect(screen.queryByText("Thursday in Maadi")).toBeNull();
    expect(screen.queryByText("Someone else's private plan")).toBeNull();
    expect(screen.queryByText("Secret Person")).toBeNull();
    expect(screen.queryByText("Secret Cafe")).toBeNull();
    expect(screen.queryByText("Hidden venue")).toBeNull();
    expect(screen.queryByText("Hidden Host")).toBeNull();
    expect(screen.queryByLabelText(/approximate/i)).toBeNull();
  });

  it("keeps fields editable on a blocked plan and retry reloads this plan after a failed open", async () => {
    stubFetch({ get: "blocked" });
    renderForm();
    await screen.findByLabelText(/approximate/i);
    expect(screen.getByText("2026-10-02 18:00-23:00")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(
      false,
    );

    cleanup();
    let gets = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === RESPONSE_GET && method === "GET") {
        gets += 1;
        if (gets === 1) {
          return jsonResponse(500, leakedFail);
        }
        return jsonResponse(200, collectingBody);
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderForm();
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(classTokens(retry)).not.toContain("bg-primary");
    fireEvent.click(retry);
    expect(await screen.findByLabelText(/approximate/i)).toBeTruthy();
    expect(screen.getByText("Thursday in Maadi")).toBeTruthy();
    expect(screen.queryByText("Someone else's private plan")).toBeNull();
  });
});
