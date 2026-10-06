"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import React, { useEffect, useState, type ReactNode } from "react";
import { LanguageControl } from "@/components/language-control";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";

const BUDGET_EXPONENT = 2;

type LoadState = "loading" | "loaded" | "error" | "redirecting";

type ParsedError = {
  code?: string;
  reason?: string;
};

type OpeningNext = "organizer" | "respond" | "proposal" | "confirmed" | "join";

type CohortMember = {
  displayName: string;
  distinguisher: string;
};

type ConfirmedStep = {
  stepId: string;
  placeName: string;
  amountMinor: number;
  currency: string;
};

type ConfirmedLeg = {
  fromStepId: string;
  toStepId: string;
  durationSeconds: number | null;
};

type ConfirmedDoc = {
  title: string;
  time: { localDate: string; localTime: string; timezone: string };
  steps: ConfirmedStep[];
  legs: ConfirmedLeg[];
  cohort: CohortMember[];
};

export type ConfirmedViewProps = {
  planId: string;
};

function parseError(body: unknown): ParsedError {
  if (typeof body !== "object" || body === null) {
    return {};
  }
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) {
    return {};
  }
  const record = error as { code?: unknown; reason?: unknown };
  return {
    code: typeof record.code === "string" ? record.code : undefined,
    reason: typeof record.reason === "string" ? record.reason : undefined,
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function toHm(value: string): string {
  return value.length >= 5 ? value.slice(0, 5) : value;
}

function amountMinorToDecimal(amountMinor: number, exponent: number): string {
  if (!Number.isInteger(amountMinor)) {
    return "";
  }
  const negative = amountMinor < 0;
  const abs = negative ? -amountMinor : amountMinor;
  const digits = String(abs);
  if (exponent <= 0) {
    return negative ? `-${digits}` : digits;
  }
  const padded = digits.padStart(exponent + 1, "0");
  const at = padded.length - exponent;
  return `${negative ? "-" : ""}${padded.slice(0, at)}.${padded.slice(at)}`;
}

function formatMoney(
  amountMinor: number,
  currency: string,
  locale: string,
): string {
  const decimal = amountMinorToDecimal(amountMinor, BUDGET_EXPONENT);
  let amount = decimal;
  try {
    amount = new Intl.NumberFormat(locale, {
      minimumFractionDigits: BUDGET_EXPONENT,
      maximumFractionDigits: BUDGET_EXPONENT,
      numberingSystem: "latn",
    }).format(Number(decimal));
  } catch {
    amount = decimal;
  }
  return `${amount} ${currency}`;
}

function formatTravelDuration(seconds: number | null): string {
  if (seconds === null || !Number.isInteger(seconds) || seconds < 1) {
    return "";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) {
    return `${seconds}s`;
  }
  return `${minutes} min`;
}

function foldDisplayName(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase();
}

function collidingNameKeys(members: readonly CohortMember[]): Set<string> {
  const counts = new Map<string, number>();
  for (const member of members) {
    const key = foldDisplayName(member.displayName);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const colliding = new Set<string>();
  for (const [key, count] of counts) {
    if (count > 1) {
      colliding.add(key);
    }
  }
  return colliding;
}

function parseCohortMember(value: unknown): CohortMember | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as {
    display_name?: unknown;
    distinguisher?: unknown;
  };
  if (typeof record.display_name !== "string") {
    return null;
  }
  if (typeof record.distinguisher !== "string") {
    return null;
  }
  return {
    displayName: record.display_name,
    distinguisher: record.distinguisher,
  };
}

function parseStep(value: unknown): ConfirmedStep | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as {
    step_id?: unknown;
    place_name?: unknown;
    amount_minor?: unknown;
    currency?: unknown;
  };
  if (typeof record.step_id !== "string" || record.step_id.length === 0) {
    return null;
  }
  if (typeof record.place_name !== "string") {
    return null;
  }
  if (
    typeof record.amount_minor !== "number" ||
    !Number.isInteger(record.amount_minor)
  ) {
    return null;
  }
  if (typeof record.currency !== "string" || record.currency.length === 0) {
    return null;
  }
  return {
    stepId: record.step_id,
    placeName: record.place_name,
    amountMinor: record.amount_minor,
    currency: record.currency,
  };
}

function parseLeg(value: unknown): ConfirmedLeg | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as {
    from_step_id?: unknown;
    to_step_id?: unknown;
    duration_seconds?: unknown;
  };
  if (typeof record.from_step_id !== "string") {
    return null;
  }
  if (typeof record.to_step_id !== "string") {
    return null;
  }
  const durationSeconds =
    typeof record.duration_seconds === "number" &&
    Number.isInteger(record.duration_seconds) &&
    record.duration_seconds >= 1
      ? record.duration_seconds
      : null;
  return {
    fromStepId: record.from_step_id,
    toStepId: record.to_step_id,
    durationSeconds,
  };
}

