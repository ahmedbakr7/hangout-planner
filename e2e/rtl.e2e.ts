/**
 * T-001-29 — RTL / locale e2e
 * Covers: Arabic locale sets dir=rtl on create and on confirmed;
 * a missing Arabic key still shows the English string.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountGate } from "@/components/account-gate";
import { ConfirmedView } from "@/components/confirmed-view";
import { CreateForm } from "@/components/create-form";
import {
  dirForLocale,
  mergeMessages,
  messagesForLocale,
} from "@/i18n/request";
import ar from "../messages/ar.json";
import en from "../messages/en.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

type MessageTree = { [key: string]: string | MessageTree };

function lookup(tree: MessageTree, path: string[]): string {
  let current: string | MessageTree = tree;
  for (const key of path) {
    if (typeof current !== "object" || current === null) {
      throw new Error(`missing ${path.join(".")}`);
    }
    const next: string | MessageTree | undefined = current[key];
    if (next === undefined) {
      throw new Error(`missing ${path.join(".")}`);
    }
    current = next;
  }
  if (typeof current !== "string") {
    throw new Error(`not a string: ${path.join(".")}`);
  }
  return current;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const nourAccount = {
  account: {
    id: "acc_nouraaaaaaaaaaaaaaaaaaa",
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

const PLAN_ID = "pln_confirmedaaaaaaaaaaaa";
const DINNER_ID = "stp_dinneraaaaaaaaaaaaaaa";
const COFFEE_ID = "stp_coffeeaaaaaaaaaaaaaaa";

const lockedBody = {
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
    {
      step_id: COFFEE_ID,
      place_name: "Cilantro",
      amount_minor: 4000,
      currency: "EGP",
    },
  ],
  legs: [
    {
      from_step_id: DINNER_ID,
      to_step_id: COFFEE_ID,
      duration_seconds: 840,
    },
  ],
  cohort: [
    { display_name: "Nour", distinguisher: "n8p1" },
    { display_name: "Hana", distinguisher: "a3k9" },
  ],
};

function stubCreateFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url === "/v1/me" && method === "GET") {
      return jsonResponse(200, nourAccount);
    }
    if (url === "/v1/currencies" && method === "GET") {
      return jsonResponse(200, currenciesBody);
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubConfirmedFetch() {
  const confirmedPath = `/v1/plans/${PLAN_ID}/confirmed`;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url === confirmedPath && method === "GET") {
      return jsonResponse(200, lockedBody);
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.cookie = "hp_locale=;path=/;max-age=0";
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
});

describe("e2e rtl", () => {
  it("Arabic locale sets dir=rtl on create", async () => {
    stubCreateFetch();
    render(
      createElement(NextIntlClientProvider, {
        locale: "en",
        messages: en,
        children: createElement(CreateForm),
      }),
    );
    expect(await screen.findByLabelText("Plan title")).toBeTruthy();

    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), {
      target: { value: "ar" },
    });

    expect(document.cookie).toMatch(/(?:^|; )hp_locale=ar(?:;|$)/);
    expect(document.documentElement.dir).toBe("rtl");
    expect(document.documentElement.lang).toBe("ar");
    expect(dirForLocale("ar")).toBe("rtl");
    expect(screen.getByLabelText("عنوان الخطة")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "إنشاء خطة" })).toBeTruthy();
  });

  it("Arabic locale sets dir=rtl on confirmed", async () => {
    stubConfirmedFetch();
    render(
      createElement(NextIntlClientProvider, {
        locale: "en",
        messages: en,
        children: createElement(ConfirmedView, { planId: PLAN_ID }),
      }),
    );
    expect(await screen.findByText("Abu Tarek")).toBeTruthy();

    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), {
      target: { value: "ar" },
    });

    expect(document.cookie).toMatch(/(?:^|; )hp_locale=ar(?:;|$)/);
    expect(document.documentElement.dir).toBe("rtl");
    expect(document.documentElement.lang).toBe("ar");
    expect(await screen.findByRole("heading", { name: "الخطة المؤكدة" })).toBeTruthy();
    expect(screen.getByText("Abu Tarek")).toBeTruthy();
  });

  it("a missing Arabic key still shows the English string", async () => {
    expect(dirForLocale("ar")).toBe("rtl");
    expect(lookup(messagesForLocale("ar"), ["common", "create"])).toBe("Create");
    expect(
      (ar as { common: { create?: string } }).common.create,
    ).toBeUndefined();

    const overlay = structuredClone(ar) as MessageTree;
    const account = overlay.Account;
    if (typeof account !== "object" || account === null) {
      throw new Error("Account catalog missing");
    }
    delete account.requiredToOrganize;
    const messages = mergeMessages(en as MessageTree, overlay);
    expect(lookup(messages, ["Account", "requiredToOrganize"])).toBe(
      "An account is required to organize a plan.",
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/v1/me") {
          return jsonResponse(401, {
            error: {
              code: "unauthenticated",
              reason: "missing_session",
              message: "missing session",
              fields: [],
            },
          });
        }
        throw new Error(`unexpected fetch ${String(input)}`);
      }),
    );

    document.documentElement.lang = "ar";
    document.documentElement.dir = "rtl";

    render(
      createElement(NextIntlClientProvider, {
        locale: "ar",
        messages: messages as never,
        children: createElement(AccountGate),
      }),
    );

    expect(
      await screen.findByText("An account is required to organize a plan."),
    ).toBeTruthy();
    expect(document.documentElement.dir).toBe("rtl");
    expect(screen.getByLabelText("البريد")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "تسجيل الدخول" })).toBeTruthy();
    });
  });
});
