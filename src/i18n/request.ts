import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";

export const LOCALE_COOKIE = "hp_locale";
export const FALLBACK_LOCALE = "en" as const;
export const LOCALES = ["en", "ar"] as const;

export type AppLocale = (typeof LOCALES)[number];

type MessageTree = { [key: string]: string | MessageTree };

export function localeFromCookie(value: string | undefined): AppLocale {
  return value === "ar" ? "ar" : FALLBACK_LOCALE;
}

export function dirForLocale(locale: AppLocale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

export function mergeMessages(
  fallback: MessageTree,
  overlay: MessageTree,
): MessageTree {
  const merged: MessageTree = { ...fallback };
  for (const [key, value] of Object.entries(overlay)) {
    const existing = merged[key];
    if (
      typeof value === "object" &&
      value !== null &&
      typeof existing === "object" &&
      existing !== null
    ) {
      merged[key] = mergeMessages(existing, value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

export function messagesForLocale(locale: AppLocale): MessageTree {
  if (locale === "ar") {
    return mergeMessages(en as MessageTree, ar as MessageTree);
  }
  return en as MessageTree;
}

export default getRequestConfig(async () => {
  const store = await cookies();
  const locale = localeFromCookie(store.get(LOCALE_COOKIE)?.value);
  return {
    locale,
    messages: messagesForLocale(locale),
  };
});