function parseConfirmed(value: unknown): ConfirmedDoc | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as {
    title?: unknown;
    state?: unknown;
    time?: unknown;
    steps?: unknown;
    legs?: unknown;
    cohort?: unknown;
  };
  if (typeof record.title !== "string") {
    return null;
  }
  if (record.state !== "locked") {
    return null;
  }
  if (typeof record.time !== "object" || record.time === null) {
    return null;
  }
  const time = record.time as {
    local_date?: unknown;
    local_time?: unknown;
    timezone?: unknown;
  };
  if (typeof time.local_date !== "string") {
    return null;
  }
  if (typeof time.local_time !== "string") {
    return null;
  }
  if (typeof time.timezone !== "string") {
    return null;
  }
  if (!Array.isArray(record.steps) || !Array.isArray(record.cohort)) {
    return null;
  }
  const steps: ConfirmedStep[] = [];
  for (const item of record.steps) {
    const step = parseStep(item);
    if (!step) {
      return null;
    }
    steps.push(step);
  }
  const cohort: CohortMember[] = [];
  for (const item of record.cohort) {
    const member = parseCohortMember(item);
    if (!member) {
      return null;
    }
    cohort.push(member);
  }
  const legs: ConfirmedLeg[] = [];
  if (Array.isArray(record.legs)) {
    for (const item of record.legs) {
      const leg = parseLeg(item);
      if (leg) {
        legs.push(leg);
      }
    }
  }
  return {
    title: record.title,
    time: {
      localDate: time.local_date,
      localTime: time.local_time,
      timezone: time.timezone,
    },
    steps,
    legs,
    cohort,
  };
}

type FetchOutcome =
  | { kind: "locked"; doc: ConfirmedDoc }
  | { kind: "not_locked" }
  | { kind: "error" };

function parseFetchBody(status: number, body: unknown): FetchOutcome {
  if (status === 409 && parseError(body).reason === "not_locked") {
    return { kind: "not_locked" };
  }
  if (status < 200 || status >= 300) {
    return { kind: "error" };
  }
  const doc = parseConfirmed(body);
  if (!doc) {
    return { kind: "error" };
  }
  return { kind: "locked", doc };
}

function isOpeningNext(value: unknown): value is OpeningNext {
  return (
    value === "organizer" ||
    value === "respond" ||
    value === "proposal" ||
    value === "confirmed" ||
    value === "join"
  );
}

function hrefForOpening(planId: string, next: OpeningNext): string | null {
  if (next === "organizer") {
    return `/plans/${planId}`;
  }
  if (next === "respond") {
    return `/plans/${planId}/respond`;
  }
  if (next === "proposal") {
    return `/plans/${planId}/proposal`;
  }
  if (next === "join") {
    return `/plans/${planId}/join`;
  }
  return null;
}

function hrefFromOpeningBody(planId: string, body: unknown): string | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const next = (body as { next?: unknown }).next;
  if (!isOpeningNext(next)) {
    return null;
  }
  return hrefForOpening(planId, next);
}

function durationBetween(
  legs: readonly ConfirmedLeg[],
  fromStepId: string,
  toStepId: string,
): number | null {
  for (const leg of legs) {
    if (leg.fromStepId === fromStepId && leg.toStepId === toStepId) {
      return leg.durationSeconds;
    }
  }
  return null;
}

function ConfirmedShell({ children }: { children: ReactNode }): ReactNode {
  return (
    <main className="bg-background text-foreground">
      <Card className="border-border bg-card text-card-foreground">
        {children}
      </Card>
    </main>
  );
}

