"use client";

import { useTranslations } from "next-intl";
import React, { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { LanguageControl } from "@/components/language-control";

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

const stackStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-md)",
  alignItems: "stretch",
};

const rowStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2xs)",
  alignItems: "start",
  border: "var(--focus-ring-width) solid var(--border)",
  borderRadius: "var(--radius-sm)",
  paddingBlock: "var(--space-sm)",
  paddingInline: "var(--space-sm)",
  textDecoration: "none",
  color: "var(--text)",
};

const primaryLinkStyle: CSSProperties = {
  backgroundColor: "var(--accent)",
  color: "var(--surface)",
  borderRadius: "var(--radius-sm)",
  paddingBlock: "var(--space-xs)",
  paddingInline: "var(--space-md)",
  textDecoration: "none",
  alignSelf: "start",
};

const retryButtonStyle: CSSProperties = {
  backgroundColor: "var(--surface)",
  color: "var(--text)",
  border: "var(--focus-ring-width) solid var(--border)",
  borderRadius: "var(--radius-sm)",
  paddingBlock: "var(--space-xs)",
  paddingInline: "var(--space-md)",
  font: "inherit",
  cursor: "pointer",
  alignSelf: "start",
};

const listStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-sm)",
  listStyle: "none",
  margin: 0,
  padding: 0,
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
    return "danger";
  }
  if (state === "locked") {
    return "success";
  }
  return "";
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
      <main className="surface" style={stackStyle}>
        <h1 className="title">{t("title")}</h1>
      </main>
    );
  }

  const createHref =
    session === "signed_out" ? "/account?next=/plans/new" : "/plans/new";

  return (
    <main className="surface" style={stackStyle}>
      <h1 className="title">{t("title")}</h1>
      <a href={createHref} style={primaryLinkStyle}>
        {t("create")}
      </a>

      {session === "signed_out" ? (
        <p className="body">{t("signedOutFriends")}</p>
      ) : null}

      {session === "signed_in" ? (
        <a href="/invitations">{t("invitations")}</a>
      ) : null}

      {load === "error" ? (
        <>
          <p className="danger" role="alert">
            {t("loadError")}
          </p>
          <button type="button" onClick={() => void loadPlans()} style={retryButtonStyle}>
            {t("retry")}
          </button>
        </>
      ) : null}

      {load === "loaded" && plans.length === 0 ? (
        <p className="text-muted body">{t("empty")}</p>
      ) : null}

      {load === "loaded" && plans.length > 0 ? (
        <ul style={listStyle}>
          {plans.map((plan) => {
            const stateClass = stateClassName(plan.state);
            return (
              <li key={plan.id}>
                <a href={planHref(plan)} style={rowStyle}>
                  <span className="body">{plan.title}</span>
                  <span className="caption">
                    {t("answered", {
                      answered: plan.answeredCount,
                      threshold: plan.threshold,
                    })}
                  </span>
                  <span className={stateClass || "body"}>
                    {t(`state.${plan.state}`)}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      ) : null}
    </main>
  );
}

export function HomeList(): ReactNode {
  return (
    <LanguageControl>
      <HomeListBody />
    </LanguageControl>
  );
}
