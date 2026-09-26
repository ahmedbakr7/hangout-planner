"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import React, {
  useEffect,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { LanguageControl } from "@/components/language-control";

const AMOUNT_MINOR_MAX = 100_000_000_000;
const TITLE_MAX = 80;
const STEP_NAME_MAX = 60;
const OPTION_LABEL_MAX = 40;
const WINDOWS_MAX = 7;
const STEPS_MAX = 6;
const OPTIONS_MIN = 2;
const OPTIONS_MAX = 4;
const THRESHOLD_MIN = 1;
const THRESHOLD_MAX = 100;
const DEFAULT_EXPONENT = 2;

const DEFAULT_CURRENCIES: CurrencyOption[] = [
  { code: "EGP", exponent: 2 },
  { code: "USD", exponent: 2 },
  { code: "SAR", exponent: 2 },
  { code: "AED", exponent: 2 },
];

type PlanState = "collecting" | "blocked" | "proposed" | "locked";
type BudgetEditMode = "any" | "raise" | "frozen";
type ThresholdEditMode = "any" | "lower" | "frozen";
type ParticipantStatus = "answered" | "in_progress";
type LoadState = "loading" | "loaded" | "error" | "locked";

type CurrencyOption = {
  code: string;
  exponent: number;
};

type FieldError = {
  path: string;
  code: string;
};

type ParsedError = {
  code?: string;
  reason?: string;
  fields: FieldError[];
};

type Editable = {
  title: boolean;
  timezone: boolean;
  windows: boolean;
  budget: BudgetEditMode;
  currency: boolean;
  threshold: ThresholdEditMode;
  steps: boolean;
};

type WindowRow = {
  id: string;
  localDate: string;
  startLocal: string;
  endLocal: string;
};

type OptionRow = {
  id: string;
  label: string;
};

type StepRow = {
  id: string;
  name: string;
  options: OptionRow[];
};

type ParticipantRow = {
  id: string;
  displayName: string;
  distinguisher: string;
  status: ParticipantStatus;
};

type OrganizerPlanData = {
  id: string;
  title: string;
  state: PlanState;
  timezone: string;
  windows: WindowRow[];
  budget: { amountMinor: number; currency: string };
  steps: StepRow[];
  threshold: number;
  answeredCount: number;
  inProgressCount: number;
  participants: ParticipantRow[];
  editable: Editable;
};

type WindowDraft = {
  localDate: string;
  startLocal: string;
  endLocal: string;
};

type StepDraft = {
  name: string;
  options: string[];
};

const stackStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-md)",
  alignItems: "stretch",
};

const sectionStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-sm)",
  alignItems: "stretch",
};

const fieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2xs)",
  alignItems: "stretch",
};

const rowStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2xs)",
  alignItems: "start",
};

const listStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-sm)",
  listStyle: "none",
  margin: 0,
  padding: 0,
};

