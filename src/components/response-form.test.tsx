import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/en.json";
import { ResponseForm } from "@/components/response-form";
import RespondError from "@/app/plans/[planId]/respond/error";

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

const PLAN_ID = "pln_respondaaaaaaaaaaaaaa";
const RESPONSE_GET = `/api/v1/plans/${PLAN_ID}/response`;
const RESPONSE_PUT = `/api/v1/plans/${PLAN_ID}/response`;
const SEARCH_PREFIX = `/api/v1/plans/${PLAN_ID}/place-searches`;

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

function renderForm(initialResponse: unknown = collectingBody) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ResponseForm planId={PLAN_ID} initialResponse={initialResponse} />
    </NextIntlClientProvider>,
  );
}

async function renderLoaded(config: FetchConfig = {}) {
  const fetchMock = stubFetch({ get: "collecting", ...config });
  renderForm(getBody(config.get ?? "collecting").body);
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
    expect(getCall(fetchMock)).toBeUndefined();
  });

  it("T-001-40/AC-2 shows the initial data's title and saved answers and makes no GET on first render", async () => {
    const fetchMock = stubFetch();
    renderForm(getBody("draft").body);

    expect(screen.getByText("Thursday in Maadi")).toBeTruthy();
    expect(screen.getByText("Maadi, Cairo")).toBeTruthy();
    expect((within(firstWindow()).getByLabelText("Busy") as HTMLInputElement).checked).toBe(
      true,
    );
    expect((within(dinnerStep()).getByLabelText("Koshary") as HTMLInputElement).checked).toBe(
      true,
    );
    await waitFor(() => {
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("T-001-40/AC-2 a complete saved response starts with the saved notice", () => {
    stubFetch();
    renderForm(getBody("complete").body);

    expect(screen.getByText("Answers saved.")).toBeTruthy();
    expect(screen.getByText("Maadi, Cairo")).toBeTruthy();
  });

  it("T-001-40/AC-4 initial data null shows the not-found error state and no plan data", async () => {
    const fetchMock = stubFetch();
    renderForm(null);

    const alert = screen.getByRole("alert");
    expect(classTokens(alert)).toContain("text-destructive");
    expect(alert.textContent).toBe(en.errors.code.not_found);
    expect(screen.queryByText("Thursday in Maadi")).toBeNull();
    expect(screen.queryByLabelText(/approximate/i)).toBeNull();
    expectForbiddenAbsent();
    await waitFor(() => {
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("T-001-40/AC-4 initial data that does not parse shows the upstream error state", () => {
    stubFetch();
    renderForm({ unexpected: true });

    expect(screen.getByRole("alert").textContent).toBe(en.errors.code.upstream);
    expect(screen.queryByLabelText(/approximate/i)).toBeNull();
  });

  it("T-001-40/AC-4 initial data for a proposed or locked plan shows the error state, not the form", () => {
    stubFetch();
    renderForm({ ...collectingBody, plan_state: "proposed" });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByLabelText(/approximate/i)).toBeNull();

    cleanup();
    renderForm({ ...collectingBody, plan_state: "locked" });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
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
    renderForm(collectingBody);
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

  it("a retry that finds the plan proposed shows the proposal surface, and locked shows the confirmed surface", async () => {
    stubFetch({ get: "proposed" });
    renderForm(null);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(`/plans/${PLAN_ID}/proposal`);
    });
    expect(screen.queryByLabelText(/approximate/i)).toBeNull();
    expect(screen.queryByText("Thursday in Maadi")).toBeNull();
    expectForbiddenAbsent();

    cleanup();
    router.replace.mockReset();
    stubFetch({ get: "locked" });
    renderForm(null);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(`/plans/${PLAN_ID}/confirmed`);
    });
    expect(screen.queryByLabelText(/approximate/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expectForbiddenAbsent();
  });

  it.each(["locked", "proposed"] as const)(
    "T-001-79/AC-1 unmounting after Retry and before the reload resolves does not navigate when the plan is %s",
    async (planState) => {
      let release: (response: Response) => void = () => {};
      const requested: string[] = [];
      const fetchMock = vi.fn(
        (input: RequestInfo | URL) =>
          new Promise<Response>((resolve) => {
            requested.push(String(input));
            release = resolve;
          }),
      );
      vi.stubGlobal("fetch", fetchMock);
      const view = renderForm("not a response");
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(requested).toEqual([RESPONSE_GET]);

      view.unmount();
      release(jsonResponse(200, { ...collectingBody, plan_state: planState }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(router.replace).not.toHaveBeenCalled();
    },
  );

  it("a save answered 409 attempt_in_progress reloads while mounted and shows the reloaded form", async () => {
    const fetchMock = await saveWithConflict(
      "attempt_in_progress",
      getBody("draft").body,
    );
    expect(await screen.findByText("Maadi, Cairo")).toBeTruthy();
    expect(requestLines(fetchMock)).toEqual([
      `PUT ${RESPONSE_PUT}`,
      `GET ${RESPONSE_GET}`,
    ]);
    expect(router.replace).not.toHaveBeenCalled();
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

  it("a failed retry uses text-destructive for this plan and omits another plan's title, people, and places", async () => {
    stubFetch({ get: "fail" });
    renderForm(null);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(
        "A data source is unavailable. Retry.",
      );
    });
    const alert = screen.getByRole("alert");
    expect(classTokens(alert)).toContain("text-destructive");
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
    renderForm(blockedBody);
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
    renderForm(null);
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(classTokens(retry)).not.toContain("bg-primary");
    fireEvent.click(retry);
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByLabelText(/approximate/i)).toBeTruthy();
    expect(screen.getByText("Thursday in Maadi")).toBeTruthy();
    expect(screen.queryByText("Someone else's private plan")).toBeNull();
  });

  it("T-001-33/AC-1 load, retry, place search and save request only CONTRACTS paths under /api/v1/", async () => {
    const searched = stubFetch({ get: "collecting", search: "ok", put: "ok-incomplete" });
    let gets = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === `/api/v1/plans/${PLAN_ID}/response` && method === "GET") {
        gets += 1;
        if (gets === 1) {
          return jsonResponse(500, leakedFail);
        }
      }
      if (url.startsWith("/api/v1/")) {
        return searched(input, init);
      }
      return jsonResponse(404, {
        error: { code: "not_found", message: "not found", fields: [] },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderForm(null);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await screen.findByLabelText(/approximate/i);
    fireEvent.change(screen.getByLabelText(/approximate/i), {
      target: { value: "Maadi" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm this place" }));
    fireEvent.click(within(firstWindow()).getByLabelText("Busy"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("This response is not complete yet.")).toBeTruthy();

    const requests = fetchMock.mock.calls.map(
      ([input, init]) => `${(init?.method ?? "GET").toUpperCase()} ${String(input)}`,
    );
    expect(requests).toEqual([
      `GET /api/v1/plans/${PLAN_ID}/response`,
      `GET /api/v1/plans/${PLAN_ID}/response`,
      `GET /api/v1/plans/${PLAN_ID}/place-searches?q=Maadi`,
      `PUT /api/v1/plans/${PLAN_ID}/response`,
    ]);
    expect(requests.some((line) => / \/v1\//.test(line))).toBe(false);
  });

  it("T-001-33/AC-2 a complete answer saves with PUT /api/v1/plans/{planId}/response and shows the saved state on 200", async () => {
    const fetchMock = await renderLoaded({ search: "ok", put: "ok-complete" });
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
    fireEvent.click(await screen.findByRole("button", { name: "Confirm this place" }));
    fireEvent.click(within(dinnerStep()).getByLabelText("Koshary"));
    fireEvent.click(within(coffeeStep()).getByLabelText("Ahwa"));
    expect(screen.queryByText("Answers saved.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Answers saved.")).toBeTruthy();
    const saves = fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT");
    expect(saves).toHaveLength(1);
    expect(String(saves[0]?.[0])).toBe(`/api/v1/plans/${PLAN_ID}/response`);
  });
});

function conflict(reason: string): Response {
  return jsonResponse(409, {
    error: { code: "conflict", reason, message: reason, fields: [] },
  });
}

function stubPutConflict(reason: string, refetched: unknown = collectingBody) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url === RESPONSE_GET && method === "GET") {
      return jsonResponse(200, refetched);
    }
    if (url === RESPONSE_PUT && method === "PUT") {
      return conflict(reason);
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestLines(fetchMock: ReturnType<typeof stubPutConflict>): string[] {
  return fetchMock.mock.calls.map(
    ([input, init]) => `${(init?.method ?? "GET").toUpperCase()} ${String(input)}`,
  );
}

async function saveWithConflict(reason: string, refetched?: unknown) {
  const fetchMock = stubPutConflict(reason, refetched);
  renderForm(collectingBody);
  await screen.findByLabelText(/approximate/i);
  fireEvent.click(within(firstWindow()).getByLabelText("Busy"));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  return fetchMock;
}

describe("ResponseForm attempt_in_progress", () => {
  it("T-001-34/AC-1 409 attempt_in_progress shows no save error, refetches the response and shows it", async () => {
    const refetched = getBody("complete").body;
    const fetchMock = await saveWithConflict("attempt_in_progress", refetched);

    expect(await screen.findByText("Answers saved.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Answers could not be saved.")).toBeNull();
    expect(screen.queryByText("A proposal attempt is already running.")).toBeNull();
    expect((screen.getByLabelText(/approximate/i) as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByText("Maadi, Cairo")).toBeTruthy();
    expect(requestLines(fetchMock)).toEqual([
      `PUT ${RESPONSE_PUT}`,
      `GET ${RESPONSE_GET}`,
    ]);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("T-001-34/AC-3 plan_locked still redirects to the confirmed surface", async () => {
    const fetchMock = await saveWithConflict("plan_locked");
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(`/plans/${PLAN_ID}/confirmed`);
    });
    expect(requestLines(fetchMock)).toEqual([`PUT ${RESPONSE_PUT}`]);
  });

  it("T-001-34/AC-3 responses_closed still redirects to the proposal surface", async () => {
    const fetchMock = await saveWithConflict("responses_closed");
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(`/plans/${PLAN_ID}/proposal`);
    });
    expect(requestLines(fetchMock)).toEqual([`PUT ${RESPONSE_PUT}`]);
  });

  it("T-001-34/AC-3 only attempt_in_progress refetches: another reason keeps its save error, then attempt_in_progress clears it", async () => {
    const reasons = ["not_proposed", "attempt_in_progress"];
    let gets = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === RESPONSE_GET && method === "GET") {
        gets += 1;
        return jsonResponse(200, collectingBody);
      }
      if (url === RESPONSE_PUT && method === "PUT") {
        return conflict(reasons.shift() ?? "attempt_in_progress");
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderForm(collectingBody);
    await screen.findByLabelText(/approximate/i);
    fireEvent.click(within(firstWindow()).getByLabelText("Busy"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(gets).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(gets).toBe(1);
    });
    await screen.findByLabelText(/approximate/i);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("T-001-34/AC-3 any other 409 reason still shows the save error without refetching", async () => {
    const fetchMock = await saveWithConflict("not_proposed");
    const alert = await screen.findByRole("alert");
    expect(classTokens(alert)).toContain("text-destructive");
    expect(router.replace).not.toHaveBeenCalled();
    expect(requestLines(fetchMock)).toEqual([`PUT ${RESPONSE_PUT}`]);
  });
});

// T-001-95 AC-2: one test per shipped T-001-21 AC, each asserting every clause of that AC.
describe("T-001-95 response form coverage", () => {
  const nileHit = { google_place_id: "ChIJ-nile", name: "Nile Corniche" };
  const otherHit = { google_place_id: "ChIJ-helio", name: "Heliopolis Square" };

  function stubFlow(planState: "collecting" | "blocked", puts: unknown[]) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.startsWith(SEARCH_PREFIX) && method === "GET") {
        return jsonResponse(200, { results: [nileHit, otherHit] });
      }
      if (url === RESPONSE_PUT && method === "PUT") {
        const next = puts.shift();
        if (next instanceof Response) {
          return next;
        }
        return jsonResponse(
          200,
          next ?? { complete: false, first_completion: false, plan_state: planState },
        );
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function putBodies(fetchMock: ReturnType<typeof stubFlow>): Record<string, unknown>[] {
    return fetchMock.mock.calls
      .filter(([, init]) => (init?.method ?? "GET").toUpperCase() === "PUT")
      .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
  }

  function secondWindow(): HTMLElement {
    const fieldset = screen.getByText("2026-10-03 17:00-22:00").closest("fieldset");
    if (!fieldset) {
      throw new Error("missing second window fieldset");
    }
    return fieldset;
  }

  async function confirmNile(): Promise<void> {
    fireEvent.change(screen.getByLabelText(/approximate/i), { target: { value: "Nile" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const hit = await screen.findByText("Nile Corniche");
    const item = hit.closest("li");
    if (!item) {
      throw new Error("missing search result item");
    }
    fireEvent.click(within(item).getByRole("button", { name: "Confirm this place" }));
  }

  function fillValidWindows(): void {
    fireEvent.click(within(firstWindow()).getByLabelText("Free"));
    fireEvent.change(within(firstWindow()).getByLabelText("Earliest"), {
      target: { value: "19:00" },
    });
    fireEvent.change(within(firstWindow()).getByLabelText("Latest"), {
      target: { value: "21:30" },
    });
    fireEvent.click(within(secondWindow()).getByLabelText("Busy"));
  }

  function expectEveryFieldEditable(): void {
    const inputs = Array.from(document.querySelectorAll("form input")) as HTMLInputElement[];
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) {
      expect(input.disabled, input.name || input.id).toBe(false);
    }
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect((screen.getByRole("button", { name: "Search" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  }

  it("T-001-95/AC-2 T-001-21/AC-2 answered count, threshold, other participants and other starting points are absent, and no map is shown", () => {
    stubFetch();
    const view = renderForm({
      ...collectingBody,
      answered_count: 47,
      threshold: 63,
      participants: [
        { display_name: "Secret Person", start: { name: "Helwan rooftop" } },
        { display_name: "Hidden Guest", start: { name: "Giza ferry" } },
      ],
      other_starting_points: [{ name: "Zamalek dock" }],
      map: { url: "https://maps.example/secret", image: "map.png" },
      map_url: "https://maps.example/secret",
    });
    // The surface itself renders.
    expect(screen.getByText("Thursday in Maadi")).toBeTruthy();
    expect(screen.getByLabelText(/approximate/i)).toBeTruthy();

    const text = view.container.textContent ?? "";
    // Answered count and threshold.
    expect(text).not.toContain("47");
    expect(text).not.toContain("63");
    expect(text).not.toMatch(/answered/i);
    expect(text).not.toMatch(/threshold/i);
    // Other participants.
    expect(text).not.toContain("Secret Person");
    expect(text).not.toContain("Hidden Guest");
    // Other starting points.
    expect(text).not.toContain("Helwan rooftop");
    expect(text).not.toContain("Giza ferry");
    expect(text).not.toContain("Zamalek dock");
    // No map.
    expect(text).not.toMatch(/map/i);
    expect(view.container.querySelector("img, iframe, canvas, object, embed")).toBeNull();
    expect(
      view.container.querySelector("[href*='maps'], [src*='maps'], [aria-label*='map' i]"),
    ).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("T-001-95/AC-2 T-001-21/AC-3 confirming a search result shows that place's name; an incomplete save and a complete save both keep the fields editable while collecting and while blocked", async () => {
    for (const state of ["collecting", "blocked"] as const) {
      const fetchMock = stubFlow(state, [
        { complete: false, first_completion: false, plan_state: state },
        { complete: true, first_completion: true, plan_state: state },
      ]);
      renderForm({ ...collectingBody, plan_state: state });

      // Confirming a result shows that place's name, not the other result's.
      await confirmNile();
      expect(screen.getByText("Nile Corniche")).toBeTruthy();
      expect(screen.queryByText("Heliopolis Square")).toBeNull();
      expect(screen.queryByRole("button", { name: "Confirm this place" })).toBeNull();

      // Incomplete save: the second window and the coffee step are unanswered.
      fireEvent.click(within(firstWindow()).getByLabelText("Busy"));
      fireEvent.click(within(dinnerStep()).getByLabelText("Koshary"));
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(await screen.findByText("This response is not complete yet.")).toBeTruthy();
      expectEveryFieldEditable();
      expect(screen.getByText("Nile Corniche")).toBeTruthy();

      // Complete save.
      fillValidWindows();
      fireEvent.click(within(coffeeStep()).getByLabelText("Ahwa"));
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(await screen.findByText("Answers saved.")).toBeTruthy();
      expectEveryFieldEditable();
      expect(screen.getByText("Nile Corniche")).toBeTruthy();

      const bodies = putBodies(fetchMock);
      expect(bodies).toHaveLength(2);
      expect(bodies[0]?.start_place_id, state).toBe("ChIJ-nile");
      expect(bodies[1], state).toEqual({
        windows: [
          {
            window_id: windowOne.id,
            kind: "free",
            earliest_local: "19:00",
            latest_local: "21:30",
          },
          { window_id: windowTwo.id, kind: "busy" },
        ],
        picks: [
          { step_id: dinner.id, option_id: dinner.options[0]?.id },
          { step_id: coffee.id, option_id: coffee.options[0]?.id },
        ],
        start_place_id: "ChIJ-nile",
      });
      expect(router.replace).not.toHaveBeenCalled();
      cleanup();
      vi.unstubAllGlobals();
    }
  });

  it("T-001-95/AC-2 T-001-21/AC-4 a save failure keeps the entered values and the previous answered count and uses text-destructive; a save missing a valid window, a start, or one step's label stays incomplete and identifies that field", async () => {
    // Save failure.
    const failMock = stubFlow("collecting", [
      jsonResponse(500, {
        error: { code: "upstream", message: "save failed", fields: [] },
        answered_count: 99,
      }),
    ]);
    const failed = renderForm(collectingBody);
    expect(failed.container.textContent ?? "").not.toMatch(/answered/i);
    fillValidWindows();
    await confirmNile();
    fireEvent.change(screen.getByLabelText(/approximate/i), {
      target: { value: "unsent query" },
    });
    fireEvent.click(within(dinnerStep()).getByLabelText("Grills"));
    fireEvent.click(within(coffeeStep()).getByLabelText("Specialty"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(en.errors.code.upstream);
    expect(classTokens(alert)).toContain("text-destructive");
    expect(putBodies(failMock)).toHaveLength(1);
    expect((within(firstWindow()).getByLabelText("Free") as HTMLInputElement).checked).toBe(true);
    expect((within(firstWindow()).getByLabelText("Earliest") as HTMLInputElement).value).toBe(
      "19:00",
    );
    expect((within(firstWindow()).getByLabelText("Latest") as HTMLInputElement).value).toBe(
      "21:30",
    );
    expect((within(secondWindow()).getByLabelText("Busy") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/approximate/i) as HTMLInputElement).value).toBe(
      "unsent query",
    );
    expect(screen.getByText("Nile Corniche")).toBeTruthy();
    expect((within(dinnerStep()).getByLabelText("Grills") as HTMLInputElement).checked).toBe(true);
    expect((within(coffeeStep()).getByLabelText("Specialty") as HTMLInputElement).checked).toBe(
      true,
    );
    // The previous answered count stands: the failure's count is not shown and no count appears.
    const textAfter = failed.container.textContent ?? "";
    expect(textAfter).not.toContain("99");
    expect(textAfter).not.toMatch(/answered/i);
    expect(screen.queryByText("Answers saved.")).toBeNull();
    cleanup();
    vi.unstubAllGlobals();

    // Missing a valid window: stays incomplete and marks that window's time.
    const windowMock = stubFlow("collecting", []);
    renderForm(collectingBody);
    fireEvent.click(within(firstWindow()).getByLabelText("Free"));
    fireEvent.change(within(firstWindow()).getByLabelText("Earliest"), {
      target: { value: "17:00" },
    });
    fireEvent.change(within(firstWindow()).getByLabelText("Latest"), {
      target: { value: "21:00" },
    });
    fireEvent.click(within(secondWindow()).getByLabelText("Busy"));
    await confirmNile();
    fireEvent.click(within(dinnerStep()).getByLabelText("Koshary"));
    fireEvent.click(within(coffeeStep()).getByLabelText("Ahwa"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("This response is not complete yet.")).toBeTruthy();
    expect(screen.queryByText("Answers saved.")).toBeNull();
    expect(within(firstWindow()).getByText("This time is outside the window.")).toBeTruthy();
    expect(within(firstWindow()).getByLabelText("Earliest").getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(screen.getByLabelText(/approximate/i).getAttribute("aria-invalid")).toBeNull();
    expect(screen.queryByText("Choose one option.")).toBeNull();
    expect(putBodies(windowMock)).toHaveLength(0);
    cleanup();
    vi.unstubAllGlobals();

    // Missing a start: stays incomplete and marks the start control.
    const startMock = stubFlow("collecting", [
      { complete: false, first_completion: false, plan_state: "collecting" },
    ]);
    renderForm(collectingBody);
    fillValidWindows();
    fireEvent.click(within(dinnerStep()).getByLabelText("Koshary"));
    fireEvent.click(within(coffeeStep()).getByLabelText("Ahwa"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("This response is not complete yet.")).toBeTruthy();
    expect(screen.queryByText("Answers saved.")).toBeNull();
    expect(screen.getByLabelText(/approximate/i).getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById("hp-start-search-error")?.textContent).toBe(
      en.errors.fields.required,
    );
    expect(within(firstWindow()).getByLabelText("Earliest").getAttribute("aria-invalid")).toBeNull();
    expect(screen.queryByText("Choose one option.")).toBeNull();
    expect(putBodies(startMock)[0]).not.toHaveProperty("start_place_id");
    cleanup();
    vi.unstubAllGlobals();

    // Missing one step's label: stays incomplete and marks that step only.
    const pickMock = stubFlow("collecting", [
      { complete: false, first_completion: false, plan_state: "collecting" },
    ]);
    renderForm(collectingBody);
    fillValidWindows();
    await confirmNile();
    fireEvent.click(within(dinnerStep()).getByLabelText("Koshary"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("This response is not complete yet.")).toBeTruthy();
    expect(screen.queryByText("Answers saved.")).toBeNull();
    expect(within(coffeeStep()).getByText("Choose one option.")).toBeTruthy();
    expect(within(dinnerStep()).queryByText("Choose one option.")).toBeNull();
    expect(screen.getByLabelText(/approximate/i).getAttribute("aria-invalid")).toBeNull();
    expect(putBodies(pickMock)[0]?.picks).toEqual([
      { step_id: dinner.id, option_id: dinner.options[0]?.id },
    ]);
  });

  it("T-001-95/AC-2 T-001-21/AC-5 an open that finds the plan proposed shows the proposal surface, and locked shows the confirmed surface", async () => {
    // The server open redirects in page.tsx (see page.test.tsx); this is the client open after
    // Retry, both for the 409 reasons and for a 200 document whose plan_state has moved on.
    const cases = [
      { response: getBody("proposed"), href: `/plans/${PLAN_ID}/proposal` },
      { response: getBody("locked"), href: `/plans/${PLAN_ID}/confirmed` },
      {
        response: { status: 200, body: { ...collectingBody, plan_state: "proposed" } },
        href: `/plans/${PLAN_ID}/proposal`,
      },
      {
        response: { status: 200, body: { ...collectingBody, plan_state: "locked" } },
        href: `/plans/${PLAN_ID}/confirmed`,
      },
    ];
    for (const { response, href } of cases) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => jsonResponse(response.status, response.body)),
      );
      renderForm(null);
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await waitFor(() => {
        expect(router.replace).toHaveBeenCalledWith(href);
      });
      expect(router.replace).toHaveBeenCalledTimes(1);
      expect(screen.queryByLabelText(/approximate/i)).toBeNull();
      expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
      cleanup();
      vi.unstubAllGlobals();
      router.replace.mockReset();
    }
  });

  it("T-001-95/AC-2 T-001-21/AC-6 switching language keeps every unsaved response input", async () => {
    stubFlow("collecting", []);
    renderForm(collectingBody);
    fillValidWindows();
    await confirmNile();
    fireEvent.change(screen.getByLabelText(/approximate/i), {
      target: { value: "still typing" },
    });
    fireEvent.click(within(dinnerStep()).getByLabelText("Grills"));
    fireEvent.click(within(coffeeStep()).getByLabelText("Specialty"));

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "ar" } });
    expect(document.cookie).toMatch(/(?:^|; )hp_locale=ar(?:;|$)/);
    expect(document.documentElement.dir).toBe("rtl");
    expect(screen.getByRole("button", { name: "حفظ" })).toBeTruthy();
    expect((within(firstWindow()).getByLabelText("متاح") as HTMLInputElement).checked).toBe(true);
    expect((within(firstWindow()).getByLabelText("أقرب وقت") as HTMLInputElement).value).toBe(
      "19:00",
    );
    expect((within(firstWindow()).getByLabelText("آخر وقت") as HTMLInputElement).value).toBe(
      "21:30",
    );
    expect((within(secondWindow()).getByLabelText("مشغول") as HTMLInputElement).checked).toBe(
      true,
    );
    expect(
      (screen.getByLabelText("نقطة الانطلاق التقريبية") as HTMLInputElement).value,
    ).toBe("still typing");
    expect(screen.getByText("Nile Corniche")).toBeTruthy();
    expect((within(dinnerStep()).getByLabelText("Grills") as HTMLInputElement).checked).toBe(true);
    expect((within(coffeeStep()).getByLabelText("Specialty") as HTMLInputElement).checked).toBe(
      true,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "en" } });
    expect(document.documentElement.dir).toBe("ltr");
    expect((within(firstWindow()).getByLabelText("Earliest") as HTMLInputElement).value).toBe(
      "19:00",
    );
    expect((screen.getByLabelText(/approximate/i) as HTMLInputElement).value).toBe(
      "still typing",
    );
    expect(screen.getByText("Nile Corniche")).toBeTruthy();
    expect((within(coffeeStep()).getByLabelText("Specialty") as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it("T-001-95/AC-2 T-001-21/AC-7 a failed open uses text-destructive for this plan and omits another plan's title, people, and places", async () => {
    const otherSteps = [
      {
        id: "stp_zzzzzzzzzzzzzzzzzzzzzz",
        name: "Sunset Walk",
        options: [{ id: "opt_zzzzzzzzzzzzzzzzzzzzzz", label: "Corniche Kiosk" }],
      },
    ];
    const otherPlan = {
      ...collectingBody,
      title: "Plan B rooftop",
      steps: otherSteps,
      response: { complete: false, windows: [], start: { name: "Zamalek Marina" }, picks: [] },
    };
    const otherPlanStrings = [
      "Plan B rooftop",
      "Sunset Walk",
      "Corniche Kiosk",
      "Zamalek Marina",
      "Hidden Host",
      "Secret Person",
      "Secret Cafe",
    ];
    const expectNoOtherPlan = (text: string) => {
      for (const leak of otherPlanStrings) {
        expect(text).not.toContain(leak);
      }
    };

    // Plan B opens first in this browser.
    stubFetch();
    const first = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ResponseForm planId="pln_otherplanbbbbbbbbbbb" initialResponse={otherPlan} />
      </NextIntlClientProvider>,
    );
    expect(first.container.textContent).toContain("Plan B rooftop");
    cleanup();

    // Plan A's open finds nothing.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(500, {
          ...leakedFail,
          title: "Plan B rooftop",
          steps: otherSteps,
          start: { name: "Zamalek Marina" },
        }),
      ),
    );
    const failed = renderForm(null);
    let alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(en.errors.code.not_found);
    expect(classTokens(alert)).toContain("text-destructive");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(en.respond.title);
    expectNoOtherPlan(failed.container.textContent ?? "");
    expect(screen.queryByLabelText(/approximate/i)).toBeNull();

    // Plan A's reload fails with a body carrying another plan's data.
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(en.errors.code.upstream);
    });
    alert = screen.getByRole("alert");
    expect(classTokens(alert)).toContain("text-destructive");
    expectNoOtherPlan(failed.container.textContent ?? "");
    expect(screen.queryByLabelText(/approximate/i)).toBeNull();
    cleanup();

    // Plan A's server load throws: the route boundary is used.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const boundary = render(
        <NextIntlClientProvider locale="en" messages={en}>
          <RespondError error={new Error("load failed for Plan B rooftop")} retry={vi.fn()} />
        </NextIntlClientProvider>,
      );
      const boundaryAlert = screen.getByRole("alert");
      expect(boundaryAlert.textContent).toBe(en.errors.code.upstream);
      expect(classTokens(boundaryAlert)).toContain("text-destructive");
      expectNoOtherPlan(boundary.container.textContent ?? "");
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("ResponseForm error bodies", () => {
  type Shown = { alerts: string[]; fields: string[]; markup: string };

  async function saveAnswering(response: () => Response): Promise<Shown> {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (url === RESPONSE_PUT && method === "PUT") {
          return response();
        }
        throw new Error(`unexpected fetch ${method} ${url}`);
      }),
    );
    const { container } = renderForm(collectingBody);
    await screen.findByLabelText(/approximate/i);
    fireEvent.click(within(firstWindow()).getByLabelText("Busy"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("alert");
    await waitFor(() => {
      expect(
        (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled,
      ).toBe(false);
    });
    const shown: Shown = {
      alerts: screen.getAllByRole("alert").map((el) => el.textContent ?? ""),
      fields: Array.from(container.querySelectorAll('p[id$="-error"]')).map(
        (el) => `${el.id}:${el.textContent}`,
      ),
      markup: container.innerHTML.replace(/_r_[0-9a-z]+_/g, "_r_"),
    };
    cleanup();
    return shown;
  }

  it("T-001-99/AC-1 a 400 whose body is not JSON shows the same alert and field errors as a 400 with {}", async () => {
    const notJson = await saveAnswering(
      () => new Response("<html>bad gateway</html>", { status: 400 }),
    );
    const empty = await saveAnswering(() => jsonResponse(400, {}));
    expect(empty.alerts).toEqual([en.respond.saveError]);
    expect(empty.fields.length).toBeGreaterThan(0);
    expect(notJson.alerts).toEqual(empty.alerts);
    expect(notJson.fields).toEqual(empty.fields);
    expect(notJson.markup).toBe(empty.markup);
  });
});
