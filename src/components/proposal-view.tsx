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
const ALTERNATIVE_CAP = 3;
const WRITE_CSRF = { "X-HP-Request": "1" } as const;
const WRITE_JSON_HEADERS = {
  "Content-Type": "application/json",
  "X-HP-Request": "1",
} as const;

type PlanState = "collecting" | "blocked" | "proposed" | "locked";
type LoadState = "loading" | "loaded" | "error" | "redirecting";
type SignalValue = "like" | "dislike" | "unset";
type Viewer = "organizer" | "cohort" | "visitor";

type ParsedError = {
  code?: string;
  reason?: string;
};

type BlockFlags = {
  time: boolean;
  budget: boolean;
  venueData: boolean;
};

type PlaceMoney = {
  name: string;
  amountMinor: number;
  currency: string;
};

type Alternative = {
  googlePlaceId: string;
  name: string;
  amountMinor: number;
  currency: string;
};

type CohortMember = {
  displayName: string;
  distinguisher: string;
  attending: boolean;
};

type ProposalStep = {
  stepId: string;
  name: string;
  optionLabel: string;
  place: PlaceMoney;
  likeCount: number | null;
  dislikeCount: number | null;
  alternatives: Alternative[] | null;
  mySignal: SignalValue | null;
};

type ProposalLeg = {
  fromStepId: string;
  toStepId: string;
  durationSeconds: number | null;
};

type ProposalData = {
  time: { localDate: string; localTime: string; timezone: string };
  attendingCount: number;
  cohortSize: number;
  cohort: CohortMember[];
  fairnessWarning: boolean;
  steps: ProposalStep[];
  legs: ProposalLeg[];
};

type LoadedDoc =
  | { kind: "blocked"; block: BlockFlags }
  | { kind: "proposed"; proposal: ProposalData };

export type ProposalViewProps = {
  planId: string;
};

function isPlanState(value: unknown): value is PlanState {
  return (
    value === "collecting" ||
    value === "blocked" ||
    value === "proposed" ||
    value === "locked"
  );
}

function isSignal(value: unknown): value is SignalValue {
  return value === "like" || value === "dislike" || value === "unset";
}

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

function parsePlace(value: unknown): PlaceMoney | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as {
    name?: unknown;
    amount_minor?: unknown;
    currency?: unknown;
  };
  if (typeof record.name !== "string") {
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
    name: record.name,
    amountMinor: record.amount_minor,
    currency: record.currency,
  };
}

function parseAlternative(value: unknown): Alternative | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as {
    google_place_id?: unknown;
    name?: unknown;
    amount_minor?: unknown;
    currency?: unknown;
  };
  if (typeof record.google_place_id !== "string") {
    return null;
  }
  if (typeof record.name !== "string") {
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
    googlePlaceId: record.google_place_id,
    name: record.name,
    amountMinor: record.amount_minor,
    currency: record.currency,
  };
}

function parseStep(value: unknown): ProposalStep | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as {
    step_id?: unknown;
    name?: unknown;
    option_label?: unknown;
    place?: unknown;
    like_count?: unknown;
    dislike_count?: unknown;
    alternatives?: unknown;
    my_signal?: unknown;
  };
  if (typeof record.step_id !== "string" || record.step_id.length === 0) {
    return null;
  }
  if (typeof record.name !== "string") {
    return null;
  }
  if (typeof record.option_label !== "string") {
    return null;
  }
  const place = parsePlace(record.place);
  if (!place) {
    return null;
  }

  let likeCount: number | null = null;
  let dislikeCount: number | null = null;
  let alternatives: Alternative[] | null = null;
  if (
    "like_count" in record ||
    "dislike_count" in record ||
    "alternatives" in record
  ) {
    likeCount =
      typeof record.like_count === "number" && Number.isInteger(record.like_count)
        ? record.like_count
        : 0;
    dislikeCount =
      typeof record.dislike_count === "number" &&
      Number.isInteger(record.dislike_count)
        ? record.dislike_count
        : 0;
    const parsedAlts: Alternative[] = [];
    if (Array.isArray(record.alternatives)) {
      for (const item of record.alternatives) {
        const alt = parseAlternative(item);
        if (alt) {
          parsedAlts.push(alt);
        }
        if (parsedAlts.length >= ALTERNATIVE_CAP) {
          break;
        }
      }
    }
    alternatives = parsedAlts;
  }

  let mySignal: SignalValue | null = null;
  if ("my_signal" in record) {
    mySignal = isSignal(record.my_signal) ? record.my_signal : "unset";
  }

  return {
    stepId: record.step_id,
    name: record.name,
    optionLabel: record.option_label,
    place,
    likeCount,
    dislikeCount,
    alternatives,
    mySignal,
  };
}

