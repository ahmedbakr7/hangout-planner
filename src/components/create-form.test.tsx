import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/en.json";
import { CreateForm, decimalToAmountMinor } from "@/components/create-form";

const { router } = vi.hoisted(() => ({
  router: {
    push: vi.fn(),
    refresh: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

const missingSession = {
  error: {
    code: "unauthenticated",
    reason: "missing_session",
    message: "missing session",
    fields: [],
  },
};

const nourAccount = {
  account: {
    id: "acc_aaaaaaaaaaaaaaaaaaaaaa",
    email: "nour@example.com",
    display_name: "Nour",
  },
};

const currenciesBody = {
  currencies: [
    { code: "EGP", exponent: 2 },
    { code: "USD", exponent: 2 },
    { code: "SAR", exponent: 2 },
    { code: "AED", exponent: 2 },
  ],
};

const createdPlan = {
  id: "pln_newplaniddddddddddd",
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
      options: [{ id: "opt_aaaaaaaaaaaaaaaaaaaaaa", label: "Koshary" }],
    },
  ],
  threshold: 3,
  answered_count: 0,
  in_progress_count: 0,
  participants: [],
  join_path: "/join/jt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type FetchConfig = {
  me?: "in" | "out";
  sessions?: "ok" | "fail";
  plansPost?: "ok" | "fail" | "invalid";
};

function stubFetch(config: FetchConfig = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url === "/api/v1/me" && method === "GET") {
      if (config.me === "out") {
        return jsonResponse(401, missingSession);
      }
      return jsonResponse(200, nourAccount);
    }
    if (url === "/api/v1/currencies" && method === "GET") {
      return jsonResponse(200, currenciesBody);
    }
    if (url === "/api/v1/sessions" && method === "POST") {
      if (config.sessions === "fail") {
        return jsonResponse(401, {
          error: {
            code: "unauthenticated",
            reason: "bad_credentials",
            message: "no",
            fields: [],
          },
        });
      }
      return jsonResponse(200, nourAccount);
    }
    if (url === "/api/v1/plans" && method === "POST") {
      if (config.plansPost === "fail") {
        return jsonResponse(500, {
          error: { code: "upstream", message: "save failed", fields: [] },
        });
      }
      if (config.plansPost === "invalid") {
        return jsonResponse(400, {
          error: {
            code: "validation_failed",
            message: "invalid fields",
            fields: [
              { path: "title", code: "required" },
              { path: "windows", code: "required" },
            ],
          },
        });
      }
      return jsonResponse(201, createdPlan);
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderCreate(initialCurrencies: unknown = currenciesBody) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <CreateForm initialCurrencies={initialCurrencies} />
    </NextIntlClientProvider>,
  );
}

function getRequests(fetchMock: ReturnType<typeof stubFetch>): string[] {
  return fetchMock.mock.calls
    .filter(([, init]) => (init?.method ?? "GET").toUpperCase() === "GET")
    .map(([url]) => String(url));
}

async function renderSignedInForm(config: FetchConfig = {}) {
  const fetchMock = stubFetch({ me: "in", ...config });
  renderCreate();
  await screen.findByLabelText("Plan title");
  return fetchMock;
}

function postCall(
  fetchMock: ReturnType<typeof stubFetch>,
  path: string,
): RequestInit | undefined {
  const match = fetchMock.mock.calls.find(
    (call) => String(call[0]) === path && (call[1]?.method ?? "GET") === "POST",
  );
  return match?.[1];
}

function classTokens(el: Element): string[] {
  return el.className.split(/\s+/);
}

function fillValidForm(): void {
  fireEvent.change(screen.getByLabelText("Plan title"), {
    target: { value: "Thursday in Maadi" },
  });
  fireEvent.change(screen.getByLabelText("Timezone"), {
    target: { value: "Africa/Cairo" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add a day window" }));
  fireEvent.change(screen.getByLabelText("Date"), {
    target: { value: "2026-10-02" },
  });
  fireEvent.change(screen.getByLabelText("Start"), {
    target: { value: "18:00" },
  });
  fireEvent.change(screen.getByLabelText("End"), {
    target: { value: "23:00" },
  });
  fireEvent.change(screen.getByLabelText("Per-person amount"), {
    target: { value: "500.00" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add a step" }));
  fireEvent.change(screen.getByLabelText("Step name"), {
    target: { value: "Dinner" },
  });
  const options = screen.getAllByLabelText("Option label");
  fireEvent.change(options[0] as HTMLElement, { target: { value: "Koshary" } });
  fireEvent.change(options[1] as HTMLElement, { target: { value: "Grills" } });
  fireEvent.change(screen.getByLabelText("Answered threshold"), {
    target: { value: "3" },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  router.push.mockReset();
  router.refresh.mockReset();
  document.cookie = "hp_locale=;path=/;max-age=0";
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
});

describe("decimalToAmountMinor", () => {
  it("converts a decimal string with integer arithmetic from the exponent", () => {
    expect(decimalToAmountMinor("500.00", 2)).toBe(50000);
    expect(decimalToAmountMinor("500", 2)).toBe(50000);
    expect(decimalToAmountMinor("5.5", 2)).toBe(550);
    expect(decimalToAmountMinor("0.01", 2)).toBe(1);
    expect(decimalToAmountMinor("0", 2)).toBeNull();
    expect(decimalToAmountMinor("", 2)).toBeNull();
  });
});

describe("CreateForm", () => {
  beforeEach(() => {
    stubFetch({ me: "in" });
  });

  it("is one form in the order title, when, budget, steps, threshold, with EGP and environment timezone", async () => {
    await renderSignedInForm();

    const headings = screen.getAllByRole("heading").map((node) => node.textContent);
    expect(headings).toEqual([
      "Create a plan",
      "Title",
      "When",
      "Budget",
      "Steps",
      "Threshold",
    ]);

    const currency = screen.getByLabelText("Currency") as HTMLSelectElement;
    expect(currency.value).toBe("EGP");
    expect(Array.from(currency.options).map((option) => option.value)).toEqual([
      "EGP",
      "USD",
      "SAR",
      "AED",
    ]);

    const timezone = screen.getByLabelText("Timezone") as HTMLInputElement;
    expect(timezone.value).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    fireEvent.change(timezone, { target: { value: "America/New_York" } });
    expect(timezone.value).toBe("America/New_York");

    expect(classTokens(screen.getByRole("button", { name: "Create" }))).toContain(
      "bg-primary",
    );
    expect(
      classTokens(screen.getByRole("button", { name: "Add a day window" })),
    ).not.toContain("bg-primary");
    expect(
      classTokens(screen.getByRole("button", { name: "Add a step" })),
    ).not.toContain("bg-primary");

    expect(screen.queryByRole("button", { name: /search/i })).toBeNull();
    expect(screen.queryByText(/venue/i)).toBeNull();
    expect(screen.queryByText(/map/i)).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.queryByLabelText("Approximate starting place")).toBeNull();
  });

  it("T-001-93/AC-1 T-001-11/AC-4 create is one form in the order title, when, budget, steps, threshold; currency defaults to EGP; the timezone starts from the environment and stays editable; there is no venue search and no map", async () => {
    const realOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
    const zoneSpy = vi
      .spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
      .mockImplementation(function (this: Intl.DateTimeFormat) {
        return { ...realOptions.call(this), timeZone: "Asia/Riyadh" };
      });
    try {
      const fetchMock = await renderSignedInForm();
      fireEvent.click(screen.getByRole("button", { name: "Add a day window" }));
      fireEvent.click(screen.getByRole("button", { name: "Add a step" }));

      // one form
      const forms = document.querySelectorAll("form");
      expect(forms).toHaveLength(1);
      const form = forms[0] as HTMLFormElement;

      // sections in the order title, when, budget, steps, threshold, each holding its fields
      const sections = Array.from(form.querySelectorAll("section"));
      expect(sections.map((section) => section.querySelector("h2")?.textContent)).toEqual([
        "Title",
        "When",
        "Budget",
        "Steps",
        "Threshold",
      ]);
      const sectionOf = (label: string): number =>
        sections.indexOf(screen.getByLabelText(label).closest("section") as HTMLElement);
      expect(sectionOf("Plan title")).toBe(0);
      expect(sectionOf("Timezone")).toBe(1);
      expect(sectionOf("Date")).toBe(1);
      expect(sectionOf("Start")).toBe(1);
      expect(sectionOf("End")).toBe(1);
      expect(sectionOf("Per-person amount")).toBe(2);
      expect(sectionOf("Currency")).toBe(2);
      expect(sectionOf("Step name")).toBe(3);
      expect(sectionOf("Answered threshold")).toBe(4);
      for (const input of Array.from(document.querySelectorAll("input"))) {
        expect(input.closest("form"), input.id).toBe(form);
      }
      expect(screen.getByLabelText("Currency").closest("form")).toBe(form);

      // currency defaults to EGP
      expect((screen.getByLabelText("Currency") as HTMLSelectElement).value).toBe("EGP");

      // the timezone starts from the environment and stays editable
      const timezone = screen.getByLabelText("Timezone") as HTMLInputElement;
      expect(timezone.value).toBe("Asia/Riyadh");
      expect(timezone.disabled).toBe(false);
      expect(timezone.readOnly).toBe(false);
      fireEvent.change(timezone, { target: { value: "Africa/Cairo" } });
      expect(timezone.value).toBe("Africa/Cairo");

      // no venue search and no map
      expect(screen.queryByRole("searchbox")).toBeNull();
      expect(document.querySelector("input[type=search]")).toBeNull();
      expect(screen.queryByRole("button", { name: /search/i })).toBeNull();
      expect(screen.queryByText(/venue/i)).toBeNull();
      expect(screen.queryByLabelText(/venue|place/i)).toBeNull();
      expect(screen.queryByText(/map/i)).toBeNull();
      expect(screen.queryByRole("img")).toBeNull();
      expect(document.querySelector("iframe, canvas, svg[role=img]")).toBeNull();
      expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual(["/api/v1/me"]);
    } finally {
      zoneSpy.mockRestore();
    }
  });

  it("T-001-93/AC-1 T-001-11/AC-5 an invalid submit creates no plan, identifies each invalid field, and keeps the entered values; a save failure keeps the entered values, uses text-destructive, and does not navigate", async () => {
    const fetchMock = await renderSignedInForm({ plansPost: "fail" });

    function errorText(input: HTMLElement): string | null {
      const id = input.getAttribute("aria-describedby");
      return id ? (document.getElementById(id)?.textContent ?? null) : null;
    }
    function value(label: string, index = 0): string {
      return (screen.getAllByLabelText(label)[index] as HTMLInputElement).value;
    }

    // Invalid: blank title, blank timezone, end before start, zero amount,
    // a step with one option, threshold 0.
    fireEvent.change(screen.getByLabelText("Plan title"), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText("Timezone"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Add a day window" }));
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-02" } });
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "18:00" } });
    fireEvent.change(screen.getByLabelText("End"), { target: { value: "17:00" } });
    fireEvent.change(screen.getByLabelText("Per-person amount"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Currency"), { target: { value: "USD" } });
    fireEvent.click(screen.getByRole("button", { name: "Add a step" }));
    fireEvent.change(screen.getByLabelText("Step name"), { target: { value: "Dinner" } });
    fireEvent.change(screen.getAllByLabelText("Option label")[0] as HTMLElement, {
      target: { value: "Koshary" },
    });
    fireEvent.change(screen.getByLabelText("Answered threshold"), { target: { value: "0" } });

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    // creates no plan
    expect(postCall(fetchMock, "/api/v1/plans")).toBeUndefined();
    expect(router.push).not.toHaveBeenCalled();

    // identifies each invalid field, and only those
    const invalid: Array<[HTMLElement, string]> = [
      [screen.getByLabelText("Plan title"), en.errors.fields.required],
      [screen.getByLabelText("Timezone"), en.errors.fields.required],
      [screen.getByLabelText("End"), en.errors.fields.end_before_start],
      [screen.getByLabelText("Per-person amount"), en.errors.fields.not_positive],
      [screen.getAllByLabelText("Option label")[1] as HTMLElement, en.errors.fields.required],
      [screen.getByLabelText("Answered threshold"), en.errors.fields.below_min],
    ];
    for (const [input, message] of invalid) {
      expect(input.getAttribute("aria-invalid"), input.id).toBe("true");
      expect(errorText(input), input.id).toBe(message);
    }
    for (const label of ["Date", "Start", "Step name", "Currency"]) {
      expect(screen.getByLabelText(label).getAttribute("aria-invalid"), label).toBeNull();
    }

    // keeps the entered values
    expect(value("Plan title")).toBe("   ");
    expect(value("Timezone")).toBe("");
    expect(value("Date")).toBe("2026-10-02");
    expect(value("Start")).toBe("18:00");
    expect(value("End")).toBe("17:00");
    expect(value("Per-person amount")).toBe("0");
    expect((screen.getByLabelText("Currency") as HTMLSelectElement).value).toBe("USD");
    expect(value("Step name")).toBe("Dinner");
    expect(value("Option label", 0)).toBe("Koshary");
    expect(value("Option label", 1)).toBe("");
    expect(value("Answered threshold")).toBe("0");

    // Fix every field; the save then fails on the server.
    fireEvent.change(screen.getByLabelText("Plan title"), { target: { value: "Thursday in Maadi" } });
    fireEvent.change(screen.getByLabelText("Timezone"), { target: { value: "Africa/Cairo" } });
    fireEvent.change(screen.getByLabelText("End"), { target: { value: "23:00" } });
    fireEvent.change(screen.getByLabelText("Per-person amount"), { target: { value: "500.00" } });
    fireEvent.change(screen.getAllByLabelText("Option label")[1] as HTMLElement, {
      target: { value: "Grills" },
    });
    fireEvent.change(screen.getByLabelText("Answered threshold"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    const alert = await screen.findByText(en.errors.code.upstream);
    expect(postCall(fetchMock, "/api/v1/plans")).toBeDefined();
    // uses text-destructive
    expect(alert.getAttribute("role")).toBe("alert");
    expect(classTokens(alert)).toContain("text-destructive");
    // keeps the entered values
    expect(value("Plan title")).toBe("Thursday in Maadi");
    expect(value("Timezone")).toBe("Africa/Cairo");
    expect(value("Date")).toBe("2026-10-02");
    expect(value("Start")).toBe("18:00");
    expect(value("End")).toBe("23:00");
    expect(value("Per-person amount")).toBe("500.00");
    expect((screen.getByLabelText("Currency") as HTMLSelectElement).value).toBe("USD");
    expect(value("Step name")).toBe("Dinner");
    expect(value("Option label", 0)).toBe("Koshary");
    expect(value("Option label", 1)).toBe("Grills");
    expect(value("Answered threshold")).toBe("3");
    // does not navigate
    expect(router.push).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("an invalid submit creates no plan, identifies each invalid field, and keeps the entered values", async () => {
    const fetchMock = await renderSignedInForm();

    fireEvent.change(screen.getByLabelText("Timezone"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add a day window" }));
    fireEvent.change(screen.getByLabelText("Date"), {
      target: { value: "2026-10-02" },
    });
    fireEvent.change(screen.getByLabelText("Start"), {
      target: { value: "18:00" },
    });
    fireEvent.change(screen.getByLabelText("End"), {
      target: { value: "17:00" },
    });
    fireEvent.change(screen.getByLabelText("Per-person amount"), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add a step" }));
    fireEvent.change(screen.getByLabelText("Step name"), {
      target: { value: "Dinner" },
    });
    const options = screen.getAllByLabelText("Option label");
    fireEvent.change(options[0] as HTMLElement, { target: { value: "Koshary" } });
    fireEvent.change(screen.getByLabelText("Answered threshold"), {
      target: { value: "0" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(screen.getByLabelText("Plan title").getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(screen.getByLabelText("Timezone").getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(screen.getByLabelText("End").getAttribute("aria-invalid")).toBe("true");
    expect(
      screen.getByLabelText("Per-person amount").getAttribute("aria-invalid"),
    ).toBe("true");
    expect(
      screen.getAllByLabelText("Option label")[1]?.getAttribute("aria-invalid"),
    ).toBe("true");
    expect(
      screen.getByLabelText("Answered threshold").getAttribute("aria-invalid"),
    ).toBe("true");

    expect(screen.getByText("End must be after start.")).toBeTruthy();
    expect(screen.getByText("Enter a positive amount.")).toBeTruthy();
    expect(screen.getByText("This is below the minimum.")).toBeTruthy();
    expect(screen.getAllByText("This is required.").length).toBeGreaterThanOrEqual(2);

    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe(
      "2026-10-02",
    );
    expect((screen.getByLabelText("Start") as HTMLInputElement).value).toBe("18:00");
    expect((screen.getByLabelText("End") as HTMLInputElement).value).toBe("17:00");
    expect((screen.getByLabelText("Per-person amount") as HTMLInputElement).value).toBe(
      "0",
    );
    expect((screen.getByLabelText("Step name") as HTMLInputElement).value).toBe(
      "Dinner",
    );
    expect((screen.getAllByLabelText("Option label")[0] as HTMLInputElement).value).toBe(
      "Koshary",
    );
    expect((screen.getByLabelText("Answered threshold") as HTMLInputElement).value).toBe(
      "0",
    );

    expect(postCall(fetchMock, "/api/v1/plans")).toBeUndefined();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("a save failure keeps the entered values, uses text-destructive, and does not navigate", async () => {
    const fetchMock = await renderSignedInForm({ plansPost: "fail" });
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    const alert = await screen.findByRole("alert");
    expect(classTokens(alert)).toContain("text-destructive");
    expect(alert.textContent).toBe("A data source is unavailable. Retry.");
    expect((screen.getByLabelText("Plan title") as HTMLInputElement).value).toBe(
      "Thursday in Maadi",
    );
    expect((screen.getByLabelText("Timezone") as HTMLInputElement).value).toBe(
      "Africa/Cairo",
    );
    expect((screen.getByLabelText("Per-person amount") as HTMLInputElement).value).toBe(
      "500.00",
    );
    expect((screen.getByLabelText("Step name") as HTMLInputElement).value).toBe(
      "Dinner",
    );
    expect((screen.getByLabelText("Answered threshold") as HTMLInputElement).value).toBe(
      "3",
    );
    expect(router.push).not.toHaveBeenCalled();

    const posted = postCall(fetchMock, "/api/v1/plans");
    expect(posted?.credentials).toBe("same-origin");
    expect(posted?.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-HP-Request": "1",
    });
  });

  it("T-001-32/AC-1 a valid submit opens the new organizer plan in collecting with answered count 0", async () => {
    const fetchMock = await renderSignedInForm({ plansPost: "ok" });
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/plans/${createdPlan.id}`);
    });

    const posted = postCall(fetchMock, "/api/v1/plans");
    expect(posted?.credentials).toBe("same-origin");
    expect(posted?.headers).toMatchObject({
      "X-HP-Request": "1",
    });
    expect(JSON.parse(String(posted?.body))).toEqual({
      title: "Thursday in Maadi",
      timezone: "Africa/Cairo",
      windows: [
        {
          local_date: "2026-10-02",
          start_local: "18:00",
          end_local: "23:00",
        },
      ],
      budget: { amount_minor: 50000, currency: "EGP" },
      steps: [{ name: "Dinner", options: ["Koshary", "Grills"] }],
      threshold: 3,
    });
    expect(createdPlan.state).toBe("collecting");
    expect(createdPlan.answered_count).toBe(0);
  });

  it("T-001-46/AC-7 a valid submit sends one POST /api/v1/plans and opens the organizer plan", async () => {
    const fetchMock = await renderSignedInForm({ plansPost: "ok" });
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/plans/${createdPlan.id}`);
    });
    const posts = fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url) === "/api/v1/plans" && (init?.method ?? "GET") === "POST",
    );
    expect(posts).toHaveLength(1);
    // The form was seeded from the server, so the only GET is the slide request.
    expect(getRequests(fetchMock)).toEqual(["/api/v1/me"]);
  });

  it("T-001-46/AC-2 shows the form with the initial currencies and makes no first-load request beyond the slide", async () => {
    const fetchMock = stubFetch({ me: "in" });
    renderCreate({
      currencies: [
        { code: "EGP", exponent: 2 },
        { code: "KWD", exponent: 3 },
      ],
    });

    const field = (await screen.findByLabelText("Currency")) as HTMLSelectElement;
    expect(Array.from(field.options).map((option) => option.value)).toEqual([
      "EGP",
      "KWD",
    ]);
    await waitFor(() => {
      expect(getRequests(fetchMock)).toEqual(["/api/v1/me"]);
    });
    expect(getRequests(fetchMock)).not.toContain("/api/v1/currencies");
  });

  it("T-001-46/AC-3 with initial data sends exactly one GET /api/v1/me after mount", async () => {
    const fetchMock = stubFetch({ me: "in" });
    renderCreate();
    await screen.findByLabelText("Plan title");
    await waitFor(() => {
      expect(getRequests(fetchMock)).toEqual(["/api/v1/me"]);
    });
  });

  it("T-001-46/AC-3 with null the slide sends nothing and only the gate's own GET /api/v1/me runs", async () => {
    const fetchMock = stubFetch({ me: "out" });
    renderCreate(null);
    await screen.findByText("An account is required to organize a plan.");
    await waitFor(() => {
      expect(getRequests(fetchMock)).toEqual(["/api/v1/me"]);
    });
  });

  it("T-001-46/AC-5 initial data that does not parse shows the form with the default currencies", async () => {
    const fetchMock = stubFetch({ me: "in" });
    renderCreate({ currencies: "nope" });

    const field = (await screen.findByLabelText("Currency")) as HTMLSelectElement;
    expect(Array.from(field.options).map((option) => option.value)).toEqual([
      "EGP",
      "USD",
      "SAR",
      "AED",
    ]);
    expect(getRequests(fetchMock)).not.toContain("/api/v1/currencies");
  });

  it("T-001-46/AC-4 a null initial value is the account gate with next=/plans/new", async () => {
    stubFetch({ me: "out", sessions: "ok" });
    renderCreate(null);

    expect(
      await screen.findByText("An account is required to organize a plan."),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Plan title")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Create a plan" })).toBeNull();

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "nour@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "a-secret-pass" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith("/plans/new");
    });
  });

  it("T-001-93/AC-1 T-001-11/AC-8 switching language keeps unsaved create input", async () => {
    const fetchMock = await renderSignedInForm();
    fillValidForm();
    fireEvent.change(screen.getByLabelText("Currency"), { target: { value: "SAR" } });

    const byId = (id: string): string =>
      (document.getElementById(id) as HTMLInputElement | HTMLSelectElement).value;
    const entered = {
      "hp-title": "Thursday in Maadi",
      "hp-timezone": "Africa/Cairo",
      "hp-window-0-date": "2026-10-02",
      "hp-window-0-start": "18:00",
      "hp-window-0-end": "23:00",
      "hp-amount": "500.00",
      "hp-currency": "SAR",
      "hp-step-0-name": "Dinner",
      "hp-step-0-option-0": "Koshary",
      "hp-step-0-option-1": "Grills",
      "hp-step-0-option-2": "",
      "hp-step-0-option-3": "",
      "hp-threshold": "3",
    };
    const expectEntered = (): void => {
      for (const [id, expected] of Object.entries(entered)) {
        expect(byId(id), id).toBe(expected);
      }
    };
    expectEntered();

    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), {
      target: { value: "ar" },
    });
    // The chrome switched to Arabic RTL ...
    expect(document.cookie).toMatch(/(?:^|; )hp_locale=ar(?:;|$)/);
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
    expect(screen.getByLabelText("عنوان الخطة")).toBe(document.getElementById("hp-title"));
    expect(screen.queryByLabelText("Plan title")).toBeNull();
    // ... and every unsaved input is kept.
    expectEntered();

    fireEvent.change(screen.getByRole("combobox", { name: "اللغة" }), {
      target: { value: "en" },
    });
    expect(document.documentElement.dir).toBe("ltr");
    expect(screen.getByLabelText("Plan title")).toBe(document.getElementById("hp-title"));
    expectEntered();

    // Nothing was saved: switching sends no plan write.
    expect(postCall(fetchMock, "/api/v1/plans")).toBeUndefined();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("switching language keeps unsaved create input", async () => {
    await renderSignedInForm();
    fireEvent.change(screen.getByLabelText("Plan title"), {
      target: { value: "Thursday in Maadi" },
    });
    fireEvent.change(screen.getByLabelText("Per-person amount"), {
      target: { value: "250" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add a step" }));
    fireEvent.change(screen.getByLabelText("Step name"), {
      target: { value: "Dinner" },
    });

    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), {
      target: { value: "ar" },
    });

    expect(document.cookie).toMatch(/(?:^|; )hp_locale=ar(?:;|$)/);
    expect(document.documentElement.dir).toBe("rtl");
    expect((screen.getByLabelText("عنوان الخطة") as HTMLInputElement).value).toBe(
      "Thursday in Maadi",
    );
    expect((screen.getByLabelText("المبلغ للشخص") as HTMLInputElement).value).toBe(
      "250",
    );
    expect((screen.getByLabelText("اسم الخطوة") as HTMLInputElement).value).toBe(
      "Dinner",
    );
  });
});

describe("CreateForm error bodies", () => {
  type Shown = { alerts: string[]; fields: string[]; markup: string };

  async function createAnswering(response: () => Response): Promise<Shown> {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (url === "/api/v1/me" && method === "GET") {
          return jsonResponse(200, nourAccount);
        }
        if (url === "/api/v1/plans" && method === "POST") {
          return response();
        }
        throw new Error(`unexpected fetch ${method} ${url}`);
      }),
    );
    const { container } = renderCreate();
    await screen.findByLabelText("Plan title");
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByRole("alert");
    await waitFor(() => {
      expect(
        (screen.getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled,
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
    const notJson = await createAnswering(
      () => new Response("<html>bad gateway</html>", { status: 400 }),
    );
    const empty = await createAnswering(() => jsonResponse(400, {}));
    expect(empty.alerts).toEqual([en.Create.saveError]);
    expect(notJson.alerts).toEqual(empty.alerts);
    expect(notJson.fields).toEqual(empty.fields);
    expect(notJson.markup).toBe(empty.markup);
  });

  it("T-001-99/AC-2 malformed fields entries beside a valid one show the same field errors as the valid one alone", async () => {
    const envelope = (fields: unknown[]) => ({
      error: { code: "validation_failed", message: "invalid fields", fields },
    });
    const valid = { path: "title", code: "required" };
    const mixed = await createAnswering(() =>
      jsonResponse(400, envelope([valid, { path: 1, code: "required" }, "junk", null])),
    );
    const alone = await createAnswering(() => jsonResponse(400, envelope([valid])));
    expect(alone.fields).toEqual([`hp-title-error:${en.errors.fields.required}`]);
    expect(mixed.fields).toEqual(alone.fields);
    expect(mixed.alerts).toEqual(alone.alerts);
    expect(mixed.markup).toBe(alone.markup);
  });
});
