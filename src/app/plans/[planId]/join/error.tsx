"use client";

import { useTranslations } from "next-intl";
import React, { type ReactNode } from "react";
import { RouteLoadError } from "@/components/route-load-error";

export default function PlanJoinError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}): ReactNode {
  const t = useTranslations("join");
  const tCommon = useTranslations("common");

  return (
    <RouteLoadError
      error={error}
      retry={retry}
      title={t("title")}
      alert={t("joinFailed")}
      retryLabel={tCommon("retry")}
    />
  );
}
