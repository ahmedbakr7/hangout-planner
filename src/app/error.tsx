"use client";

import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import React, { useEffect, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

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

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="bg-background text-foreground">
      <Card className="border-border bg-card text-card-foreground">
        {isHome ? (
          <CardHeader>
            <h1 className="title text-foreground text-start text-pretty">
              {t("title")}
            </h1>
          </CardHeader>
        ) : null}
        <CardContent className="flex flex-col gap-4">
          <p className="text-destructive text-start" role="alert">
            {isHome ? t("loadError") : tErrors("code.upstream")}
          </p>
          <Button
            type="button"
            variant="secondary"
            className="self-start"
            onClick={() => retry()}
          >
            {isHome ? t("retry") : tCommon("retry")}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