const inputStyle: CSSProperties = {
  border: "var(--focus-ring-width) solid var(--border)",
  borderRadius: "var(--radius-sm)",
  paddingBlock: "var(--space-xs)",
  paddingInline: "var(--space-sm)",
  backgroundColor: "var(--surface)",
  color: "var(--text)",
  font: "inherit",
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

const secondaryLinkStyle: CSSProperties = {
  color: "var(--text)",
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

const secondaryButtonStyle: CSSProperties = {
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

function isPlanState(value: unknown): value is PlanState {
  return (
    value === "collecting" ||
    value === "blocked" ||
    value === "proposed" ||
    value === "locked"
  );
}

function isBudgetMode(value: unknown): value is BudgetEditMode {
  return value === "any" || value === "raise" || value === "frozen";
}

function isThresholdMode(value: unknown): value is ThresholdEditMode {
  return value === "any" || value === "lower" || value === "frozen";
}

function isParticipantStatus(value: unknown): value is ParticipantStatus {
  return value === "answered" || value === "in_progress";
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

function parseEditable(value: unknown): Editable | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as {
    title?: unknown;
    timezone?: unknown;
    windows?: unknown;
    budget?: unknown;
    currency?: unknown;
    threshold?: unknown;
    steps?: unknown;
  };
  if (typeof record.title !== "boolean") {
    return null;
  }
  if (typeof record.timezone !== "boolean") {
    return null;
  }
  if (typeof record.windows !== "boolean") {
    return null;
  }
  if (!isBudgetMode(record.budget)) {
    return null;
  }
  if (typeof record.currency !== "boolean") {
    return null;
  }
  if (!isThresholdMode(record.threshold)) {
    return null;
  }
  if (typeof record.steps !== "boolean") {
    return null;
  }
  return {
    title: record.title,
    timezone: record.timezone,
    windows: record.windows,
    budget: record.budget,
    currency: record.currency,
    threshold: record.threshold,
    steps: record.steps,
  };
}

function parseWindows(value: unknown): WindowRow[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const windows: WindowRow[] = [];
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

function parseSteps(value: unknown): StepRow[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const steps: StepRow[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      return null;
    }
    const record = item as {
      id?: unknown;
      name?: unknown;
      options?: unknown;
    };
    if (typeof record.id !== "string" || record.id.length === 0) {
      return null;
    }
    if (typeof record.name !== "string") {
      return null;
    }
    if (!Array.isArray(record.options)) {
      return null;
    }
    const options: OptionRow[] = [];
    for (const option of record.options) {
      if (typeof option !== "object" || option === null) {
        return null;
      }
      const optionRecord = option as { id?: unknown; label?: unknown };
      if (typeof optionRecord.id !== "string" || optionRecord.id.length === 0) {
        return null;
      }
      if (typeof optionRecord.label !== "string") {
        return null;
      }
      options.push({ id: optionRecord.id, label: optionRecord.label });
    }
    steps.push({ id: record.id, name: record.name, options });
  }
  return steps;
}

function parseParticipants(value: unknown): ParticipantRow[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const participants: ParticipantRow[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      return null;
    }
    const record = item as {
      id?: unknown;
      display_name?: unknown;
      distinguisher?: unknown;
      status?: unknown;
    };
    if (typeof record.id !== "string" || record.id.length === 0) {
      return null;
    }
    if (typeof record.display_name !== "string") {
      return null;
    }
    if (typeof record.distinguisher !== "string") {
      return null;
    }
    if (!isParticipantStatus(record.status)) {
      return null;
    }
    participants.push({
      id: record.id,
      displayName: record.display_name,
      distinguisher: record.distinguisher,
      status: record.status,
    });
  }
  return participants;
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

function parsePlan(value: unknown): OrganizerPlanData | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as {
    id?: unknown;
    title?: unknown;
    state?: unknown;
    timezone?: unknown;
    windows?: unknown;
    budget?: unknown;
    steps?: unknown;
    threshold?: unknown;
    answered_count?: unknown;
    in_progress_count?: unknown;
    participants?: unknown;
    editable?: unknown;
  };
  if (typeof record.id !== "string" || record.id.length === 0) {
    return null;
  }
  if (typeof record.title !== "string") {
    return null;
  }
  if (!isPlanState(record.state)) {
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
  const steps = parseSteps(record.steps);
  if (!steps) {
    return null;
  }
  if (
    typeof record.threshold !== "number" ||
    !Number.isInteger(record.threshold)
  ) {
    return null;
  }
  if (
    typeof record.answered_count !== "number" ||
    !Number.isInteger(record.answered_count)
  ) {
    return null;
  }
  if (
    typeof record.in_progress_count !== "number" ||
    !Number.isInteger(record.in_progress_count)
  ) {
    return null;
  }
  const participants = parseParticipants(record.participants);
  if (!participants) {
    return null;
  }
  const editable = parseEditable(record.editable);
  if (!editable) {
    return null;
  }
  return {
    id: record.id,
    title: record.title,
    state: record.state,
    timezone: record.timezone,
    windows,
    budget,
    steps,
    threshold: record.threshold,
    answeredCount: record.answered_count,
    inProgressCount: record.in_progress_count,
    participants,
    editable,
  };
}

function isPlanLockedResponse(status: number, body: unknown): boolean {
  if (status === 409) {
    return parseError(body).reason === "plan_locked";
  }
  if (status === 200) {
    const plan = parsePlan(body);
    return plan?.state === "locked";
  }
  return false;
}

function exponentFor(code: string): number {
  const match = DEFAULT_CURRENCIES.find((currency) => currency.code === code);
  return match?.exponent ?? DEFAULT_EXPONENT;
}

function decimalToAmountMinor(
  decimal: string,
  exponent: number,
): number | null {
  const trimmed = decimal.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) {
    return null;
  }
  const parts = trimmed.split(".");
  const wholeDigits = parts[0] ?? "0";
  const fracDigits = parts[1] ?? "";
  if (fracDigits.length > exponent) {
    return null;
  }
  let scaled = wholeDigits;
  for (let i = 0; i < exponent; i += 1) {
    scaled += fracDigits[i] ?? "0";
  }
  let start = 0;
  while (start < scaled.length - 1 && scaled[start] === "0") {
    start += 1;
  }
  const normalized = scaled.slice(start);
  const minor = Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(minor) || minor < 1 || minor > AMOUNT_MINOR_MAX) {
    return null;
  }
  return minor;
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

function emptyWindow(): WindowDraft {
  return { localDate: "", startLocal: "", endLocal: "" };
}

function emptyOptions(): string[] {
  return ["", "", "", ""];
}

function emptyStep(): StepDraft {
  return { name: "", options: emptyOptions() };
}

function padOptions(labels: readonly string[]): string[] {
  const options = labels.slice(0, OPTIONS_MAX);
  while (options.length < OPTIONS_MAX) {
    options.push("");
  }
  return options;
}

function compactOptions(options: readonly string[]): {
  labels: string[];
  blanks: number[];
} {
  let lastFilled = -1;
  for (let i = 0; i < options.length; i += 1) {
    if (options[i]?.trim()) {
      lastFilled = i;
    }
  }
  const sliceEnd = Math.max(lastFilled + 1, OPTIONS_MIN);
  const labels: string[] = [];
  const blanks: number[] = [];
  for (let i = 0; i < sliceEnd && i < OPTIONS_MAX; i += 1) {
    const trimmed = (options[i] ?? "").trim();
    if (trimmed.length === 0) {
      blanks.push(i);
      labels.push("");
    } else {
      labels.push(trimmed);
    }
  }
  return { labels, blanks };
}

function foldDisplayName(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase();
}

function collidingNameKeys(participants: readonly ParticipantRow[]): Set<string> {
  const counts = new Map<string, number>();
  for (const participant of participants) {
    const key = foldDisplayName(participant.displayName);
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

function stateClassName(state: PlanState): string {
  if (state === "blocked") {
    return "danger";
  }
  if (state === "locked") {
    return "success";
  }
  return "body";
}

function frozenPathSet(fields: readonly FieldError[]): Set<string> {
  const paths = new Set<string>();
  for (const field of fields) {
    if (field.path === "currency" || field.path === "budget.currency") {
      paths.add("currency");
    } else if (field.path === "budget" || field.path.startsWith("budget.")) {
      paths.add("budget");
    } else if (field.path.startsWith("windows")) {
      paths.add("windows");
    } else if (field.path.startsWith("steps")) {
      paths.add("steps");
    } else if (field.path.length > 0) {
      paths.add(field.path);
    }
  }
  return paths;
}

export type OrganizerPlanProps = {
  planId: string;
};

function OrganizerPlanBody({ planId }: OrganizerPlanProps): ReactNode {
  const router = useRouter();
  const t = useTranslations("plans");
  const tCreate = useTranslations("Create");
  const tHome = useTranslations("Home");
  const tCommon = useTranslations("common");
  const tCode = useTranslations("errors.code");
  const tReason = useTranslations("errors.reason");
  const tFields = useTranslations("errors.fields");

  const [load, setLoad] = useState<LoadState>("loading");
  const [plan, setPlan] = useState<OrganizerPlanData | null>(null);
  const [title, setTitle] = useState("");
  const [timezone, setTimezone] = useState("");
  const [windows, setWindows] = useState<WindowDraft[]>([]);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("EGP");
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [threshold, setThreshold] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [rejectedFrozen, setRejectedFrozen] = useState<Set<string>>(
    () => new Set(),
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function applyPlan(next: OrganizerPlanData): void {
    setPlan(next);
    setTitle(next.title);
    setTimezone(next.timezone);
    setWindows(
      next.windows.map((window) => ({
        localDate: window.localDate,
        startLocal: toHm(window.startLocal),
        endLocal: toHm(window.endLocal),
      })),
    );
    setAmount(
      amountMinorToDecimal(
        next.budget.amountMinor,
        exponentFor(next.budget.currency),
      ),
    );
    setCurrency(next.budget.currency);
    setSteps(
      next.steps.map((step) => ({
        name: step.name,
        options: next.editable.steps
          ? padOptions(step.options.map((option) => option.label))
          : step.options.map((option) => option.label),
      })),
    );
    setThreshold(String(next.threshold));
  }

  async function loadPlan(): Promise<void> {
    setLoad("loading");
    setPlan(null);
    setFieldErrors([]);
    setRejectedFrozen(new Set());
    setFormError(null);
    try {
      const response = await fetch(`/v1/plans/${planId}`, {
        credentials: "same-origin",
      });
      const body = await readJson(response);
      if (isPlanLockedResponse(response.status, body)) {
        setLoad("locked");
        setPlan(null);
        router.replace(`/plans/${planId}/confirmed`);
        return;
      }
      if (!response.ok) {
        setLoad("error");
        setPlan(null);
        return;
      }
      const parsed = parsePlan(body);
      if (!parsed || parsed.id !== planId) {
        setLoad("error");
        setPlan(null);
        return;
      }
      if (parsed.state === "locked") {
        setLoad("locked");
        setPlan(null);
        router.replace(`/plans/${planId}/confirmed`);
        return;
      }
      applyPlan(parsed);
      setLoad("loaded");
    } catch {
      setLoad("error");
      setPlan(null);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function start(): Promise<void> {
      setLoad("loading");
      setPlan(null);
      setFieldErrors([]);
      setRejectedFrozen(new Set());
      setFormError(null);
      try {
        const response = await fetch(`/v1/plans/${planId}`, {
          credentials: "same-origin",
        });
        if (cancelled) {
          return;
        }
        const body = await readJson(response);
        if (cancelled) {
          return;
        }
        if (isPlanLockedResponse(response.status, body)) {
          setLoad("locked");
          setPlan(null);
          router.replace(`/plans/${planId}/confirmed`);
          return;
        }
        if (!response.ok) {
          setLoad("error");
          setPlan(null);
          return;
        }
        const parsed = parsePlan(body);
        if (!parsed || parsed.id !== planId) {
          setLoad("error");
          setPlan(null);
          return;
        }
        if (parsed.state === "locked") {
          setLoad("locked");
          setPlan(null);
          router.replace(`/plans/${planId}/confirmed`);
          return;
        }
        applyPlan(parsed);
        setLoad("loaded");
      } catch {
        if (!cancelled) {
          setLoad("error");
          setPlan(null);
        }
      }
    }

    void start();
    return () => {
      cancelled = true;
    };
  }, [planId, router]);

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

  function chromeFor(parsed: ParsedError, fallback: string): string {
    if (parsed.reason && tReason.has(parsed.reason)) {
      return tReason(parsed.reason);
    }
    if (parsed.code && tCode.has(parsed.code)) {
      return tCode(parsed.code);
    }
    return fallback;
  }

  function isRejected(path: string): boolean {
    return rejectedFrozen.has(path);
  }

  function titleEditable(): boolean {
    return Boolean(plan?.editable.title) && !isRejected("title");
  }

  function timezoneEditable(): boolean {
    return Boolean(plan?.editable.timezone) && !isRejected("timezone");
  }

  function windowsEditable(): boolean {
    return Boolean(plan?.editable.windows) && !isRejected("windows");
  }

  function budgetEditable(): boolean {
    if (!plan) {
      return false;
    }
    if (isRejected("budget")) {
      return false;
    }
    return plan.editable.budget === "any" || plan.editable.budget === "raise";
  }

  function currencyEditable(): boolean {
    return Boolean(plan?.editable.currency) && !isRejected("currency");
  }

  function thresholdEditable(): boolean {
    if (!plan) {
      return false;
    }
    if (isRejected("threshold")) {
      return false;
    }
    return (
      plan.editable.threshold === "any" || plan.editable.threshold === "lower"
    );
  }

  function stepsEditable(): boolean {
    return Boolean(plan?.editable.steps) && !isRejected("steps");
  }

  function frozenCopy(path: string): string | null {
    if (!plan) {
      return null;
    }
    if (isRejected(path)) {
      return t("frozen");
    }
    if (path === "title" && !plan.editable.title) {
      return t("frozen");
    }
    if (path === "timezone" && !plan.editable.timezone) {
      return t("frozen");
    }
    if (path === "windows" && !plan.editable.windows) {
      return t("frozen");
    }
    if (path === "budget" && plan.editable.budget === "frozen") {
      return t("frozen");
    }
    if (path === "currency" && !plan.editable.currency) {
      return t("frozen");
    }
    if (path === "threshold" && plan.editable.threshold === "frozen") {
      return t("frozen");
    }
    if (path === "steps" && !plan.editable.steps) {
      return t("frozen");
    }
    return null;
  }

  function restoreFromPlan(): void {
    if (plan) {
      applyPlan(plan);
    }
  }

  async function onSave(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!plan) {
      return;
    }
    setSubmitting(true);
    setFormError(null);
    setFieldErrors([]);

    const fields: FieldError[] = [];
    const patch: Record<string, unknown> = {};

    if (titleEditable()) {
      const trimmedTitle = title.trim();
      if (trimmedTitle.length === 0) {
        fields.push({ path: "title", code: "required" });
      } else if (trimmedTitle.length > TITLE_MAX) {
        fields.push({ path: "title", code: "too_long" });
      } else if (trimmedTitle !== plan.title) {
        patch.title = trimmedTitle;
      }
    }

    if (timezoneEditable()) {
      const trimmedZone = timezone.trim();
      if (trimmedZone.length === 0) {
        fields.push({ path: "timezone", code: "required" });
      } else if (trimmedZone !== plan.timezone) {
        patch.timezone = trimmedZone;
      }
    }

    if (windowsEditable()) {
      if (windows.length === 0) {
        fields.push({ path: "windows", code: "required" });
      }
      const parsedWindows: Array<{
        local_date: string;
        start_local: string;
        end_local: string;
      }> = [];
      windows.forEach((window, index) => {
        const path = `windows[${index}]`;
        let localDate: string | undefined;
        if (window.localDate.trim().length === 0) {
          fields.push({ path: `${path}.local_date`, code: "required" });
        } else {
          localDate = window.localDate;
        }
        const startHm = toHm(window.startLocal);
        const endHm = toHm(window.endLocal);
        let startMinutes: number | null = null;
        let endMinutes: number | null = null;
        if (startHm.length === 0) {
          fields.push({ path: `${path}.start_local`, code: "required" });
        } else {
          startMinutes = parseLocalMinutes(startHm);
          if (startMinutes === null) {
            fields.push({ path: `${path}.start_local`, code: "bad_time" });
          }
        }
        if (endHm.length === 0) {
          fields.push({ path: `${path}.end_local`, code: "required" });
        } else {
          endMinutes = parseLocalMinutes(endHm);
          if (endMinutes === null) {
            fields.push({ path: `${path}.end_local`, code: "bad_time" });
          }
        }
        if (
          startMinutes !== null &&
          endMinutes !== null &&
          endMinutes <= startMinutes
        ) {
          fields.push({ path: `${path}.end_local`, code: "end_before_start" });
        }
        if (
          localDate &&
          startMinutes !== null &&
          endMinutes !== null &&
          endMinutes > startMinutes
        ) {
          parsedWindows.push({
            local_date: localDate,
            start_local: startHm,
            end_local: endHm,
          });
        }
      });
      if (fields.length === 0) {
        const stored = plan.windows.map((window) => ({
          local_date: window.localDate,
          start_local: toHm(window.startLocal),
          end_local: toHm(window.endLocal),
        }));
        if (JSON.stringify(parsedWindows) !== JSON.stringify(stored)) {
          patch.windows = parsedWindows;
        }
      }
    }

    if (budgetEditable() || currencyEditable()) {
      const exponent = exponentFor(currency);
      let amountMinor: number | null = null;
      if (amount.trim().length === 0) {
        fields.push({ path: "budget.amount_minor", code: "required" });
      } else {
        amountMinor = decimalToAmountMinor(amount, exponent);
        if (amountMinor === null) {
          fields.push({ path: "budget.amount_minor", code: "not_positive" });
        }
      }
      if (currency.trim().length === 0) {
        fields.push({ path: "budget.currency", code: "required" });
      }
      if (amountMinor !== null && currency.trim().length > 0) {
        const nextCurrency = currencyEditable()
          ? currency
          : plan.budget.currency;
        if (
          amountMinor !== plan.budget.amountMinor ||
          nextCurrency !== plan.budget.currency
        ) {
          patch.budget = {
            amount_minor: amountMinor,
            currency: nextCurrency,
          };
        }
      }
    }

    if (stepsEditable()) {
      if (steps.length === 0) {
        fields.push({ path: "steps", code: "required" });
      }
      const parsedSteps: Array<{ name: string; options: string[] }> = [];
      steps.forEach((step, index) => {
        const path = `steps[${index}]`;
        const name = step.name.trim();
        if (name.length === 0) {
          fields.push({ path: `${path}.name`, code: "required" });
        } else if (name.length > STEP_NAME_MAX) {
          fields.push({ path: `${path}.name`, code: "too_long" });
        }
        const compacted = compactOptions(step.options);
        if (compacted.labels.length < OPTIONS_MIN) {
          fields.push({ path: `${path}.options`, code: "below_min" });
        } else if (compacted.labels.length > OPTIONS_MAX) {
          fields.push({ path: `${path}.options`, code: "above_max" });
        }
        compacted.blanks.forEach((optionIndex) => {
          fields.push({
            path: `${path}.options[${optionIndex}]`,
            code: "required",
          });
        });
        compacted.labels.forEach((label, optionIndex) => {
          if (label.length > OPTION_LABEL_MAX) {
            fields.push({
              path: `${path}.options[${optionIndex}]`,
              code: "too_long",
            });
          }
        });
        if (
          name.length > 0 &&
          name.length <= STEP_NAME_MAX &&
          compacted.blanks.length === 0 &&
          compacted.labels.length >= OPTIONS_MIN &&
          compacted.labels.length <= OPTIONS_MAX &&
          compacted.labels.every((label) => label.length <= OPTION_LABEL_MAX)
        ) {
          parsedSteps.push({ name, options: compacted.labels });
        }
      });
      if (fields.length === 0) {
        const stored = plan.steps.map((step) => ({
          name: step.name,
          options: step.options.map((option) => option.label),
        }));
        if (JSON.stringify(parsedSteps) !== JSON.stringify(stored)) {
          patch.steps = parsedSteps;
        }
      }
    }

    if (thresholdEditable()) {
      const trimmedThreshold = threshold.trim();
      if (trimmedThreshold.length === 0) {
        fields.push({ path: "threshold", code: "required" });
      } else if (!/^\d+$/.test(trimmedThreshold)) {
        fields.push({ path: "threshold", code: "unknown" });
      } else {
        const value = Number.parseInt(trimmedThreshold, 10);
        if (value < THRESHOLD_MIN) {
          fields.push({ path: "threshold", code: "below_min" });
        } else if (value > THRESHOLD_MAX) {
          fields.push({ path: "threshold", code: "above_max" });
        } else if (value !== plan.threshold) {
          patch.threshold = value;
        }
      }
    }

    if (fields.length > 0) {
      setFieldErrors(fields);
      setFormError(
        tCode.has("validation_failed")
          ? tCode("validation_failed")
          : tCreate("saveError"),
      );
      setSubmitting(false);
      return;
    }

    if (Object.keys(patch).length === 0) {
      setSubmitting(false);
      return;
    }

    try {
      const response = await fetch(`/v1/plans/${planId}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-HP-Request": "1",
        },
        body: JSON.stringify(patch),
      });
      const payload = await readJson(response);
      if (isPlanLockedResponse(response.status, payload)) {
        setLoad("locked");
        setPlan(null);
        router.replace(`/plans/${planId}/confirmed`);
        return;
      }
      if (response.ok) {
        const parsed = parsePlan(payload);
        if (parsed && parsed.id === planId) {
          if (parsed.state === "locked") {
            setLoad("locked");
            setPlan(null);
            router.replace(`/plans/${planId}/confirmed`);
            return;
          }
          applyPlan(parsed);
          setRejectedFrozen(new Set());
          setFieldErrors([]);
          setFormError(null);
          setSubmitting(false);
          return;
        }
        setFormError(tCreate("saveError"));
        setSubmitting(false);
        return;
      }
      const parsed = parseError(payload);
      if (parsed.reason === "field_frozen") {
        restoreFromPlan();
        setRejectedFrozen(frozenPathSet(parsed.fields));
        setFieldErrors(
          parsed.fields.length > 0
            ? parsed.fields.map((field) => ({
                path: field.path,
                code: "frozen",
              }))
            : [{ path: "title", code: "frozen" }],
        );
        setFormError(t("frozen"));
        setSubmitting(false);
        return;
      }
      setFieldErrors(parsed.fields);
      setFormError(chromeFor(parsed, tCreate("saveError")));
    } catch {
      setFormError(tCreate("saveError"));
    } finally {
      setSubmitting(false);
    }
  }

  function updateWindow(index: number, patch: Partial<WindowDraft>): void {
    setWindows((current) =>
      current.map((window, i) => (i === index ? { ...window, ...patch } : window)),
    );
  }

  function updateStep(index: number, patch: Partial<StepDraft>): void {
    setSteps((current) =>
      current.map((step, i) => (i === index ? { ...step, ...patch } : step)),
    );
  }

  function updateOption(
    stepIndex: number,
    optionIndex: number,
    value: string,
  ): void {
    setSteps((current) =>
      current.map((step, i) => {
        if (i !== stepIndex) {
          return step;
        }
        const options = step.options.map((option, j) =>
          j === optionIndex ? value : option,
        );
        return { ...step, options };
      }),
    );
  }

  const titleError = fieldMessage("title");
  const timezoneError = fieldMessage("timezone");
  const windowsError = fieldMessage("windows");
  const amountError = fieldMessage("budget.amount_minor") ?? fieldMessage("budget");
  const currencyError = fieldMessage("budget.currency") ?? fieldMessage("currency");
  const stepsError = fieldMessage("steps");
  const thresholdError = fieldMessage("threshold");
  const titleFrozen = frozenCopy("title");
  const timezoneFrozen = frozenCopy("timezone");
  const windowsFrozen = frozenCopy("windows");
  const budgetFrozen = frozenCopy("budget");
  const currencyFrozen = frozenCopy("currency");
  const stepsFrozen = frozenCopy("steps");
  const thresholdFrozen = frozenCopy("threshold");

  if (load === "error") {
    return (
      <main className="surface" style={stackStyle}>
        <h1 className="title">{t("title")}</h1>
        <p className="danger" role="alert">
          {t("loadError")}
        </p>
        <button type="button" onClick={() => void loadPlan()} style={retryButtonStyle}>
          {t("retry")}
        </button>
      </main>
    );
  }

  if (load !== "loaded" || !plan) {
    return (
      <main className="surface" style={stackStyle}>
        <h1 className="title">{t("title")}</h1>
      </main>
    );
  }

  const colliding = collidingNameKeys(plan.participants);
  const inviteHref = `/plans/${planId}/invite`;
  const proposalHref = `/plans/${planId}/proposal`;
  const showProposalWay = plan.state === "blocked" || plan.state === "proposed";
  const somethingEditable =
    titleEditable() ||
    timezoneEditable() ||
    windowsEditable() ||
    budgetEditable() ||
    currencyEditable() ||
    thresholdEditable() ||
    stepsEditable();

  return (
    <main className="surface" style={stackStyle}>
      <h1 className="title">{plan.title}</h1>
      <p className={stateClassName(plan.state)}>{tHome(`state.${plan.state}`)}</p>
      <p className="body">{plan.timezone}</p>

      <p className="body">
        {t("answered", {
          answered: plan.answeredCount,
          threshold: plan.threshold,
        })}
      </p>
      <p className="body">
        {t("inProgress", { count: plan.inProgressCount })}
      </p>

      {plan.state === "collecting" ? (
        <p className="text-muted body">{t("waiting")}</p>
      ) : null}

      {showProposalWay ? (
        <a href={proposalHref} style={primaryLinkStyle}>
          {t("openProposal")}
        </a>
      ) : null}

      {plan.state === "collecting" ? (
        <a href={inviteHref} style={primaryLinkStyle}>
          {t("invite")}
        </a>
      ) : (
        <a href={inviteHref} style={secondaryLinkStyle}>
          {t("invite")}
        </a>
      )}

      <ul style={listStyle}>
        {plan.participants.map((participant) => {
          const showDistinguisher = colliding.has(
            foldDisplayName(participant.displayName),
          );
          const statusClass =
            participant.status === "answered" ? "success" : "warning";
          const statusLabel =
            participant.status === "answered"
              ? t("statusAnswered")
              : t("statusInProgress");
          return (
            <li key={participant.id} style={rowStyle}>
              <span className="body">{participant.displayName}</span>
              {showDistinguisher ? (
                <span className="caption">{participant.distinguisher}</span>
              ) : null}
              <span className={statusClass}>{statusLabel}</span>
            </li>
          );
        })}
      </ul>

      <form onSubmit={onSave} style={stackStyle} noValidate>
        {formError ? (
          <p className="danger" role="alert">
            {formError}
          </p>
        ) : null}

        <section style={sectionStyle}>
          <h2 className="section">{tCreate("sectionTitle")}</h2>
          <div style={fieldStyle}>
            <label htmlFor="hp-title">{tCreate("planTitle")}</label>
            <input
              id="hp-title"
              name="title"
              type="text"
              value={title}
              disabled={!titleEditable()}
              onChange={(event) => setTitle(event.target.value)}
              aria-invalid={titleError ? true : undefined}
              aria-describedby={
                titleError || titleFrozen ? "hp-title-error" : undefined
              }
              style={inputStyle}
            />
            {titleError || titleFrozen ? (
              <p id="hp-title-error" className="danger">
                {titleError ?? titleFrozen}
              </p>
            ) : null}
          </div>
        </section>

        <section style={sectionStyle}>
          <h2 className="section">{tCreate("sectionWhen")}</h2>
          <div style={fieldStyle}>
            <label htmlFor="hp-timezone">{tCreate("timezone")}</label>
            <input
              id="hp-timezone"
              name="timezone"
              type="text"
              value={timezone}
              disabled={!timezoneEditable()}
              onChange={(event) => setTimezone(event.target.value)}
              aria-invalid={timezoneError ? true : undefined}
              aria-describedby={
                timezoneError || timezoneFrozen
                  ? "hp-timezone-error"
                  : undefined
              }
              style={inputStyle}
            />
            {timezoneError || timezoneFrozen ? (
              <p id="hp-timezone-error" className="danger">
                {timezoneError ?? timezoneFrozen}
              </p>
            ) : null}
          </div>
          {windowsError ? (
            <p id="hp-windows-error" className="danger">
              {windowsError}
            </p>
          ) : null}
          {windowsFrozen ? (
            <p className="danger">{windowsFrozen}</p>
          ) : null}
          {windows.map((window, index) => {
            const dateError = fieldMessage(`windows[${index}].local_date`);
            const startError = fieldMessage(`windows[${index}].start_local`);
            const endError = fieldMessage(`windows[${index}].end_local`);
            return (
              <div key={plan.windows[index]?.id ?? index} style={sectionStyle}>
                <div style={fieldStyle}>
                  <label htmlFor={`hp-window-${index}-date`}>
                    {tCreate("date")}
                  </label>
                  <input
                    id={`hp-window-${index}-date`}
                    name={`windows[${index}].local_date`}
                    type="date"
                    value={window.localDate}
                    disabled={!windowsEditable()}
                    onChange={(event) =>
                      updateWindow(index, { localDate: event.target.value })
                    }
                    aria-invalid={dateError ? true : undefined}
                    aria-describedby={
                      dateError ? `hp-window-${index}-date-error` : undefined
                    }
                    style={inputStyle}
                  />
                  {dateError ? (
                    <p id={`hp-window-${index}-date-error`} className="danger">
                      {dateError}
                    </p>
                  ) : null}
                </div>
                <div style={fieldStyle}>
                  <label htmlFor={`hp-window-${index}-start`}>
                    {tCreate("start")}
                  </label>
                  <input
                    id={`hp-window-${index}-start`}
                    name={`windows[${index}].start_local`}
                    type="time"
                    value={window.startLocal}
                    disabled={!windowsEditable()}
                    onChange={(event) =>
                      updateWindow(index, { startLocal: event.target.value })
                    }
                    aria-invalid={startError ? true : undefined}
                    aria-describedby={
                      startError ? `hp-window-${index}-start-error` : undefined
                    }
                    style={inputStyle}
                  />
                  {startError ? (
                    <p id={`hp-window-${index}-start-error`} className="danger">
                      {startError}
                    </p>
                  ) : null}
                </div>
                <div style={fieldStyle}>
                  <label htmlFor={`hp-window-${index}-end`}>
                    {tCreate("end")}
                  </label>
                  <input
                    id={`hp-window-${index}-end`}
                    name={`windows[${index}].end_local`}
                    type="time"
                    value={window.endLocal}
                    disabled={!windowsEditable()}
                    onChange={(event) =>
                      updateWindow(index, { endLocal: event.target.value })
                    }
                    aria-invalid={endError ? true : undefined}
                    aria-describedby={
                      endError ? `hp-window-${index}-end-error` : undefined
                    }
                    style={inputStyle}
                  />
                  {endError ? (
                    <p id={`hp-window-${index}-end-error`} className="danger">
                      {endError}
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
          {windowsEditable() ? (
            <button
              type="button"
              onClick={() => {
                setWindows((current) =>
                  current.length < WINDOWS_MAX
                    ? [...current, emptyWindow()]
                    : current,
                );
              }}
              style={secondaryButtonStyle}
            >
              {tCreate("addWindow")}
            </button>
          ) : null}
        </section>

        <section style={sectionStyle}>
          <h2 className="section">{tCreate("sectionBudget")}</h2>
          <div style={fieldStyle}>
            <label htmlFor="hp-amount">{tCreate("amount")}</label>
            <input
              id="hp-amount"
              name="amount"
              type="text"
              inputMode="decimal"
              value={amount}
              disabled={!budgetEditable()}
              onChange={(event) => setAmount(event.target.value)}
              aria-invalid={amountError ? true : undefined}
              aria-describedby={
                amountError || budgetFrozen ? "hp-amount-error" : undefined
              }
              style={inputStyle}
            />
            {amountError || budgetFrozen ? (
              <p id="hp-amount-error" className="danger">
                {amountError ?? budgetFrozen}
              </p>
            ) : null}
          </div>
          <div style={fieldStyle}>
            <label htmlFor="hp-currency">{tCreate("currency")}</label>
            <select
              id="hp-currency"
              name="currency"
              value={currency}
              disabled={!currencyEditable()}
              onChange={(event) => setCurrency(event.target.value)}
              aria-invalid={currencyError ? true : undefined}
              aria-describedby={
                currencyError || currencyFrozen
                  ? "hp-currency-error"
                  : undefined
              }
              style={inputStyle}
            >
              {DEFAULT_CURRENCIES.some((item) => item.code === currency) ? null : (
                <option value={currency}>{currency}</option>
              )}
              {DEFAULT_CURRENCIES.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.code}
                </option>
              ))}
            </select>
            {currencyError || currencyFrozen ? (
              <p id="hp-currency-error" className="danger">
                {currencyError ?? currencyFrozen}
              </p>
            ) : null}
          </div>
        </section>

        <section style={sectionStyle}>
          <h2 className="section">{tCreate("sectionSteps")}</h2>
          {stepsError ? (
            <p id="hp-steps-error" className="danger">
              {stepsError}
            </p>
          ) : null}
          {stepsFrozen ? <p className="danger">{stepsFrozen}</p> : null}
          {steps.map((step, index) => {
            const nameError = fieldMessage(`steps[${index}].name`);
            const optionsError = fieldMessage(`steps[${index}].options`);
            return (
              <div key={plan.steps[index]?.id ?? index} style={sectionStyle}>
                <div style={fieldStyle}>
                  <label htmlFor={`hp-step-${index}-name`}>
                    {tCreate("stepName")}
                  </label>
                  <input
                    id={`hp-step-${index}-name`}
                    name={`steps[${index}].name`}
                    type="text"
                    value={step.name}
                    disabled={!stepsEditable()}
                    onChange={(event) =>
                      updateStep(index, { name: event.target.value })
                    }
                    aria-invalid={nameError ? true : undefined}
                    aria-describedby={
                      nameError ? `hp-step-${index}-name-error` : undefined
                    }
                    style={inputStyle}
                  />
                  {nameError ? (
                    <p id={`hp-step-${index}-name-error`} className="danger">
                      {nameError}
                    </p>
                  ) : null}
                </div>
                {optionsError ? (
                  <p className="danger">{optionsError}</p>
                ) : null}
                {step.options.map((option, optionIndex) => {
                  const optionError = fieldMessage(
                    `steps[${index}].options[${optionIndex}]`,
                  );
                  return (
                    <div key={optionIndex} style={fieldStyle}>
                      <label htmlFor={`hp-step-${index}-option-${optionIndex}`}>
                        {tCreate("optionLabel")}
                      </label>
                      <input
                        id={`hp-step-${index}-option-${optionIndex}`}
                        name={`steps[${index}].options[${optionIndex}]`}
                        type="text"
                        value={option}
                        disabled={!stepsEditable()}
                        onChange={(event) =>
                          updateOption(index, optionIndex, event.target.value)
                        }
                        aria-invalid={optionError ? true : undefined}
                        aria-describedby={
                          optionError
                            ? `hp-step-${index}-option-${optionIndex}-error`
                            : undefined
                        }
                        style={inputStyle}
                      />
                      {optionError ? (
                        <p
                          id={`hp-step-${index}-option-${optionIndex}-error`}
                          className="danger"
                        >
                          {optionError}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            );
          })}
          {stepsEditable() ? (
            <button
              type="button"
              onClick={() => {
                setSteps((current) =>
                  current.length < STEPS_MAX
                    ? [...current, emptyStep()]
                    : current,
                );
              }}
              style={secondaryButtonStyle}
            >
              {tCreate("addStep")}
            </button>
          ) : null}
        </section>

        <section style={sectionStyle}>
          <h2 className="section">{tCreate("sectionThreshold")}</h2>
          <div style={fieldStyle}>
            <label htmlFor="hp-threshold">{tCreate("threshold")}</label>
            <input
              id="hp-threshold"
              name="threshold"
              type="text"
              inputMode="numeric"
              value={threshold}
              disabled={!thresholdEditable()}
              onChange={(event) => setThreshold(event.target.value)}
              aria-invalid={thresholdError ? true : undefined}
              aria-describedby={
                thresholdError || thresholdFrozen
                  ? "hp-threshold-error"
                  : undefined
              }
              style={inputStyle}
            />
            {thresholdError || thresholdFrozen ? (
              <p id="hp-threshold-error" className="danger">
                {thresholdError ?? thresholdFrozen}
              </p>
            ) : null}
          </div>
        </section>

        {somethingEditable ? (
          <button
            type="submit"
            disabled={submitting}
            style={secondaryButtonStyle}
          >
            {plan.editable.budget === "raise" && plan.state === "blocked"
              ? t("raiseBudget")
              : tCommon("save")}
          </button>
        ) : null}
      </form>
    </main>
  );
}

export function OrganizerPlan({ planId }: OrganizerPlanProps): ReactNode {
  return (
    <LanguageControl>
      <OrganizerPlanBody planId={planId} />
    </LanguageControl>
  );
}
