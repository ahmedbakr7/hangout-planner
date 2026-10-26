"use client";

import { useTranslations } from "next-intl";
import React, { type ReactNode } from "react";
import { RouteLoadError } from "@/components/route-load-error";

export default function CreatePlanError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}): ReactNode {
  const t = useTranslations("Create");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");

  return (
    <RouteLoadError
      error={error}
      retry={retry}
      title={t("title")}
      alert={tErrors("code.upstream")}
      retryLabel={tCommon("retry")}
    />
  );
}