function ConfirmedViewBody({ planId }: ConfirmedViewProps): ReactNode {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("confirmed");
  const tCommon = useTranslations("common");
  const tProposal = useTranslations("proposal");

  const [load, setLoad] = useState<LoadState>("loading");
  const [doc, setDoc] = useState<ConfirmedDoc | null>(null);

  async function redirectNotLocked(): Promise<boolean> {
    try {
      const response = await fetch(`/api/v1/plans/${planId}/opening`, {
        credentials: "same-origin",
      });
      if (response.status === 404) {
        setDoc(null);
        setLoad("redirecting");
        router.replace(`/plans/${planId}/join`);
        return true;
      }
      const body = await readJson(response);
      const href = hrefFromOpeningBody(planId, body);
      if (href) {
        setDoc(null);
        setLoad("redirecting");
        router.replace(href);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async function loadConfirmed(): Promise<void> {
    setLoad("loading");
    setDoc(null);
    try {
      const response = await fetch(`/api/v1/plans/${planId}/confirmed`, {
        credentials: "same-origin",
      });
      const body = await readJson(response);
      const outcome = parseFetchBody(response.status, body);
      if (outcome.kind === "locked") {
        setDoc(outcome.doc);
        setLoad("loaded");
        return;
      }
      if (outcome.kind === "not_locked") {
        const redirected = await redirectNotLocked();
        if (!redirected) {
          setDoc(null);
          setLoad("error");
        }
        return;
      }
      setDoc(null);
      setLoad("error");
    } catch {
      setDoc(null);
      setLoad("error");
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function start(): Promise<void> {
      setLoad("loading");
      setDoc(null);
      try {
        const response = await fetch(`/api/v1/plans/${planId}/confirmed`, {
          credentials: "same-origin",
        });
        if (cancelled) {
          return;
        }
        const body = await readJson(response);
        if (cancelled) {
          return;
        }
        const outcome = parseFetchBody(response.status, body);
        if (outcome.kind === "locked") {
          setDoc(outcome.doc);
          setLoad("loaded");
          return;
        }
        if (outcome.kind === "not_locked") {
          try {
            const openingResponse = await fetch(`/api/v1/plans/${planId}/opening`, {
              credentials: "same-origin",
            });
            if (cancelled) {
              return;
            }
            if (openingResponse.status === 404) {
              setDoc(null);
              setLoad("redirecting");
              router.replace(`/plans/${planId}/join`);
              return;
            }
            const openingBody = await readJson(openingResponse);
            if (cancelled) {
              return;
            }
            const href = hrefFromOpeningBody(planId, openingBody);
            if (href) {
              setDoc(null);
              setLoad("redirecting");
              router.replace(href);
              return;
            }
          } catch {
            if (cancelled) {
              return;
            }
          }
          setDoc(null);
          setLoad("error");
          return;
        }
        setDoc(null);
        setLoad("error");
      } catch {
        if (!cancelled) {
          setDoc(null);
          setLoad("error");
        }
      }
    }

    void start();
    return () => {
      cancelled = true;
    };
  }, [planId, router]);

  if (load === "error") {
    return (
      <ConfirmedShell>
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
            onClick={() => void loadConfirmed()}
          >
            {tCommon("retry")}
          </Button>
        </CardContent>
      </ConfirmedShell>
    );
  }

  if (load === "redirecting") {
    return (
      <ConfirmedShell>
        <CardHeader />
      </ConfirmedShell>
    );
  }

  if (load !== "loaded" || !doc) {
    return (
      <ConfirmedShell>
        <CardHeader>
          <h1 className="title text-foreground text-start text-pretty">
            {t("title")}
          </h1>
        </CardHeader>
      </ConfirmedShell>
    );
  }

  const colliding = collidingNameKeys(doc.cohort);
  const timeLabel = `${doc.time.localDate} ${toHm(doc.time.localTime)} ${doc.time.timezone}`;

  return (
    <ConfirmedShell>
      <CardHeader className="gap-3">
        <h1 className="title text-foreground text-start text-pretty">
          {doc.title}
        </h1>
        <p className="body text-success text-start">{t("locked")}</p>
        <p className="body text-foreground text-start">{timeLabel}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {doc.cohort.map((member, index) => {
            const showDistinguisher = colliding.has(
              foldDisplayName(member.displayName),
            );
            return (
              <li
                key={`${member.displayName}-${member.distinguisher}-${index}`}
                className="flex flex-col items-start gap-1"
              >
                <span className="body text-foreground text-start">
                  {member.displayName}
                </span>
                {showDistinguisher ? (
                  <span className="caption text-muted-foreground text-start">
                    {member.distinguisher}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>

        <ol className="m-0 flex list-none flex-col gap-6 p-0">
          {doc.steps.map((step, index) => {
            const next = doc.steps[index + 1];
            const travel =
              next === undefined
                ? null
                : formatTravelDuration(
                    durationBetween(doc.legs, step.stepId, next.stepId),
                  );
            const money = formatMoney(step.amountMinor, step.currency, locale);
            return (
              <li key={step.stepId} className="flex flex-col items-start gap-3">
                <p className="body text-foreground text-start text-pretty">
                  {step.placeName}
                </p>
                <p className="body text-foreground text-start tabular-nums">
                  {money}
                </p>
                {next !== undefined ? (
                  <p className="caption text-muted-foreground text-start">
                    {travel ?? ""}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>

        <p className="caption text-muted-foreground text-start text-pretty">
          {tProposal("attribution")}
        </p>
      </CardContent>
    </ConfirmedShell>
  );
}

export function ConfirmedView({ planId }: ConfirmedViewProps): ReactNode {
  return (
    <LanguageControl>
      <ConfirmedViewBody planId={planId} />
    </LanguageControl>
  );
}
