"use client";

import { useTranslations } from "next-intl";
import React, { useEffect, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function InvitationsError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}): ReactNode {
  const t = useTranslations("invitations");

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="bg-background text-foreground">
      <Card className="border-border bg-card text-card-foreground">
        <CardHeader>
          <h1 className="title text-foreground text-start text-pretty">
            {t("title")}
          </h1>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-destructive text-start" role="alert">
            {t("loadError")}
          </p>
          <Button
            type="button"
            variant="secondary"
            className="self-start"
            onClick={() => retry()}
          >
            {t("retry")}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
