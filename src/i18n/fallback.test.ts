import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountGate } from "@/components/account-gate";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";
import {
  dirForLocale,
  mergeMessages,
  messagesForLocale,
} from "@/i18n/request";

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

const missingSession = {
  error: {
    code: "unauthenticated",
    reason: "missing_session",
    message: "missing session",
    fields: [],
  },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.cookie = "hp_locale=;path=/;max-age=0";
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
});

describe("Arabic chrome fallback", () => {
  it("renders a missing Arabic key as English while dir stays rtl", () => {
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
    const merged = mergeMessages(en as MessageTree, overlay);
    expect(lookup(merged, ["Account", "requiredToOrganize"])).toBe(
      "An account is required to organize a plan.",
    );
  });

  it("keeps the gate usable in an RTL layout when an Arabic key is missing", async () => {
    const overlay = structuredClone(ar) as MessageTree;
    const account = overlay.Account;
    if (typeof account !== "object" || account === null) {
      throw new Error("Account catalog missing");
    }
    delete account.requiredToOrganize;
    const messages = mergeMessages(en as MessageTree, overlay);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/v1/me") {
          return new Response(JSON.stringify(missingSession), {
            status: 401,
            headers: { "Content-Type": "application/json" },
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
    expect(document.documentElement.lang).toBe("ar");

    const email = screen.getByLabelText("البريد") as HTMLInputElement;
    fireEvent.change(email, { target: { value: "nour@example.com" } });
    expect(email.value).toBe("nour@example.com");
    const signIn = screen.getByRole("button", { name: "تسجيل الدخول" });
    expect(signIn).toBeTruthy();
    expect(signIn.className.split(/\s+/)).toContain("bg-primary");
    expect(screen.getByRole("tab", { name: "إنشاء حساب" })).toBeTruthy();
    expect(email.disabled).toBe(false);
  });
});
