"use client";

import React, { useEffect, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export function RouteLoadError({
  error,
  retry,
  title,
  alert,
  retryLabel,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  title?: string;
  alert: string;
  retryLabel: string;
}): ReactNode {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="bg-background text-foreground">
      <Card className="border-border bg-card text-card-foreground">
        {title === undefined ? null : (
          <CardHeader>
            <h1 className="title text-foreground text-start text-pretty">
              {title}
            </h1>
          </CardHeader>
        )}
        <CardContent className="flex flex-col gap-4">
          <p className="text-destructive text-start" role="alert">
            {alert}
          </p>
          <Button
            type="button"
            variant="secondary"
            className="self-start"
            onClick={() => retry()}
          >
            {retryLabel}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
