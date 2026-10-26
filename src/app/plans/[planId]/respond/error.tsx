"use client";

import { useTranslations } from "next-intl";
import React, { type ReactNode } from "react";
import { RouteLoadError } from "@/components/route-load-error";

export default function RespondError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}): ReactNode {
  const t = useTranslations("respond");
  const tCode = useTranslations("errors.code");
  const tCommon = useTranslations("common");

  return (
    <RouteLoadError
      error={error}
      retry={retry}
      title={t("title")}
      alert={tCode("upstream")}
      retryLabel={tCommon("retry")}
    />
  );
}
