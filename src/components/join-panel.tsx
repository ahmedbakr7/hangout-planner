"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import React, {
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { LanguageControl } from "@/components/language-control";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const DISPLAY_NAME_MAX = 40;
const BUDGET_EXPONENT = 2;

const OPENING_NEXTS = [
  "organizer",
  "respond",
  "proposal",
  "confirmed",
  "join",
] as const;

type OpeningNext = (typeof OPENING_NEXTS)[number];
type ParticipantNext = "respond" | "proposal" | "confirmed";
type SessionState = "checking" | "signed_out" | "signed_in";
type LoadState = "loading" | "loaded" | "unknown" | "error" | "redirecting";

type FieldError = {
  path: string;
  code: string;
};

type ParsedError = {
  code?: string;
  reason?: string;
  fields: FieldError[];
};

type PreviewWindow = {
  localDate: string;
  startLocal: string;
  endLocal: string;
};

type JoinPreview = {
  title: string;
  organizerDisplayName: string;
  timezone: string;
  windows: PreviewWindow[];
  budget: { amountMinor: number; currency: string };
  stepNames: string[];
};

type Opening = {
  planId: string;
  next: OpeningNext;
  preview: JoinPreview | null;
};

export type JoinPanelProps = {
  token?: string;
  planId?: string;
};

function isOpeningNext(value: unknown): value is OpeningNext {
  return (
    value === "organizer" ||
    value === "respond" ||
    value === "proposal" ||
    value === "confirmed" ||
    value === "join"
  );
}

function isParticipantNext(value: unknown): value is ParticipantNext {
  return value === "respond" || value === "proposal" || value === "confirmed";
}

function parseError(body: unknown): ParsedError {
  if (typeof body !== "object" || body === null) {
    return { fields: [] };
  }
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) {
    return { fields: [] };
  }
  const record = error as {
    code?: unknown;
    reason?: unknown;
    fields?: unknown;
  };
  const fields: FieldError[] = [];
  if (Array.isArray(record.fields)) {
    for (const field of record.fields) {
      if (typeof field !== "object" || field === null) {
        continue;
      }
      const path = (field as { path?: unknown }).path;
      const code = (field as { code?: unknown }).code;
      if (typeof path === "string" && typeof code === "string") {
        fields.push({ path, code });
      }
    }
  }
  return {
    code: typeof record.code === "string" ? record.code : undefined,
    reason: typeof record.reason === "string" ? record.reason : undefined,
    fields,
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function parseWindows(value: unknown): PreviewWindow[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const windows: PreviewWindow[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      return null;
    }
    const record = item as {
      local_date?: unknown;
      start_local?: unknown;
      end_local?: unknown;
    };
    if (typeof record.local_date !== "string") {
      return null;
    }
    if (typeof record.start_local !== "string") {
      return null;
    }
    if (typeof record.end_local !== "string") {
      return null;
    }
    windows.push({
      localDate: record.local_date,
      startLocal: record.start_local,
      endLocal: record.end_local,
    });
  }
  return windows;
}

function parseBudget(
  value: unknown,
): { amountMinor: number; currency: string } | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as { amount_minor?: unknown; currency?: unknown };
  if (
    typeof record.amount_minor !== "number" ||
    !Number.isInteger(record.amount_minor)
  ) {
    return null;
  }
  if (typeof record.currency !== "string" || record.currency.length === 0) {
    return null;
  }
  return { amountMinor: record.amount_minor, currency: record.currency };
}

function parseStepNames(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const names: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      return null;
    }
    names.push(item);
  }
  return names;
}

function parsePreview(value: unknown): JoinPreview | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as {
    title?: unknown;
    organizer_display_name?: unknown;
    timezone?: unknown;
    windows?: unknown;
    budget?: unknown;
    step_names?: unknown;
  };
  if (typeof record.title !== "string") {
    return null;
  }
  if (typeof record.organizer_display_name !== "string") {
    return null;
  }
  if (typeof record.timezone !== "string") {
    return null;
  }
  const windows = parseWindows(record.windows);
  if (!windows) {
    return null;
  }
  const budget = parseBudget(record.budget);
  if (!budget) {
    return null;
  }
  const stepNames = parseStepNames(record.step_names);
  if (!stepNames) {
    return null;
  }
  return {
    title: record.title,
    organizerDisplayName: record.organizer_display_name,
    timezone: record.timezone,
    windows,
    budget,
    stepNames,
  };
}

