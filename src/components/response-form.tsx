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

const BUDGET_EXPONENT = 2;
const PLACE_SEARCH_Q_MIN = 1;
const PLACE_SEARCH_Q_MAX = 80;

type PlanState = "collecting" | "blocked" | "proposed" | "locked";
type LoadState = "loading" | "loaded" | "error" | "redirecting";
type WindowKind = "busy" | "free";

type FieldError = {
  path: string;
  code: string;
};

type ParsedError = {
  code?: string;
  reason?: string;
  fields: FieldError[];
};

type PlanWindow = {
  id: string;
  localDate: string;
  startLocal: string;
  endLocal: string;
};

type PlanOption = {
  id: string;
  label: string;
};

type PlanStep = {
  id: string;
  name: string;
  options: PlanOption[];
};

type WindowAnswer = {
  kind: WindowKind | "";
  earliestLocal: string;
  latestLocal: string;
};

type PlaceHit = {
  googlePlaceId: string;
  name: string;
};

type ResponsePlan = {
  title: string | null;
  planState: PlanState;
  timezone: string;
  budget: { amountMinor: number; currency: string };
  windows: PlanWindow[];
  steps: PlanStep[];
  complete: boolean;
};

export type ResponseFormProps = {
  planId: string;
};

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

function isPlanState(value: unknown): value is PlanState {
  return (
    value === "collecting" ||
    value === "blocked" ||
    value === "proposed" ||
    value === "locked"
  );
}

function closedHref(planId: string, reason: string | undefined): string | null {
  if (reason === "responses_closed") {
    return `/plans/${planId}/proposal`;
  }
  if (reason === "plan_locked") {
    return `/plans/${planId}/confirmed`;
  }
  return null;
}

function parseLocalMinutes(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(value);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
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

function parseWindows(value: unknown): PlanWindow[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const windows: PlanWindow[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      return null;
    }
    const record = item as {
      id?: unknown;
      local_date?: unknown;
      start_local?: unknown;
      end_local?: unknown;
    };
    if (typeof record.id !== "string" || record.id.length === 0) {
      return null;
    }
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
      id: record.id,
      localDate: record.local_date,
      startLocal: record.start_local,
      endLocal: record.end_local,
    });
  }
  return windows;
}

function parseOptions(value: unknown): PlanOption[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const options: PlanOption[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      return null;
    }
    const record = item as { id?: unknown; label?: unknown };
    if (typeof record.id !== "string" || record.id.length === 0) {
      return null;
    }
    if (typeof record.label !== "string") {
      return null;
    }
    options.push({ id: record.id, label: record.label });
  }
  return options;
}

function parseSteps(value: unknown): PlanStep[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const steps: PlanStep[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      return null;
    }
    const record = item as { id?: unknown; name?: unknown; options?: unknown };
    if (typeof record.id !== "string" || record.id.length === 0) {
      return null;
    }
    if (typeof record.name !== "string") {
      return null;
    }
    const options = parseOptions(record.options);
    if (!options) {
      return null;
    }
    steps.push({ id: record.id, name: record.name, options });
  }
  return steps;
}

function emptyAnswers(windows: readonly PlanWindow[]): Record<string, WindowAnswer> {
  const answers: Record<string, WindowAnswer> = {};
  for (const window of windows) {
    answers[window.id] = { kind: "", earliestLocal: "", latestLocal: "" };
  }
  return answers;
}

function applySavedWindows(
  windows: readonly PlanWindow[],
  saved: unknown,
): Record<string, WindowAnswer> {
  const answers = emptyAnswers(windows);
  if (!Array.isArray(saved)) {
    return answers;
  }
  for (const item of saved) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const record = item as {
      window_id?: unknown;
      kind?: unknown;
      earliest_local?: unknown;
      latest_local?: unknown;
    };
    if (typeof record.window_id !== "string") {
      continue;
    }
    const current = answers[record.window_id];
    if (!current) {
      continue;
    }
    if (record.kind === "busy") {
      answers[record.window_id] = {
        kind: "busy",
        earliestLocal: "",
        latestLocal: "",
      };
      continue;
    }
    if (record.kind === "free") {
      answers[record.window_id] = {
        kind: "free",
        earliestLocal:
          typeof record.earliest_local === "string" ? record.earliest_local : "",
        latestLocal:
          typeof record.latest_local === "string" ? record.latest_local : "",
      };
    }
  }
  return answers;
}

