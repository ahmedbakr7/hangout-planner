"use client";

import { useTranslations } from "next-intl";
import React, { useEffect, useState, type ReactNode } from "react";
import { LanguageControl } from "@/components/language-control";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";

type SessionState = "checking" | "signed_out" | "signed_in";
type LoadState = "idle" | "loading" | "loaded" | "error";

const PLAN_STATES = ["collecting", "blocked", "proposed", "locked"] as const;
type PlanState = (typeof PLAN_STATES)[number];

type HomePlan = {
  id: string;
  title: string;
  answeredCount: number;
  threshold: number;
  state: PlanState;
};

function isPlanState(value: unknown): value is PlanState {
  return (
    value === "collecting" ||
    value === "blocked" ||
    value === "proposed" ||
    value === "locked"
  );
}

function parsePlan(value: unknown): HomePlan | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as {
    id?: unknown;
    title?: unknown;
    answered_count?: unknown;
    threshold?: unknown;
    state?: unknown;
  };
  if (typeof record.id !== "string" || record.id.length === 0) {
    return null;
  }
  if (typeof record.title !== "string") {
    return null;
  }
  if (
    typeof record.answered_count !== "number" ||
    !Number.isInteger(record.answered_count)
  ) {
    return null;
  }
  if (
    typeof record.threshold !== "number" ||
    !Number.isInteger(record.threshold)
  ) {
    return null;
  }
  if (!isPlanState(record.state)) {
    return null;
  }
  return {
    id: record.id,
    title: record.title,
    answeredCount: record.answered_count,
    threshold: record.threshold,
    state: record.state,
  };
}

function parsePlans(body: unknown): HomePlan[] | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const plans = (body as { plans?: unknown }).plans;
  if (!Array.isArray(plans)) {
    return null;
  }
  const rows: HomePlan[] = [];
  for (const item of plans) {
    const parsed = parsePlan(item);
    if (parsed) {
      rows.push(parsed);
    }
  }
  return rows;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function planHref(plan: HomePlan): string {
  if (plan.state === "locked") {
    return `/plans/${plan.id}/confirmed`;
  }
  return `/plans/${plan.id}`;
}

function stateClassName(state: PlanState): string {
  if (state === "blocked") {
    return "text-destructive";
  }
  if (state === "locked") {
    return "text-success";
  }
  if (state === "proposed") {
    return "text-foreground";
  }
  return "text-muted-foreground";
}

function HomeShell({ children }: { children: ReactNode }): ReactNode {
  return (
    <main className="bg-background text-foreground">
      <Card className="border-border bg-card text-card-foreground">
        {children}
      </Card>
    </main>
  );
}

function HomeListBody(): ReactNode {
  const t = useTranslations("Home");
  const [session, setSession] = useState<SessionState>("checking");
  const [load, setLoad] = useState<LoadState>("idle");
  const [plans, setPlans] = useState<HomePlan[]>([]);

  async function loadPlans(): Promise<void> {
    setLoad("loading");
    setPlans([]);
    try {
      const response = await fetch("/v1/plans", { credentials: "same-origin" });
      if (!response.ok) {
        setLoad("error");
        setPlans([]);
        return;
      }
      const body = await readJson(response);
      const rows = parsePlans(body);
      if (!rows) {
        setLoad("error");
        setPlans([]);
        return;
      }
      setPlans(rows);
      setLoad("loaded");
    } catch {
      setLoad("error");
      setPlans([]);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadMe(): Promise<void> {
      try {
        const response = await fetch("/v1/me", { credentials: "same-origin" });
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          setSession("signed_out");
          setLoad("idle");
          setPlans([]);
          return;
        }
        setSession("signed_in");
        await loadPlans();
      } catch {
        if (!cancelled) {
          setSession("signed_out");
          setLoad("idle");
          setPlans([]);
        }
      }
    }

    void loadMe();
    return () => {
      cancelled = true;
    };
  }, []);

  if (session === "checking") {
    return (
      <HomeShell>
        <CardHeader>
          <h1 className="title text-foreground text-start text-pretty">
            {t("title")}
          </h1>
        </CardHeader>
      </HomeShell>
    );
  }

  const createHref =
    session === "signed_out" ? "/account?next=/plans/new" : "/plans/new";

  return (
    <HomeShell>
      <CardHeader className="gap-3">
        <h1 className="title text-foreground text-start text-pretty">
          {t("title")}
        </h1>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Button asChild className="self-start bg-primary">
          <a href={createHref}>{t("create")}</a>
        </Button>

        {session === "signed_out" ? (
          <p className="body text-foreground text-start text-pretty">
            {t("signedOutFriends")}
          </p>
        ) : null}

        {session === "signed_in" ? (
          <Button variant="link" asChild className="h-auto self-start p-0">
            <a href="/invitations">{t("invitations")}</a>
          </Button>
        ) : null}

        {load === "error" ? (
          <>
            <p className="text-destructive text-start" role="alert">
              {t("loadError")}
            </p>
            <Button
              type="button"
              variant="secondary"
              className="self-start"
              onClick={() => void loadPlans()}
            >
              {t("retry")}
            </Button>
          </>
        ) : null}

        {load === "loaded" ? (
          plans.length === 0 ? (
            <p className="body text-muted-foreground text-start text-pretty">
              {t("empty")}
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {plans.map((plan) => (
                <li key={plan.id}>
                  <a
                    href={planHref(plan)}
                    className="flex flex-col gap-1 rounded-md border border-border bg-card p-3 text-foreground no-underline"
                  >
                    <span className="body text-foreground text-start">
                      {plan.title}
                    </span>
                    <span className="caption text-muted-foreground text-start tabular-nums">
                      {t("answered", {
                        answered: plan.answeredCount,
                        threshold: plan.threshold,
                      })}
                    </span>
                    <span
                      className={`caption text-start ${stateClassName(plan.state)}`}
                    >
                      {t(`state.${plan.state}`)}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </CardContent>
    </HomeShell>
  );
}

export function HomeList(): ReactNode {
  return (
    <LanguageControl>
      <HomeListBody />
    </LanguageControl>
  );
}
