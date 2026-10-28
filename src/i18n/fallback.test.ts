import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { type ComponentProps, createElement } from "react";
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
  it("T-001-92/AC-1 T-001-07/AC-6 renders a missing Arabic key as English while dir stays rtl", () => {
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

  it("T-001-92/AC-1 T-001-07/AC-5 messages/en.json and messages/ar.json hold chrome strings for the slice surfaces", () => {
    // The namespaces the slice surfaces read with useTranslations: home, create, organizer plan,
    // invite, invitations, join, respond, proposal, confirmed, account, plus shared chrome.
    const surfaces = [
      "Home",
      "Create",
      "plans",
      "invite",
      "invitations",
      "join",
      "respond",
      "proposal",
      "confirmed",
      "Account",
      "common",
      "errors",
    ];
    const arabicScript = /[؀-ۿ]/;

    function leaves(tree: MessageTree, prefix: string[] = []): [string[], string][] {
      return Object.entries(tree).flatMap(([key, value]) =>
        typeof value === "string" ? [[[...prefix, key], value] as [string[], string]] : leaves(value, [...prefix, key]),
      );
    }

    const enTree = en as MessageTree;
    const arTree = ar as MessageTree;
    const enKeys = new Set(leaves(enTree).map(([path]) => path.join(".")));
    for (const [path] of leaves(arTree)) {
      expect(enKeys.has(path.join(".")), `ar-only key ${path.join(".")}`).toBe(true);
    }

    for (const surface of surfaces) {
      const enSection = enTree[surface];
      const arSection = arTree[surface];
      expect(typeof enSection, `en ${surface}`).toBe("object");
      expect(typeof arSection, `ar ${surface}`).toBe("object");
      const enLeaves = leaves(enSection as MessageTree, [surface]);
      const arLeaves = leaves(arSection as MessageTree, [surface]);
      expect(enLeaves.length, `en ${surface}`).toBeGreaterThan(0);
      expect(arLeaves.length, `ar ${surface}`).toBeGreaterThan(0);
      for (const [path, value] of [...enLeaves, ...arLeaves]) {
        expect(value.trim().length, path.join(".")).toBeGreaterThan(0);
      }
      expect(
        enLeaves.some(([, value]) => !arabicScript.test(value)),
        `en ${surface} has English chrome`,
      ).toBe(true);
      expect(
        arLeaves.some(([, value]) => arabicScript.test(value)),
        `ar ${surface} has Arabic chrome`,
      ).toBe(true);
      // Each surface key resolves to a string in both locales.
      for (const [path] of enLeaves) {
        expect(typeof lookup(messagesForLocale("en"), path)).toBe("string");
        expect(typeof lookup(messagesForLocale("ar"), path)).toBe("string");
      }
    }
  });

  it("T-001-66/AC-8 keeps the gate usable in an RTL layout when an Arabic key is missing", async () => {
    const overlay = structuredClone(ar) as MessageTree;
    const account = overlay.Account;
    if (typeof account !== "object" || account === null) {
      throw new Error("Account catalog missing");
    }
    delete account.requiredToOrganize;
    const messages = mergeMessages(en as MessageTree, overlay);

    // AccountGate's catch turns a throw into the signed-out state, so record other URLs first.
    const unexpected: string[] = [];
    const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/v1/me") {
        return new Response(JSON.stringify(missingSession), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      unexpected.push(String(input));
      throw new Error(`unexpected fetch ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchStub);

    document.documentElement.lang = "ar";
    document.documentElement.dir = "rtl";

    render(
      createElement(
        NextIntlClientProvider,
        { locale: "ar", messages } as ComponentProps<
          typeof NextIntlClientProvider
        >,
        createElement(AccountGate),
      ),
    );

    expect(
      await screen.findByText("An account is required to organize a plan."),
    ).toBeTruthy();
    expect(unexpected).toEqual([]);
    expect(fetchStub.mock.calls.map((call) => String(call[0]))).toContain("/api/v1/me");
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
