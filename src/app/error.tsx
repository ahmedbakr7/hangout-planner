"use client";

import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import React, { type ReactNode } from "react";
import { RouteLoadError } from "@/components/route-load-error";

export default function RootError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}): ReactNode {
  const t = useTranslations("Home");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const isHome = usePathname() === "/";

  return (
    <RouteLoadError
      error={error}
      retry={retry}
      title={isHome ? t("title") : undefined}
      alert={isHome ? t("loadError") : tErrors("code.upstream")}
      retryLabel={isHome ? t("retry") : tCommon("retry")}
    />
  );
}
