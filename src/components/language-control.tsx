"use client";

import {
  NextIntlClientProvider,
  useLocale,
  useMessages,
  useTranslations,
  type AbstractIntlMessages,
} from "next-intl";
import React, { useId, useState, type ReactNode } from "react";
import arCatalog from "../../messages/ar.json";
import enCatalog from "../../messages/en.json";
import { Label } from "@/components/ui/label";

const LOCALE_COOKIE = "hp_locale";
const LOCALE_MAX_AGE = 60 * 60 * 24 * 30;
const LOCALES = ["en", "ar"] as const;

type AppLocale = (typeof LOCALES)[number];
type MessageTree = { [key: string]: string | MessageTree };

function isLocale(value: string): value is AppLocale {
  return value === "en" || value === "ar";
}

function dirForLocale(locale: AppLocale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

function mergeMessages(fallback: MessageTree, overlay: MessageTree): MessageTree {
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

function messagesForLocale(locale: AppLocale): AbstractIntlMessages {
  if (locale === "ar") {
    return mergeMessages(
      enCatalog as MessageTree,
      arCatalog as MessageTree,
    ) as AbstractIntlMessages;
  }
  return enCatalog as AbstractIntlMessages;
}

function writeLocaleCookie(locale: AppLocale): void {
  document.cookie = `${LOCALE_COOKIE}=${locale};path=/;max-age=${LOCALE_MAX_AGE};samesite=lax`;
}

function applyDocumentLocale(locale: AppLocale): void {
  document.documentElement.lang = locale;
  document.documentElement.dir = dirForLocale(locale);
}

type LanguageSwitcherProps = {
  locale: AppLocale;
  onLocaleChange: (locale: AppLocale) => void;
};

function LanguageSwitcher({
  locale,
  onLocaleChange,
}: LanguageSwitcherProps): ReactNode {
  const t = useTranslations("common");
  const id = useId();

  return (
    <div className="flex flex-col items-start gap-1">
      <Label htmlFor={id}>{t("language")}</Label>
      <select
        id={id}
        value={locale}
        onChange={(event) => {
          if (isLocale(event.target.value)) {
            onLocaleChange(event.target.value);
          }
        }}
        className="flex h-9 w-full max-w-xs rounded-sm border border-input bg-background px-3 py-1 text-sm text-foreground text-start shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <option value="en">{t("english")}</option>
        <option value="ar">{t("arabic")}</option>
      </select>
    </div>
  );
}

export function LanguageControl({
  children,
}: {
  children?: ReactNode;
}): ReactNode {
  const parentLocale = useLocale();
  const parentMessages = useMessages();
  const [locale, setLocale] = useState<AppLocale>(() =>
    isLocale(parentLocale) ? parentLocale : "en",
  );

  function selectLocale(next: AppLocale): void {
    writeLocaleCookie(next);
    applyDocumentLocale(next);
    setLocale(next);
  }

  const messages: AbstractIntlMessages =
    locale === parentLocale && parentMessages
      ? parentMessages
      : messagesForLocale(locale);

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <div className="flex flex-col gap-6">
        <LanguageSwitcher locale={locale} onLocaleChange={selectLocale} />
        {children}
      </div>
    </NextIntlClientProvider>
  );
}