function parseCohortMember(value: unknown): CohortMember | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as {
    display_name?: unknown;
    distinguisher?: unknown;
    attending?: unknown;
  };
  if (typeof record.display_name !== "string") {
    return null;
  }
  if (typeof record.distinguisher !== "string") {
    return null;
  }
  if (typeof record.attending !== "boolean") {
    return null;
  }
  return {
    displayName: record.display_name,
    distinguisher: record.distinguisher,
    attending: record.attending,
  };
}

function parseLeg(value: unknown): ProposalLeg | null {
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

function parseProposal(value: unknown): ProposalData | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as {
    time?: unknown;
    attending_count?: unknown;
    cohort_size?: unknown;
    cohort?: unknown;
    fairness_warning?: unknown;
    steps?: unknown;
    legs?: unknown;
  };
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
  if (
    typeof record.attending_count !== "number" ||
    !Number.isInteger(record.attending_count)
  ) {
    return null;
  }
  if (
    typeof record.cohort_size !== "number" ||
    !Number.isInteger(record.cohort_size)
  ) {
    return null;
  }
  if (typeof record.fairness_warning !== "boolean") {
    return null;
  }
  if (!Array.isArray(record.cohort) || !Array.isArray(record.steps)) {
    return null;
  }
  const cohort: CohortMember[] = [];
  for (const item of record.cohort) {
    const member = parseCohortMember(item);
    if (!member) {
      return null;
    }
    cohort.push(member);
  }
  const steps: ProposalStep[] = [];
  for (const item of record.steps) {
    const step = parseStep(item);
    if (!step) {
      return null;
    }
    steps.push(step);
  }
  const legs: ProposalLeg[] = [];
  if (Array.isArray(record.legs)) {
    for (const item of record.legs) {
      const leg = parseLeg(item);
      if (leg) {
        legs.push(leg);
      }
    }
  }
  return {
    time: {
      localDate: time.local_date,
      localTime: time.local_time,
      timezone: time.timezone,
    },
    attendingCount: record.attending_count,
    cohortSize: record.cohort_size,
    cohort,
    fairnessWarning: record.fairness_warning,
    steps,
    legs,
  };
}

function parseBlock(value: unknown): BlockFlags | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as {
    time?: unknown;
    budget?: unknown;
    venue_data?: unknown;
  };
  if (typeof record.time !== "boolean") {
    return null;
  }
  if (typeof record.budget !== "boolean") {
    return null;
  }
  if (typeof record.venue_data !== "boolean") {
    return null;
  }
  return {
    time: record.time,
    budget: record.budget,
    venueData: record.venue_data,
  };
}

type FetchOutcome =
  | { kind: "collecting" }
  | { kind: "locked" }
  | { kind: "not_proposed" }
  | { kind: "error" }
  | { kind: "blocked"; block: BlockFlags }
  | { kind: "proposed"; proposal: ProposalData };

function parseFetchBody(status: number, body: unknown): FetchOutcome {
  const reason = parseError(body).reason;
  if (status === 409 && reason === "plan_locked") {
    return { kind: "locked" };
  }
  if (status === 409 && reason === "not_proposed") {
    return { kind: "not_proposed" };
  }
  if (status < 200 || status >= 300) {
    return { kind: "error" };
  }
  if (typeof body !== "object" || body === null) {
    return { kind: "error" };
  }
  const record = body as { state?: unknown; block?: unknown; proposal?: unknown };
  if (!isPlanState(record.state)) {
    return { kind: "error" };
  }
  if (record.state === "collecting") {
    return { kind: "collecting" };
  }
  if (record.state === "locked") {
    return { kind: "locked" };
  }
  if (record.state === "blocked") {
    const block = parseBlock(record.block);
    if (!block) {
      return { kind: "error" };
    }
    return { kind: "blocked", block };
  }
  const proposal = parseProposal(record.proposal);
  if (!proposal) {
    return { kind: "error" };
  }
  return { kind: "proposed", proposal };
}

