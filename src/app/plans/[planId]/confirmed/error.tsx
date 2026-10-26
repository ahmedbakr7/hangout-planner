"use client";

import { useTranslations } from "next-intl";
import React, { type ReactNode } from "react";
import { RouteLoadError } from "@/components/route-load-error";

export default function ConfirmedError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}): ReactNode {
  const t = useTranslations("confirmed");
  const tCommon = useTranslations("common");

  return (
    <RouteLoadError
      error={error}
      retry={retry}
      title={t("title")}
      alert={t("loadError")}
      retryLabel={tCommon("retry")}
    />
  );
}
