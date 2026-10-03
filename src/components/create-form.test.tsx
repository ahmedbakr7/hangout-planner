import { readFileSync } from "node:fs";
import { join } from "node:path";
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

const TICKET_FILES = [
  "src/app/plans/new/page.tsx",
  "src/components/create-form.tsx",
  "src/components/create-form.test.tsx",
];

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

function renderCreate() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <CreateForm />
    </NextIntlClientProvider>,
  );
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

describe("CreateForm chrome", () => {
  it("composes shadcn primitives with DESIGN.md semantic classes and no raw hex", () => {
    const hex = new RegExp("#" + "[0-9a-fA-F]{3,8}\\b");
    const root = process.cwd();
    for (const relative of TICKET_FILES) {
      const source = readFileSync(join(root, relative), "utf8");
      expect(source, relative).not.toMatch(hex);
    }
    const form = readFileSync(join(root, "src/components/create-form.tsx"), "utf8");
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
  });
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

  it("a signed-out open of create is the account gate with next=/plans/new", async () => {
    stubFetch({ me: "out", sessions: "ok" });
    renderCreate();

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
