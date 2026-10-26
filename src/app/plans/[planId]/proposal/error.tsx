"use client";

import { useTranslations } from "next-intl";
import React, { type ReactNode } from "react";
import { RouteLoadError } from "@/components/route-load-error";

export default function ProposalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}): ReactNode {
  const t = useTranslations("proposal");

  return (
    <RouteLoadError
      error={error}
      retry={retry}
      title={t("title")}
      alert={t("loadError")}
      retryLabel={t("retry")}
    />
  );
}