function applySavedPicks(steps: readonly PlanStep[], saved: unknown): Record<string, string> {
  const picks: Record<string, string> = {};
  const optionByStep = new Map<string, Set<string>>();
  for (const step of steps) {
    optionByStep.set(step.id, new Set(step.options.map((option) => option.id)));
  }
  if (!Array.isArray(saved)) {
    return picks;
  }
  for (const item of saved) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const record = item as { step_id?: unknown; option_id?: unknown };
    if (typeof record.step_id !== "string" || typeof record.option_id !== "string") {
      continue;
    }
    const allowed = optionByStep.get(record.step_id);
    if (!allowed || !allowed.has(record.option_id)) {
      continue;
    }
    picks[record.step_id] = record.option_id;
  }
  return picks;
}

function parseStartName(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "object") {
    return null;
  }
  const name = (value as { name?: unknown }).name;
  if (typeof name !== "string" || name.length === 0) {
    return null;
  }
  return name;
}

function parseResponseDocument(value: unknown): {
  plan: ResponsePlan;
  answers: Record<string, WindowAnswer>;
  picks: Record<string, string>;
  startName: string | null;
} | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as {
    title?: unknown;
    plan_state?: unknown;
    timezone?: unknown;
    budget?: unknown;
    windows?: unknown;
    steps?: unknown;
    response?: unknown;
  };
  if (!isPlanState(record.plan_state)) {
    return null;
  }
  if (typeof record.timezone !== "string" || record.timezone.length === 0) {
    return null;
  }
  const budget = parseBudget(record.budget);
  if (!budget) {
    return null;
  }
  const windows = parseWindows(record.windows);
  if (!windows) {
    return null;
  }
  const steps = parseSteps(record.steps);
  if (!steps) {
    return null;
  }
  if (typeof record.response !== "object" || record.response === null) {
    return null;
  }
  const response = record.response as {
    complete?: unknown;
    windows?: unknown;
    start?: unknown;
    picks?: unknown;
  };
  return {
    plan: {
      title: typeof record.title === "string" ? record.title : null,
      planState: record.plan_state,
      timezone: record.timezone,
      budget,
      windows,
      steps,
      complete: response.complete === true,
    },
    answers: applySavedWindows(windows, response.windows),
    picks: applySavedPicks(steps, response.picks),
    startName: parseStartName(response.start),
  };
}

function parsePlaceResults(value: unknown): PlaceHit[] | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const list = (value as { results?: unknown }).results;
  if (!Array.isArray(list)) {
    return null;
  }
  const results: PlaceHit[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const record = item as { google_place_id?: unknown; name?: unknown };
    if (typeof record.google_place_id !== "string" || record.google_place_id.length === 0) {
      continue;
    }
    if (typeof record.name !== "string" || record.name.length === 0) {
      continue;
    }
    results.push({ googlePlaceId: record.google_place_id, name: record.name });
    if (results.length === 5) {
      break;
    }
  }
  return results;
}

function parseSaveResult(
  value: unknown,
): { complete: boolean; planState: PlanState | null } | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as { complete?: unknown; plan_state?: unknown };
  if (typeof record.complete !== "boolean") {
    return null;
  }
  return {
    complete: record.complete,
    planState: isPlanState(record.plan_state) ? record.plan_state : null,
  };
}