function viewerOf(steps: readonly ProposalStep[]): Viewer {
  for (const step of steps) {
    if (step.likeCount !== null || step.alternatives !== null) {
      return "organizer";
    }
  }
  for (const step of steps) {
    if (step.mySignal !== null) {
      return "cohort";
    }
  }
  return "visitor";
}

function durationBetween(
  legs: readonly ProposalLeg[],
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

function ProposalShell({ children }: { children: ReactNode }): ReactNode {
  return (
    <main className="bg-background text-foreground">
      <Card className="border-border bg-card text-card-foreground">
        {children}
      </Card>
    </main>
  );
}

function CountsLine({
  likeCount,
  dislikeCount,
  noneLabel,
}: {
  likeCount: number;
  dislikeCount: number;
  noneLabel: string;
}): ReactNode {
  if (likeCount === 0 && dislikeCount === 0) {
    return (
      <p className="caption text-muted-foreground text-start">{noneLabel}</p>
    );
  }
  return (
    <p className="caption text-muted-foreground text-start tabular-nums">
      {likeCount} / {dislikeCount}
    </p>
  );
}

function ProposalViewBody({ planId }: ProposalViewProps): ReactNode {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("proposal");
  const tCode = useTranslations("errors.code");
  const tReason = useTranslations("errors.reason");

  const [load, setLoad] = useState<LoadState>("loading");
  const [doc, setDoc] = useState<LoadedDoc | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function chromeFor(parsed: ParsedError, fallback: string): string {
    if (parsed.reason && tReason.has(parsed.reason)) {
      return tReason(parsed.reason);
    }
    if (parsed.code && tCode.has(parsed.code)) {
      return tCode(parsed.code);
    }
    return fallback;
  }

  function applyOutcome(outcome: FetchOutcome): boolean {
    if (outcome.kind === "collecting") {
      setDoc(null);
      setLoad("redirecting");
      router.replace(`/plans/${planId}`);
      return true;
    }
    if (outcome.kind === "locked") {
      setDoc(null);
      setLoad("redirecting");
      router.replace(`/plans/${planId}/confirmed`);
      return true;
    }
    if (outcome.kind === "not_proposed") {
      setDoc(null);
      setLoad("redirecting");
      router.replace(`/plans/${planId}/respond`);
      return true;
    }
    if (outcome.kind === "error") {
      setDoc(null);
      setLoad("error");
      return false;
    }
    if (outcome.kind === "blocked") {
      setDoc({ kind: "blocked", block: outcome.block });
      setLoad("loaded");
      return true;
    }
    setDoc({ kind: "proposed", proposal: outcome.proposal });
    setLoad("loaded");
    return true;
  }

  async function loadProposal(): Promise<void> {
    setLoad("loading");
    setDoc(null);
    setFormError(null);
    try {
      const response = await fetch(`/api/v1/plans/${planId}/proposal`, {
        credentials: "same-origin",
      });
      const body = await readJson(response);
      applyOutcome(parseFetchBody(response.status, body));
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
      setFormError(null);
      try {
        const response = await fetch(`/api/v1/plans/${planId}/proposal`, {
          credentials: "same-origin",
        });
        if (cancelled) {
          return;
        }
        const body = await readJson(response);
        if (cancelled) {
          return;
        }
        applyOutcome(parseFetchBody(response.status, body));
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

  async function retryAttempt(): Promise<void> {
    setBusy(true);
    setFormError(null);
    try {
      const response = await fetch(`/api/v1/plans/${planId}/proposal-attempts`, {
        method: "POST",
        credentials: "same-origin",
        headers: WRITE_CSRF,
      });
      const body = await readJson(response);
      if (!response.ok) {
        setFormError(chromeFor(parseError(body), tCode("upstream")));
        return;
      }
      applyOutcome(parseFetchBody(response.status, body));
    } catch {
      setFormError(tCode("upstream"));
    } finally {
      setBusy(false);
    }
  }

  async function swapPlace(stepId: string, googlePlaceId: string): Promise<void> {
    setBusy(true);
    setFormError(null);
    try {
      const response = await fetch(
        `/api/v1/plans/${planId}/steps/${stepId}/swap`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: WRITE_JSON_HEADERS,
          body: JSON.stringify({ google_place_id: googlePlaceId }),
        },
      );
      const body = await readJson(response);
      if (!response.ok) {
        setFormError(chromeFor(parseError(body), tCode("upstream")));
        return;
      }
      applyOutcome(parseFetchBody(response.status, body));
    } catch {
      setFormError(tCode("upstream"));
    } finally {
      setBusy(false);
    }
  }

  async function setSignal(stepId: string, signal: SignalValue): Promise<void> {
    setBusy(true);
    setFormError(null);
    try {
      const response = await fetch(
        `/api/v1/plans/${planId}/steps/${stepId}/signal`,
        {
          method: "PUT",
          credentials: "same-origin",
          headers: WRITE_JSON_HEADERS,
          body: JSON.stringify({ signal }),
        },
      );
      const body = await readJson(response);
      if (!response.ok) {
        setFormError(chromeFor(parseError(body), tCode("upstream")));
        return;
      }
      const nextSignal =
        typeof body === "object" &&
        body !== null &&
        isSignal((body as { signal?: unknown }).signal)
          ? (body as { signal: SignalValue }).signal
          : signal;
      setDoc((current) => {
        if (!current || current.kind !== "proposed") {
          return current;
        }
        return {
          kind: "proposed",
          proposal: {
            ...current.proposal,
            steps: current.proposal.steps.map((step) =>
              step.stepId === stepId ? { ...step, mySignal: nextSignal } : step,
            ),
          },
        };
      });
    } catch {
      setFormError(tCode("upstream"));
    } finally {
      setBusy(false);
    }
  }

  async function lockOuting(): Promise<void> {
    setBusy(true);
    setFormError(null);
    try {
      const response = await fetch(`/api/v1/plans/${planId}/lock`, {
        method: "POST",
        credentials: "same-origin",
        headers: WRITE_CSRF,
      });
      const body = await readJson(response);
      if (response.ok || parseError(body).reason === "plan_locked") {
        setDoc(null);
        setLoad("redirecting");
        router.replace(`/plans/${planId}/confirmed`);
        return;
      }
      setFormError(chromeFor(parseError(body), tCode("upstream")));
    } catch {
      setFormError(tCode("upstream"));
    } finally {
      setBusy(false);
    }
  }

  if (load === "error") {
    return (
      <ProposalShell>
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
            onClick={() => void loadProposal()}
          >
            {t("retry")}
          </Button>
        </CardContent>
      </ProposalShell>
    );
  }

  if (load !== "loaded" || !doc) {
    return (
      <ProposalShell>
        <CardHeader>
          <h1 className="title text-foreground text-start text-pretty">
            {t("title")}
          </h1>
        </CardHeader>
      </ProposalShell>
    );
  }

  if (doc.kind === "blocked") {
    return (
      <ProposalShell>
        <CardHeader>
          <h1 className="title text-foreground text-start text-pretty">
            {t("title")}
          </h1>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {formError ? (
            <p className="text-destructive text-start" role="alert">
              {formError}
            </p>
          ) : null}
          {doc.block.time ? (
            <p className="body text-destructive text-start text-pretty" role="alert">
              {t("timeBlocked")}
            </p>
          ) : null}
          {doc.block.budget ? (
            <p className="body text-destructive text-start text-pretty" role="alert">
              {t("budgetBlocked")}
            </p>
          ) : null}
          {doc.block.venueData ? (
            <p className="body text-destructive text-start text-pretty" role="alert">
              {t("venueData")}
            </p>
          ) : null}
          {doc.block.venueData ? (
            <Button
              type="button"
              variant="secondary"
              className="self-start"
              disabled={busy}
              onClick={() => void retryAttempt()}
            >
              {t("retry")}
            </Button>
          ) : null}
          <p className="caption text-muted-foreground text-start text-pretty">
            {t("attribution")}
          </p>
        </CardContent>
      </ProposalShell>
    );
  }

  const proposal = doc.proposal;
  const viewer = viewerOf(proposal.steps);
  const colliding = collidingNameKeys(proposal.cohort);
  const everyone = proposal.attendingCount === proposal.cohortSize;
  const timeLabel = `${proposal.time.localDate} ${toHm(proposal.time.localTime)} ${proposal.time.timezone}`;

  return (
    <ProposalShell>
      <CardHeader className="gap-3">
        <h1 className="title text-foreground text-start text-pretty">
          {t("title")}
        </h1>
        <p className="body text-foreground text-start">{timeLabel}</p>
        <p className="body text-foreground text-start text-pretty">
          {everyone
            ? t("attendingEveryone")
            : t("attendingSome", {
                count: proposal.attendingCount,
                size: proposal.cohortSize,
              })}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {formError ? (
          <p className="text-destructive text-start" role="alert">
            {formError}
          </p>
        ) : null}

        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {proposal.cohort.map((member, index) => {
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

        {proposal.fairnessWarning ? (
          <p className="body text-warning text-start text-pretty">
            {t("fairness")}
          </p>
        ) : null}

        <ol className="m-0 flex list-none flex-col gap-6 p-0">
          {proposal.steps.map((step, index) => {
            const next = proposal.steps[index + 1];
            const travel =
              next === undefined
                ? null
                : formatTravelDuration(
                    durationBetween(proposal.legs, step.stepId, next.stepId),
                  );
            const money = formatMoney(
              step.place.amountMinor,
              step.place.currency,
              locale,
            );
            const alts = step.alternatives;
            return (
              <li key={step.stepId} className="flex flex-col items-start gap-3">
                <h2 className="section text-foreground text-start text-pretty">
                  {step.name}
                </h2>
                <p className="body text-foreground text-start text-pretty">
                  {step.optionLabel}
                </p>
                <p className="body text-foreground text-start text-pretty">
                  {step.place.name}
                </p>
                <p className="body text-foreground text-start tabular-nums">
                  {money}
                </p>
                {viewer === "organizer" &&
                step.likeCount !== null &&
                step.dislikeCount !== null ? (
                  <CountsLine
                    likeCount={step.likeCount}
                    dislikeCount={step.dislikeCount}
                    noneLabel={t("likesNone")}
                  />
                ) : null}
                {viewer === "organizer" && alts !== null ? (
                  alts.length === 0 ? (
                    <p className="caption text-muted-foreground text-start">
                      {t("noAlternative")}
                    </p>
                  ) : (
                    <ul className="m-0 flex list-none flex-col gap-3 p-0">
                      {alts.map((alt) => (
                        <li
                          key={alt.googlePlaceId}
                          className="flex flex-col items-start gap-2"
                        >
                          <p className="body text-foreground text-start text-pretty">
                            {alt.name}
                          </p>
                          <p className="caption text-muted-foreground text-start tabular-nums">
                            {formatMoney(alt.amountMinor, alt.currency, locale)}
                          </p>
                          <Button
                            type="button"
                            variant="secondary"
                            className="self-start"
                            disabled={busy}
                            onClick={() =>
                              void swapPlace(step.stepId, alt.googlePlaceId)
                            }
                          >
                            {t("swap")}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )
                ) : null}
                {viewer === "cohort" && step.mySignal !== null ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      aria-pressed={step.mySignal === "like"}
                      disabled={busy}
                      onClick={() => void setSignal(step.stepId, "like")}
                    >
                      {t("like")}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      aria-pressed={step.mySignal === "dislike"}
                      disabled={busy}
                      onClick={() => void setSignal(step.stepId, "dislike")}
                    >
                      {t("dislike")}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      aria-pressed={step.mySignal === "unset"}
                      disabled={busy}
                      onClick={() => void setSignal(step.stepId, "unset")}
                    >
                      {t("unset")}
                    </Button>
                  </div>
                ) : null}
                {next !== undefined ? (
                  <p className="caption text-muted-foreground text-start">
                    {travel ?? ""}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>

        {viewer === "organizer" ? (
          <Button
            type="button"
            className="self-start bg-primary"
            disabled={busy}
            onClick={() => void lockOuting()}
          >
            {t("lock")}
          </Button>
        ) : null}

        <p className="caption text-muted-foreground text-start text-pretty">
          {t("attribution")}
        </p>
      </CardContent>
    </ProposalShell>
  );
}

export function ProposalView({ planId }: ProposalViewProps): ReactNode {
  return (
    <LanguageControl>
      <ProposalViewBody planId={planId} />
    </LanguageControl>
  );
}