function parseOpening(value: unknown): Opening | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as {
    plan_id?: unknown;
    next?: unknown;
    preview?: unknown;
  };
  if (typeof record.plan_id !== "string" || record.plan_id.length === 0) {
    return null;
  }
  if (!isOpeningNext(record.next)) {
    return null;
  }
  const preview =
    record.next === "join" ? parsePreview(record.preview) : null;
  if (record.next === "join" && !preview) {
    return null;
  }
  return {
    planId: record.plan_id,
    next: record.next,
    preview,
  };
}

function parseJoinResult(
  value: unknown,
): { next: ParticipantNext } | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const next = (value as { next?: unknown }).next;
  if (!isParticipantNext(next)) {
    return null;
  }
  return { next };
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
  if (next === "confirmed") {
    return `/plans/${planId}/confirmed`;
  }
  return null;
}

function hrefForParticipant(planId: string, next: ParticipantNext): string {
  if (next === "respond") {
    return `/plans/${planId}/respond`;
  }
  if (next === "proposal") {
    return `/plans/${planId}/proposal`;
  }
  return `/plans/${planId}/confirmed`;
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

function formatBudget(
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

function accountNextPath(token: string | undefined): string {
  if (typeof token === "string" && token.length > 0) {
    return `/join/${token}`;
  }
  return "/invitations";
}

function JoinShell({ children }: { children: ReactNode }): ReactNode {
  return (
    <main className="bg-background text-foreground">
      <Card className="border-border bg-card text-card-foreground">
        {children}
      </Card>
    </main>
  );
}

function FieldBlock({
  id,
  label,
  errorId,
  error,
  children,
}: {
  id: string;
  label: string;
  errorId: string;
  error: string | null;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={errorId} className="text-sm text-destructive text-start">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function JoinPanelBody({ token, planId }: JoinPanelProps): ReactNode {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("join");
  const tCommon = useTranslations("common");
  const tReason = useTranslations("errors.reason");
  const tCode = useTranslations("errors.code");
  const tFields = useTranslations("errors.fields");

  const [session, setSession] = useState<SessionState>("checking");
  const [load, setLoad] = useState<LoadState>("loading");
  const [preview, setPreview] = useState<JoinPreview | null>(null);
  const [resolvedPlanId, setResolvedPlanId] = useState<string | null>(
    planId ?? null,
  );
  const [displayName, setDisplayName] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const openingPath =
    typeof token === "string" && token.length > 0
      ? `/api/v1/join/${token}`
      : `/api/v1/plans/${planId}/opening`;
  const joinPath =
    typeof token === "string" && token.length > 0
      ? `/api/v1/join/${token}`
      : `/api/v1/plans/${planId}/join`;
  const accountHref = `/account?next=${accountNextPath(token)}`;

  async function loadOpening(): Promise<void> {
    setLoad("loading");
    setPreview(null);
    setFormError(null);
    setFieldErrors([]);
    try {
      const [openingResponse, meResponse] = await Promise.all([
        fetch(openingPath, { credentials: "same-origin" }),
        fetch("/api/v1/me", { credentials: "same-origin" }),
      ]);
      setSession(meResponse.ok ? "signed_in" : "signed_out");
      if (openingResponse.status === 404) {
        setLoad("unknown");
        setPreview(null);
        return;
      }
      if (!openingResponse.ok) {
        setLoad("error");
        setPreview(null);
        return;
      }
      const body = await readJson(openingResponse);
      const parsed = parseOpening(body);
      if (!parsed) {
        setLoad("error");
        setPreview(null);
        return;
      }
      if (parsed.next !== "join") {
        const href = hrefForOpening(parsed.planId, parsed.next);
        if (href) {
          setLoad("redirecting");
          setPreview(null);
          router.replace(href);
          return;
        }
        setLoad("error");
        setPreview(null);
        return;
      }
      setResolvedPlanId(parsed.planId);
      setPreview(parsed.preview);
      setLoad("loaded");
    } catch {
      setSession("signed_out");
      setLoad("error");
      setPreview(null);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function start(): Promise<void> {
      setLoad("loading");
      setPreview(null);
      setFormError(null);
      setFieldErrors([]);
      try {
        const [openingResponse, meResponse] = await Promise.all([
          fetch(openingPath, { credentials: "same-origin" }),
          fetch("/api/v1/me", { credentials: "same-origin" }),
        ]);
        if (cancelled) {
          return;
        }
        setSession(meResponse.ok ? "signed_in" : "signed_out");
        if (openingResponse.status === 404) {
          setLoad("unknown");
          setPreview(null);
          return;
        }
        if (!openingResponse.ok) {
          setLoad("error");
          setPreview(null);
          return;
        }
        const body = await readJson(openingResponse);
        if (cancelled) {
          return;
        }
        const parsed = parseOpening(body);
        if (!parsed) {
          setLoad("error");
          setPreview(null);
          return;
        }
        if (parsed.next !== "join") {
          const href = hrefForOpening(parsed.planId, parsed.next);
          if (href) {
            setLoad("redirecting");
            setPreview(null);
            router.replace(href);
            return;
          }
          setLoad("error");
          setPreview(null);
          return;
        }
        setResolvedPlanId(parsed.planId);
        setPreview(parsed.preview);
        setLoad("loaded");
      } catch {
        if (!cancelled) {
          setSession("signed_out");
          setLoad("error");
          setPreview(null);
        }
      }
    }

    void start();
    return () => {
      cancelled = true;
    };
  }, [openingPath, router]);

  function fieldCode(path: string): string | undefined {
    return fieldErrors.find((field) => field.path === path)?.code;
  }

  function fieldMessage(path: string): string | null {
    const code = fieldCode(path);
    if (!code) {
      return null;
    }
    if (path === "display_name" && code === "required") {
      return t("nameRequired");
    }
    if (tFields.has(code)) {
      return tFields(code);
    }
    return tFields("unknown");
  }

  function chromeFor(parsed: ParsedError, fallback: string): string {
    if (parsed.reason && tReason.has(parsed.reason)) {
      return tReason(parsed.reason);
    }
    if (parsed.code && tCode.has(parsed.code)) {
      return tCode(parsed.code);
    }
    return fallback;
  }

  async function postJoin(body: Record<string, unknown>): Promise<void> {
    setSubmitting(true);
    setFormError(null);
    try {
      const response = await fetch(joinPath, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-HP-Request": "1",
        },
        body: JSON.stringify(body),
      });
      const payload = await readJson(response);
      if (response.ok) {
        const result = parseJoinResult(payload);
        const targetPlanId = resolvedPlanId ?? planId;
        if (result && targetPlanId) {
          router.push(hrefForParticipant(targetPlanId, result.next));
          return;
        }
        setFormError(t("joinFailed"));
        setSubmitting(false);
        return;
      }
      const parsed = parseError(payload);
      setFieldErrors(parsed.fields);
      setFormError(chromeFor(parsed, t("joinFailed")));
    } catch {
      setFormError(t("joinFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function onJoinWithAccount(): Promise<void> {
    setFieldErrors([]);
    await postJoin({ kind: "account" });
  }

  async function onJoinWithoutAccount(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const trimmed = displayName.trim();
    if (trimmed.length === 0) {
      setFormError(null);
      setFieldErrors([{ path: "display_name", code: "required" }]);
      return;
    }
    if (trimmed.length > DISPLAY_NAME_MAX) {
      setFormError(null);
      setFieldErrors([{ path: "display_name", code: "too_long" }]);
      return;
    }
    setFieldErrors([]);
    await postJoin({ kind: "anonymous", display_name: trimmed });
  }

  const nameError = fieldMessage("display_name");

  if (load === "unknown") {
    return (
      <JoinShell>
        <CardHeader>
          <h1 className="title text-foreground text-start text-pretty">
            {t("title")}
          </h1>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-destructive text-start" role="alert">
            {t("unknownLink")}
          </p>
          <Button
            type="button"
            variant="secondary"
            className="self-start"
            onClick={() => void loadOpening()}
          >
            {tCommon("retry")}
          </Button>
        </CardContent>
      </JoinShell>
    );
  }

  if (load === "error") {
    return (
      <JoinShell>
        <CardHeader>
          <h1 className="title text-foreground text-start text-pretty">
            {t("title")}
          </h1>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-destructive text-start" role="alert">
            {t("joinFailed")}
          </p>
          <Button
            type="button"
            variant="secondary"
            className="self-start"
            onClick={() => void loadOpening()}
          >
            {tCommon("retry")}
          </Button>
        </CardContent>
      </JoinShell>
    );
  }

  if (load !== "loaded" || !preview) {
    return (
      <JoinShell>
        <CardHeader>
          <h1 className="title text-foreground text-start text-pretty">
            {t("title")}
          </h1>
        </CardHeader>
      </JoinShell>
    );
  }

  const budgetLabel = formatBudget(
    preview.budget.amountMinor,
    preview.budget.currency,
    locale,
  );

  return (
    <JoinShell>
      <CardHeader className="gap-3">
        <h1 className="title text-foreground text-start text-pretty">
          {preview.title}
        </h1>
        <p className="body text-foreground text-start text-pretty">
          {t("organizer", { name: preview.organizerDisplayName })}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <section className="flex flex-col gap-2">
          <h2 className="section text-foreground text-start">{t("timezone")}</h2>
          <p className="body text-foreground text-start">{preview.timezone}</p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="section text-foreground text-start">{t("windows")}</h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {preview.windows.map((window) => (
              <li
                key={`${window.localDate}-${window.startLocal}-${window.endLocal}`}
                className="body text-foreground text-start tabular-nums"
              >
                {window.localDate} {window.startLocal}-{window.endLocal}
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="section text-foreground text-start">{t("budget")}</h2>
          <p className="body text-foreground text-start tabular-nums">
            {budgetLabel}
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="section text-foreground text-start">{t("steps")}</h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {preview.stepNames.map((name) => (
              <li key={name} className="body text-foreground text-start">
                {name}
              </li>
            ))}
          </ul>
        </section>

        {formError ? (
          <p className="text-destructive text-start" role="alert">
            {formError}
          </p>
        ) : null}

        {session === "signed_in" ? (
          <Button
            type="button"
            disabled={submitting}
            className="self-start bg-primary"
            onClick={() => void onJoinWithAccount()}
          >
            {t("joinWithAccount")}
          </Button>
        ) : (
          <Button asChild className="self-start bg-primary">
            <a href={accountHref}>{t("joinWithAccount")}</a>
          </Button>
        )}

        <form
          onSubmit={onJoinWithoutAccount}
          className="flex flex-col gap-4"
          noValidate
        >
          <FieldBlock
            id="hp-join-display-name"
            label={t("displayName")}
            errorId="hp-join-display-name-error"
            error={nameError}
          >
            <Input
              id="hp-join-display-name"
              name="display_name"
              type="text"
              autoComplete="nickname"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={
                nameError ? "hp-join-display-name-error" : undefined
              }
            />
          </FieldBlock>
          <Button
            type="submit"
            variant="secondary"
            disabled={submitting}
            className="self-start"
          >
            {t("joinWithoutAccount")}
          </Button>
        </form>
      </CardContent>
    </JoinShell>
  );
}

export function JoinPanel(props: JoinPanelProps): ReactNode {
  return (
    <LanguageControl>
      <JoinPanelBody token={props.token} planId={props.planId} />
    </LanguageControl>
  );
}