function FormShell({ children }: { children: ReactNode }): ReactNode {
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

function ResponseFormBody({ planId }: ResponseFormProps): ReactNode {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("respond");
  const tCommon = useTranslations("common");
  const tReason = useTranslations("errors.reason");
  const tCode = useTranslations("errors.code");
  const tFields = useTranslations("errors.fields");

  const [load, setLoad] = useState<LoadState>("loading");
  const [plan, setPlan] = useState<ResponsePlan | null>(null);
  const [answers, setAnswers] = useState<Record<string, WindowAnswer>>({});
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [startName, setStartName] = useState<string | null>(null);
  const [startPlaceId, setStartPlaceId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PlaceHit[]>([]);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<ParsedError | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<"incomplete" | "complete" | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [searching, setSearching] = useState(false);

  function chromeFor(parsed: ParsedError, fallback: string): string {
    if (parsed.reason && tReason.has(parsed.reason)) {
      return tReason(parsed.reason);
    }
    if (parsed.code && tCode.has(parsed.code)) {
      return tCode(parsed.code);
    }
    return fallback;
  }

  function fieldCode(path: string): string | undefined {
    return fieldErrors.find((field) => field.path === path)?.code;
  }

  function fieldMessage(path: string): string | null {
    const code = fieldCode(path);
    if (!code) {
      return null;
    }
    if (tFields.has(code)) {
      return tFields(code);
    }
    return tFields("unknown");
  }

  function clearPlan(): void {
    setPlan(null);
    setAnswers({});
    setPicks({});
    setStartName(null);
    setStartPlaceId(null);
    setSearchResults([]);
  }

  function leaveClosed(reason: string | undefined): boolean {
    const href = closedHref(planId, reason);
    if (!href) {
      return false;
    }
    clearPlan();
    setFormError(null);
    setOpenError(null);
    setSearchError(null);
    setFieldErrors([]);
    setSaveNotice(null);
    setLoad("redirecting");
    router.replace(href);
    return true;
  }

  async function loadResponse(): Promise<void> {
    setLoad("loading");
    clearPlan();
    setFormError(null);
    setOpenError(null);
    setSearchError(null);
    setFieldErrors([]);
    setSaveNotice(null);
    try {
      const response = await fetch(`/v1/plans/${planId}/response`, {
        credentials: "same-origin",
      });
      const body = await readJson(response);
      if (response.status === 409) {
        if (leaveClosed(parseError(body).reason)) {
          return;
        }
        clearPlan();
        setLoad("error");
        setOpenError(parseError(body));
        return;
      }
      if (!response.ok) {
        clearPlan();
        setLoad("error");
        setOpenError(parseError(body));
        return;
      }
      const parsed = parseResponseDocument(body);
      if (!parsed) {
        clearPlan();
        setLoad("error");
        setOpenError({ fields: [] });
        return;
      }
      if (parsed.plan.planState === "proposed") {
        leaveClosed("responses_closed");
        return;
      }
      if (parsed.plan.planState === "locked") {
        leaveClosed("plan_locked");
        return;
      }
      setPlan(parsed.plan);
      setAnswers(parsed.answers);
      setPicks(parsed.picks);
      setStartName(parsed.startName);
      setStartPlaceId(null);
      setSearchQuery("");
      setSearchResults([]);
      setSaveNotice(parsed.plan.complete ? "complete" : null);
      setLoad("loaded");
    } catch {
      clearPlan();
      setLoad("error");
      setOpenError({ fields: [] });
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function start(): Promise<void> {
      setLoad("loading");
      setPlan(null);
      setAnswers({});
      setPicks({});
      setStartName(null);
      setStartPlaceId(null);
      setSearchResults([]);
      setFormError(null);
      setOpenError(null);
      setSearchError(null);
      setFieldErrors([]);
      setSaveNotice(null);
      try {
        const response = await fetch(`/v1/plans/${planId}/response`, {
          credentials: "same-origin",
        });
        if (cancelled) {
          return;
        }
        const body = await readJson(response);
        if (cancelled) {
          return;
        }
        if (response.status === 409) {
          const href = closedHref(planId, parseError(body).reason);
          if (href) {
            setPlan(null);
            setLoad("redirecting");
            router.replace(href);
            return;
          }
          setPlan(null);
          setLoad("error");
          setOpenError(parseError(body));
          return;
        }
        if (!response.ok) {
          setPlan(null);
          setLoad("error");
          setOpenError(parseError(body));
          return;
        }
        const parsed = parseResponseDocument(body);
        if (!parsed) {
          setPlan(null);
          setLoad("error");
          setOpenError({ fields: [] });
          return;
        }
        if (parsed.plan.planState === "proposed") {
          setPlan(null);
          setLoad("redirecting");
          router.replace(`/plans/${planId}/proposal`);
          return;
        }
        if (parsed.plan.planState === "locked") {
          setPlan(null);
          setLoad("redirecting");
          router.replace(`/plans/${planId}/confirmed`);
          return;
        }
        setPlan(parsed.plan);
        setAnswers(parsed.answers);
        setPicks(parsed.picks);
        setStartName(parsed.startName);
        setStartPlaceId(null);
        setSearchQuery("");
        setSearchResults([]);
        setSaveNotice(parsed.plan.complete ? "complete" : null);
        setLoad("loaded");
      } catch {
        if (!cancelled) {
          setPlan(null);
          setLoad("error");
          setOpenError({ fields: [] });
        }
      }
    }

    void start();
    return () => {
      cancelled = true;
    };
  }, [planId, router]);

  function updateAnswer(windowId: string, patch: Partial<WindowAnswer>): void {
    setAnswers((current) => {
      const previous = current[windowId] ?? {
        kind: "",
        earliestLocal: "",
        latestLocal: "",
      };
      return { ...current, [windowId]: { ...previous, ...patch } };
    });
  }

  function validateWindow(
    window: PlanWindow,
    answer: WindowAnswer,
    index: number,
  ): { fields: FieldError[]; body: Record<string, unknown> | null } {
    const path = `windows[${index}]`;
    const fields: FieldError[] = [];
    if (answer.kind !== "busy" && answer.kind !== "free") {
      fields.push({ path: `${path}.kind`, code: "required" });
      return { fields, body: null };
    }
    if (answer.kind === "busy") {
      return { fields, body: { window_id: window.id, kind: "busy" } };
    }

    const earliestHm = toHm(answer.earliestLocal.trim());
    const latestHm = toHm(answer.latestLocal.trim());
    let earliestMinutes: number | null = null;
    let latestMinutes: number | null = null;
    if (earliestHm.length === 0) {
      fields.push({ path: `${path}.earliest_local`, code: "required" });
    } else {
      earliestMinutes = parseLocalMinutes(earliestHm);
      if (earliestMinutes === null) {
        fields.push({ path: `${path}.earliest_local`, code: "bad_time" });
      }
    }
    if (latestHm.length === 0) {
      fields.push({ path: `${path}.latest_local`, code: "required" });
    } else {
      latestMinutes = parseLocalMinutes(latestHm);
      if (latestMinutes === null) {
        fields.push({ path: `${path}.latest_local`, code: "bad_time" });
      }
    }
    const windowStart = parseLocalMinutes(toHm(window.startLocal));
    const windowEnd = parseLocalMinutes(toHm(window.endLocal));
    if (earliestMinutes !== null && latestMinutes !== null) {
      if (latestMinutes <= earliestMinutes) {
        fields.push({ path: `${path}.latest_local`, code: "end_before_start" });
      }
      if (
        windowStart !== null &&
        windowEnd !== null &&
        (earliestMinutes < windowStart || latestMinutes > windowEnd)
      ) {
        fields.push({
          path:
            earliestMinutes < windowStart
              ? `${path}.earliest_local`
              : `${path}.latest_local`,
          code: "outside_window",
        });
      }
    }
    if (fields.length > 0) {
      return { fields, body: null };
    }
    return {
      fields,
      body: {
        window_id: window.id,
        kind: "free",
        earliest_local: earliestHm,
        latest_local: latestHm,
      },
    };
  }

  async function onSearch(): Promise<void> {
    const q = searchQuery.trim();
    setSearchError(null);
    if (q.length < PLACE_SEARCH_Q_MIN) {
      setFieldErrors((current) => {
        const next = current.filter((field) => field.path !== "start_query");
        next.push({ path: "start_query", code: "required" });
        return next;
      });
      return;
    }
    if (q.length > PLACE_SEARCH_Q_MAX) {
      setFieldErrors((current) => {
        const next = current.filter((field) => field.path !== "start_query");
        next.push({ path: "start_query", code: "too_long" });
        return next;
      });
      return;
    }
    setFieldErrors((current) =>
      current.filter((field) => field.path !== "start_query"),
    );
    setSearching(true);
    try {
      const response = await fetch(
        `/v1/plans/${planId}/place-searches?q=${encodeURIComponent(q)}`,
        { credentials: "same-origin" },
      );
      const body = await readJson(response);
      if (response.status === 409) {
        if (leaveClosed(parseError(body).reason)) {
          return;
        }
      }
      if (!response.ok) {
        setSearchResults([]);
        setSearchError(chromeFor(parseError(body), tCode("upstream")));
        return;
      }
      const results = parsePlaceResults(body);
      if (!results) {
        setSearchResults([]);
        setSearchError(tCode("upstream"));
        return;
      }
      setSearchResults(results);
    } catch {
      setSearchResults([]);
      setSearchError(tCode("upstream"));
    } finally {
      setSearching(false);
    }
  }

  function confirmPlace(hit: PlaceHit): void {
    setStartPlaceId(hit.googlePlaceId);
    setStartName(hit.name);
    setSearchResults([]);
    setFieldErrors((current) =>
      current.filter((field) => field.path !== "start_place_id"),
    );
  }

  async function onSave(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!plan) {
      return;
    }
    setSubmitting(true);
    setFormError(null);
    setSearchError(null);

    const fields: FieldError[] = [];
    const windowBodies: Record<string, unknown>[] = [];
    plan.windows.forEach((window, index) => {
      const answer = answers[window.id] ?? {
        kind: "",
        earliestLocal: "",
        latestLocal: "",
      };
      const checked = validateWindow(window, answer, index);
      fields.push(...checked.fields);
      if (checked.body) {
        windowBodies.push(checked.body);
      }
    });

    const startSet = Boolean(startPlaceId) || Boolean(startName);
    if (!startSet) {
      fields.push({ path: "start_place_id", code: "required" });
    }

    const pickBodies: Array<{ step_id: string; option_id: string }> = [];
    plan.steps.forEach((step, index) => {
      const optionId = picks[step.id];
      if (!optionId) {
        fields.push({ path: `picks[${index}]`, code: "not_one" });
        return;
      }
      pickBodies.push({ step_id: step.id, option_id: optionId });
    });

    const invalidWindow = fields.some(
      (field) =>
        field.path.includes("earliest_local") ||
        field.path.includes("latest_local"),
    );
    setFieldErrors(fields);
    if (invalidWindow) {
      setSaveNotice("incomplete");
      setFormError(tCode("validation_failed"));
      setSubmitting(false);
      return;
    }

    const body: Record<string, unknown> = {
      windows: windowBodies,
      picks: pickBodies,
    };
    if (startPlaceId) {
      body.start_place_id = startPlaceId;
    }

    try {
      const response = await fetch(`/v1/plans/${planId}/response`, {
        method: "PUT",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-HP-Request": "1",
        },
        body: JSON.stringify(body),
      });
      const payload = await readJson(response);
      if (response.status === 409) {
        if (leaveClosed(parseError(payload).reason)) {
          return;
        }
      }
      if (!response.ok) {
        const parsed = parseError(payload);
        setFieldErrors(parsed.fields.length > 0 ? parsed.fields : fields);
        setFormError(chromeFor(parsed, t("saveError")));
        setSaveNotice(plan.complete ? "complete" : "incomplete");
        return;
      }
      const saved = parseSaveResult(payload);
      if (!saved) {
        setFormError(t("saveError"));
        return;
      }
      setPlan((current) =>
        current ? { ...current, complete: saved.complete } : current,
      );
      setSaveNotice(saved.complete ? "complete" : "incomplete");
      if (!saved.complete && fields.length > 0) {
        setFieldErrors(fields);
      } else if (saved.complete) {
        setFieldErrors([]);
      }
    } catch {
      setFormError(t("saveError"));
    } finally {
      setSubmitting(false);
    }
  }

  if (load === "error") {
    return (
      <FormShell>
        <CardHeader>
          <h1 className="title text-foreground text-start text-pretty">
            {t("title")}
          </h1>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-destructive text-start" role="alert">
            {chromeFor(openError ?? { fields: [] }, tCode("upstream"))}
          </p>
          <Button
            type="button"
            variant="secondary"
            className="self-start"
            onClick={() => void loadResponse()}
          >
            {tCommon("retry")}
          </Button>
        </CardContent>
      </FormShell>
    );
  }

  if (load !== "loaded" || !plan) {
    return (
      <FormShell>
        <CardHeader>
          <h1 className="title text-foreground text-start text-pretty">
            {t("title")}
          </h1>
        </CardHeader>
      </FormShell>
    );
  }

  const budgetLabel = formatBudget(
    plan.budget.amountMinor,
    plan.budget.currency,
    locale,
  );
  const heading = plan.title ?? t("title");
  const queryError = fieldMessage("start_query");
  const startError = fieldMessage("start_place_id");
  const fieldsEditable = plan.planState === "collecting" || plan.planState === "blocked";

  return (
    <FormShell>
      <CardHeader className="gap-3">
        <h1 className="title text-foreground text-start text-pretty">{heading}</h1>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSave} className="flex flex-col gap-6" noValidate>
          {formError ? (
            <p className="text-destructive text-start" role="alert">
              {formError}
            </p>
          ) : null}

          {saveNotice === "complete" ? (
            <p className="body text-success text-start">{t("complete")}</p>
          ) : null}
          {saveNotice === "incomplete" ? (
            <p className="body text-warning text-start">{t("incomplete")}</p>
          ) : null}

          <section className="flex flex-col gap-2">
            <h2 className="section text-foreground text-start">{t("budget")}</h2>
            <p className="body text-foreground text-start tabular-nums">
              {budgetLabel}
            </p>
            <p className="caption text-muted-foreground text-start">
              {plan.timezone}
            </p>
          </section>

          <section className="flex flex-col gap-4">
            {plan.windows.map((window, index) => {
              const answer = answers[window.id] ?? {
                kind: "",
                earliestLocal: "",
                latestLocal: "",
              };
              const path = `windows[${index}]`;
              const kindError = fieldMessage(`${path}.kind`);
              const earliestError = fieldMessage(`${path}.earliest_local`);
              const latestError = fieldMessage(`${path}.latest_local`);
              const earliestId = `hp-window-${window.id}-earliest`;
              const latestId = `hp-window-${window.id}-latest`;
              const groupName = `hp-window-${window.id}-kind`;
              return (
                <fieldset
                  key={window.id}
                  className="flex flex-col gap-3 rounded-md border border-border bg-card p-4"
                >
                  <legend className="section text-foreground text-start px-1">
                    <span className="tabular-nums">
                      {window.localDate} {window.startLocal}-{window.endLocal}
                    </span>
                  </legend>
                  <div className="flex flex-row flex-wrap gap-4">
                    <label className="flex flex-row items-center gap-2 text-foreground">
                      <input
                        type="radio"
                        name={groupName}
                        value="busy"
                        checked={answer.kind === "busy"}
                        disabled={!fieldsEditable}
                        onChange={() =>
                          updateAnswer(window.id, {
                            kind: "busy",
                            earliestLocal: "",
                            latestLocal: "",
                          })
                        }
                      />
                      <span className="body">{t("busy")}</span>
                    </label>
                    <label className="flex flex-row items-center gap-2 text-foreground">
                      <input
                        type="radio"
                        name={groupName}
                        value="free"
                        checked={answer.kind === "free"}
                        disabled={!fieldsEditable}
                        onChange={() =>
                          updateAnswer(window.id, { kind: "free" })
                        }
                      />
                      <span className="body">{t("free")}</span>
                    </label>
                  </div>
                  {kindError ? (
                    <p className="text-sm text-destructive text-start">{kindError}</p>
                  ) : null}
                  {answer.kind === "free" ? (
                    <div className="flex flex-col gap-3">
                      <FieldBlock
                        id={earliestId}
                        label={t("earliest")}
                        errorId={`${earliestId}-error`}
                        error={earliestError}
                      >
                        <Input
                          id={earliestId}
                          type="time"
                          value={toHm(answer.earliestLocal)}
                          disabled={!fieldsEditable}
                          aria-invalid={earliestError ? true : undefined}
                          aria-describedby={
                            earliestError ? `${earliestId}-error` : undefined
                          }
                          onChange={(event) =>
                            updateAnswer(window.id, {
                              earliestLocal: event.target.value,
                            })
                          }
                        />
                      </FieldBlock>
                      <FieldBlock
                        id={latestId}
                        label={t("latest")}
                        errorId={`${latestId}-error`}
                        error={latestError}
                      >
                        <Input
                          id={latestId}
                          type="time"
                          value={toHm(answer.latestLocal)}
                          disabled={!fieldsEditable}
                          aria-invalid={latestError ? true : undefined}
                          aria-describedby={
                            latestError ? `${latestId}-error` : undefined
                          }
                          onChange={(event) =>
                            updateAnswer(window.id, {
                              latestLocal: event.target.value,
                            })
                          }
                        />
                      </FieldBlock>
                    </div>
                  ) : null}
                </fieldset>
              );
            })}
          </section>

          <section className="flex flex-col gap-3">
            <FieldBlock
              id="hp-start-search"
              label={t("startApproximate")}
              errorId="hp-start-search-error"
              error={queryError ?? startError}
            >
              <Input
                id="hp-start-search"
                type="search"
                value={searchQuery}
                disabled={!fieldsEditable}
                aria-invalid={queryError || startError ? true : undefined}
                aria-describedby={
                  queryError || startError ? "hp-start-search-error" : undefined
                }
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </FieldBlock>
            <Button
              type="button"
              variant="secondary"
              className="self-start"
              disabled={!fieldsEditable || searching}
              onClick={() => void onSearch()}
            >
              {t("search")}
            </Button>
            {searchError ? (
              <p className="text-destructive text-start" role="alert">
                {searchError}
              </p>
            ) : null}
            {searchResults.length > 0 ? (
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {searchResults.map((hit) => (
                  <li
                    key={hit.googlePlaceId}
                    className="flex flex-col items-start gap-2 rounded-md border border-border bg-card p-3"
                  >
                    <p className="body text-foreground text-start">{hit.name}</p>
                    <Button
                      type="button"
                      className="self-start bg-primary"
                      disabled={!fieldsEditable}
                      onClick={() => confirmPlace(hit)}
                    >
                      {t("confirmStart")}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            {startName ? (
              <p className="body text-foreground text-start">{startName}</p>
            ) : null}
          </section>

          <section className="flex flex-col gap-4">
            {plan.steps.map((step, index) => {
              const pickError = fieldMessage(`picks[${index}]`);
              const groupName = `hp-step-${step.id}`;
              return (
                <fieldset
                  key={step.id}
                  className="flex flex-col gap-3 rounded-md border border-border bg-card p-4"
                >
                  <legend className="section text-foreground text-start px-1">
                    {step.name}
                  </legend>
                  <div className="flex flex-col gap-2">
                    {step.options.map((option) => (
                      <label
                        key={option.id}
                        className="flex flex-row items-center gap-2 text-foreground"
                      >
                        <input
                          type="radio"
                          name={groupName}
                          value={option.id}
                          checked={picks[step.id] === option.id}
                          disabled={!fieldsEditable}
                          onChange={() =>
                            setPicks((current) => ({
                              ...current,
                              [step.id]: option.id,
                            }))
                          }
                        />
                        <span className="body">{option.label}</span>
                      </label>
                    ))}
                  </div>
                  {pickError ? (
                    <p className="text-sm text-destructive text-start">{pickError}</p>
                  ) : null}
                </fieldset>
              );
            })}
          </section>

          <Button
            type="submit"
            variant="secondary"
            className="self-start"
            disabled={!fieldsEditable || submitting}
          >
            {t("save")}
          </Button>
        </form>
      </CardContent>
    </FormShell>
  );
}

export function ResponseForm({ planId }: ResponseFormProps): ReactNode {
  return (
    <LanguageControl>
      <ResponseFormBody planId={planId} />
    </LanguageControl>
  );
}
