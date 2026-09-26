import { describe, expect, it } from "vitest";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";
import {
  dirForLocale,
  FALLBACK_LOCALE,
  localeFromCookie,
  LOCALE_COOKIE,
  LOCALES,
  mergeMessages,
  messagesForLocale,
} from "@/i18n/request";

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

describe("locale cookie helpers", () => {
  it("uses hp_locale as the locale cookie name", () => {
    expect(LOCALE_COOKIE).toBe("hp_locale");
    expect(LOCALES).toEqual(["en", "ar"]);
    expect(FALLBACK_LOCALE).toBe("en");
  });

  it("maps hp_locale cookie values to locale and dir", () => {
    expect(localeFromCookie("ar")).toBe("ar");
    expect(dirForLocale("ar")).toBe("rtl");
    expect(localeFromCookie("en")).toBe("en");
    expect(dirForLocale("en")).toBe("ltr");
    expect(localeFromCookie(undefined)).toBe("en");
    expect(localeFromCookie("fr")).toBe("en");
    expect(localeFromCookie("")).toBe("en");
    expect(dirForLocale(localeFromCookie("ar"))).toBe("rtl");
    expect(dirForLocale(localeFromCookie(undefined))).toBe("ltr");
  });
});

describe("messagesForLocale", () => {
  it("returns English catalog for en", () => {
    expect(messagesForLocale("en")).toEqual(en);
  });

  it("merges Arabic over English so a missing Arabic key stays English while ar still maps to rtl", () => {
    expect(dirForLocale("ar")).toBe("rtl");
    expect(
      (ar as { common: { create?: string } }).common.create,
    ).toBeUndefined();
    expect(lookup(messagesForLocale("ar"), ["common", "create"])).toBe(
      "Create",
    );
    expect(lookup(en as MessageTree, ["common", "create"])).toBe("Create");
  });

  it("deep-merges nested overlays without dropping sibling English keys", () => {
    const fallback: MessageTree = {
      common: { create: "Create", save: "Save" },
      Home: { title: "Home" },
    };
    const overlay: MessageTree = {
      common: { save: "حفظ" },
    };
    const merged = mergeMessages(fallback, overlay);
    expect(lookup(merged, ["common", "create"])).toBe("Create");
    expect(lookup(merged, ["common", "save"])).toBe("حفظ");
    expect(lookup(merged, ["Home", "title"])).toBe("Home");
  });
});
