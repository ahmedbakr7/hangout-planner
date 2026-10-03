"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import React, {
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { AccountGate } from "@/components/account-gate";
import { LanguageControl } from "@/components/language-control";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
const DEFAULT_CURRENCY = "EGP";
const DEFAULT_EXPONENT = 2;

const DEFAULT_CURRENCIES: CurrencyOption[] = [
  { code: "EGP", exponent: 2 },
  { code: "USD", exponent: 2 },
  { code: "SAR", exponent: 2 },
  { code: "AED", exponent: 2 },
];

const selectClassName =
  "flex h-9 w-full rounded-sm border border-input bg-background px-3 py-1 text-sm text-foreground text-start shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

type SessionState = "checking" | "signed_out" | "signed_in";

type FieldError = {
  path: string;
  code: string;
};

type ParsedError = {
  code?: string;
  reason?: string;
  fields: FieldError[];
};

type CurrencyOption = {
  code: string;
  exponent: number;
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

function environmentTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function emptyOptions(): string[] {
  return ["", "", "", ""];
}

function emptyWindow(): WindowDraft {
  return { localDate: "", startLocal: "", endLocal: "" };
}

function emptyStep(): StepDraft {
  return { name: "", options: emptyOptions() };
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

function readPlanId(body: unknown): string | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const id = (body as { id?: unknown }).id;
  if (typeof id !== "string" || id.length === 0) {
    return null;
  }
  return id;
}

function parseCurrencies(body: unknown): CurrencyOption[] | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const list = (body as { currencies?: unknown }).currencies;
  if (!Array.isArray(list) || list.length === 0) {
    return null;
  }
  const currencies: CurrencyOption[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const record = item as { code?: unknown; exponent?: unknown };
    if (typeof record.code !== "string" || record.code.length === 0) {
      continue;
    }
    if (
      typeof record.exponent !== "number" ||
      !Number.isInteger(record.exponent) ||
      record.exponent < 0
    ) {
      continue;
    }
    currencies.push({ code: record.code, exponent: record.exponent });
  }
  return currencies.length > 0 ? currencies : null;
}

function exponentFor(
  currencies: readonly CurrencyOption[],
  code: string,
): number {
  const match = currencies.find((currency) => currency.code === code);
  return match?.exponent ?? DEFAULT_EXPONENT;
}

export function decimalToAmountMinor(
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
  if (
    !Number.isSafeInteger(minor) ||
    minor < 1 ||
    minor > AMOUNT_MINOR_MAX
  ) {
    return null;
  }
  return minor;
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

function CreateFormFields(): ReactNode {
  const router = useRouter();
  const t = useTranslations("Create");
  const tCode = useTranslations("errors.code");
  const tReason = useTranslations("errors.reason");
  const tFields = useTranslations("errors.fields");

  const [title, setTitle] = useState("");
  const [timezone, setTimezone] = useState(environmentTimeZone);
  const [windows, setWindows] = useState<WindowDraft[]>([]);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const [currencies, setCurrencies] = useState<CurrencyOption[]>(DEFAULT_CURRENCIES);
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [threshold, setThreshold] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadCurrencies(): Promise<void> {
      try {
        const response = await fetch("/api/v1/currencies", {
          credentials: "same-origin",
        });
        if (!response.ok || cancelled) {
          return;
        }
        const body = await readJson(response);
        const parsed = parseCurrencies(body);
        if (!cancelled && parsed) {
          setCurrencies(parsed);
        }
      } catch {
        return;
      }
    }

    void loadCurrencies();
    return () => {
      cancelled = true;
    };
  }, []);

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

  function validate(): { fields: FieldError[]; body: Record<string, unknown> | null } {
    const fields: FieldError[] = [];
    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) {
      fields.push({ path: "title", code: "required" });
    } else if (trimmedTitle.length > TITLE_MAX) {
      fields.push({ path: "title", code: "too_long" });
    }

    const trimmedZone = timezone.trim();
    if (trimmedZone.length === 0) {
      fields.push({ path: "timezone", code: "required" });
    }

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
      if (localDate && startMinutes !== null && endMinutes !== null && endMinutes > startMinutes) {
        parsedWindows.push({
          local_date: localDate,
          start_local: startHm,
          end_local: endHm,
        });
      }
    });

    const exponent = exponentFor(currencies, currency);
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

    const trimmedThreshold = threshold.trim();
    let parsedThreshold: number | undefined;
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
      } else {
        parsedThreshold = value;
      }
    }

    if (fields.length > 0) {
      return { fields, body: null };
    }
    if (
      amountMinor === null ||
      parsedThreshold === undefined ||
      parsedWindows.length === 0 ||
      parsedSteps.length === 0
    ) {
      return { fields, body: null };
    }
    return {
      fields,
      body: {
        title: trimmedTitle,
        timezone: trimmedZone,
        windows: parsedWindows,
        budget: { amount_minor: amountMinor, currency },
        steps: parsedSteps,
        threshold: parsedThreshold,
      },
    };
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    setFieldErrors([]);

    const checked = validate();
    if (!checked.body) {
      setFieldErrors(checked.fields);
      setFormError(
        tCode.has("validation_failed")
          ? tCode("validation_failed")
          : t("saveError"),
      );
      setSubmitting(false);
      return;
    }

    try {
      const response = await fetch("/api/v1/plans", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-HP-Request": "1",
        },
        body: JSON.stringify(checked.body),
      });
      const payload = await readJson(response);
      if (response.ok) {
        const id = readPlanId(payload);
        if (id) {
          router.push(`/plans/${id}`);
          return;
        }
        setFormError(t("saveError"));
        setSubmitting(false);
        return;
      }
      const parsed = parseError(payload);
      setFieldErrors(parsed.fields);
      setFormError(chromeFor(parsed, t("saveError")));
    } catch {
      setFormError(t("saveError"));
    } finally {
      setSubmitting(false);
    }
  }

  function updateWindow(
    index: number,
    patch: Partial<WindowDraft>,
  ): void {
    setWindows((current) =>
      current.map((window, i) => (i === index ? { ...window, ...patch } : window)),
    );
  }

  function updateStep(index: number, patch: Partial<StepDraft>): void {
    setSteps((current) =>
      current.map((step, i) => (i === index ? { ...step, ...patch } : step)),
    );
  }

  function updateOption(stepIndex: number, optionIndex: number, value: string): void {
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
  const amountError = fieldMessage("budget.amount_minor");
  const currencyError = fieldMessage("budget.currency");
  const stepsError = fieldMessage("steps");
  const thresholdError = fieldMessage("threshold");

  return (
    <FormShell>
      <CardHeader>
        <h1 className="title text-foreground text-start text-pretty">
          {t("title")}
        </h1>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
          {formError ? (
            <p className="text-destructive text-start" role="alert">
              {formError}
            </p>
          ) : null}

          <section className="flex flex-col gap-3">
            <h2 className="section text-foreground text-start">
              {t("sectionTitle")}
            </h2>
            <FieldBlock
              id="hp-title"
              label={t("planTitle")}
              errorId="hp-title-error"
              error={titleError}
            >
              <Input
                id="hp-title"
                name="title"
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                aria-invalid={titleError ? true : undefined}
                aria-describedby={titleError ? "hp-title-error" : undefined}
              />
            </FieldBlock>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="section text-foreground text-start">
              {t("sectionWhen")}
            </h2>
            <FieldBlock
              id="hp-timezone"
              label={t("timezone")}
              errorId="hp-timezone-error"
              error={timezoneError}
            >
              <Input
                id="hp-timezone"
                name="timezone"
                type="text"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                aria-invalid={timezoneError ? true : undefined}
                aria-describedby={
                  timezoneError ? "hp-timezone-error" : undefined
                }
              />
            </FieldBlock>
            {windowsError ? (
              <p id="hp-windows-error" className="text-sm text-destructive text-start">
                {windowsError}
              </p>
            ) : null}
            {windows.map((window, index) => {
              const dateError = fieldMessage(`windows[${index}].local_date`);
              const startError = fieldMessage(`windows[${index}].start_local`);
              const endError = fieldMessage(`windows[${index}].end_local`);
              return (
                <div
                  key={index}
                  className="flex flex-col gap-3 rounded-md border border-border p-3"
                >
                  <FieldBlock
                    id={`hp-window-${index}-date`}
                    label={t("date")}
                    errorId={`hp-window-${index}-date-error`}
                    error={dateError}
                  >
                    <Input
                      id={`hp-window-${index}-date`}
                      name={`windows[${index}].local_date`}
                      type="date"
                      value={window.localDate}
                      onChange={(event) =>
                        updateWindow(index, { localDate: event.target.value })
                      }
                      aria-invalid={dateError ? true : undefined}
                      aria-describedby={
                        dateError ? `hp-window-${index}-date-error` : undefined
                      }
                    />
                  </FieldBlock>
                  <FieldBlock
                    id={`hp-window-${index}-start`}
                    label={t("start")}
                    errorId={`hp-window-${index}-start-error`}
                    error={startError}
                  >
                    <Input
                      id={`hp-window-${index}-start`}
                      name={`windows[${index}].start_local`}
                      type="time"
                      value={window.startLocal}
                      onChange={(event) =>
                        updateWindow(index, { startLocal: event.target.value })
                      }
                      aria-invalid={startError ? true : undefined}
                      aria-describedby={
                        startError ? `hp-window-${index}-start-error` : undefined
                      }
                    />
                  </FieldBlock>
                  <FieldBlock
                    id={`hp-window-${index}-end`}
                    label={t("end")}
                    errorId={`hp-window-${index}-end-error`}
                    error={endError}
                  >
                    <Input
                      id={`hp-window-${index}-end`}
                      name={`windows[${index}].end_local`}
                      type="time"
                      value={window.endLocal}
                      onChange={(event) =>
                        updateWindow(index, { endLocal: event.target.value })
                      }
                      aria-invalid={endError ? true : undefined}
                      aria-describedby={
                        endError ? `hp-window-${index}-end-error` : undefined
                      }
                    />
                  </FieldBlock>
                </div>
              );
            })}
            <Button
              type="button"
              variant="secondary"
              className="self-start"
              onClick={() => {
                setWindows((current) =>
                  current.length < WINDOWS_MAX
                    ? [...current, emptyWindow()]
                    : current,
                );
              }}
            >
              {t("addWindow")}
            </Button>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="section text-foreground text-start">
              {t("sectionBudget")}
            </h2>
            <FieldBlock
              id="hp-amount"
              label={t("amount")}
              errorId="hp-amount-error"
              error={amountError}
            >
              <Input
                id="hp-amount"
                name="amount"
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                aria-invalid={amountError ? true : undefined}
                aria-describedby={amountError ? "hp-amount-error" : undefined}
              />
            </FieldBlock>
            <FieldBlock
              id="hp-currency"
              label={t("currency")}
              errorId="hp-currency-error"
              error={currencyError}
            >
              <select
                id="hp-currency"
                name="currency"
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
                aria-invalid={currencyError ? true : undefined}
                aria-describedby={
                  currencyError ? "hp-currency-error" : undefined
                }
                className={selectClassName}
              >
                {currencies.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.code}
                  </option>
                ))}
              </select>
            </FieldBlock>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="section text-foreground text-start">
              {t("sectionSteps")}
            </h2>
            {stepsError ? (
              <p id="hp-steps-error" className="text-sm text-destructive text-start">
                {stepsError}
              </p>
            ) : null}
            {steps.map((step, index) => {
              const nameError = fieldMessage(`steps[${index}].name`);
              const optionsError = fieldMessage(`steps[${index}].options`);
              return (
                <div
                  key={index}
                  className="flex flex-col gap-3 rounded-md border border-border p-3"
                >
                  <FieldBlock
                    id={`hp-step-${index}-name`}
                    label={t("stepName")}
                    errorId={`hp-step-${index}-name-error`}
                    error={nameError}
                  >
                    <Input
                      id={`hp-step-${index}-name`}
                      name={`steps[${index}].name`}
                      type="text"
                      value={step.name}
                      onChange={(event) =>
                        updateStep(index, { name: event.target.value })
                      }
                      aria-invalid={nameError ? true : undefined}
                      aria-describedby={
                        nameError ? `hp-step-${index}-name-error` : undefined
                      }
                    />
                  </FieldBlock>
                  {optionsError ? (
                    <p className="text-sm text-destructive text-start">
                      {optionsError}
                    </p>
                  ) : null}
                  {step.options.map((option, optionIndex) => {
                    const optionError = fieldMessage(
                      `steps[${index}].options[${optionIndex}]`,
                    );
                    return (
                      <FieldBlock
                        key={optionIndex}
                        id={`hp-step-${index}-option-${optionIndex}`}
                        label={t("optionLabel")}
                        errorId={`hp-step-${index}-option-${optionIndex}-error`}
                        error={optionError}
                      >
                        <Input
                          id={`hp-step-${index}-option-${optionIndex}`}
                          name={`steps[${index}].options[${optionIndex}]`}
                          type="text"
                          value={option}
                          onChange={(event) =>
                            updateOption(index, optionIndex, event.target.value)
                          }
                          aria-invalid={optionError ? true : undefined}
                          aria-describedby={
                            optionError
                              ? `hp-step-${index}-option-${optionIndex}-error`
                              : undefined
                          }
                        />
                      </FieldBlock>
                    );
                  })}
                </div>
              );
            })}
            <Button
              type="button"
              variant="secondary"
              className="self-start"
              onClick={() => {
                setSteps((current) =>
                  current.length < STEPS_MAX ? [...current, emptyStep()] : current,
                );
              }}
            >
              {t("addStep")}
            </Button>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="section text-foreground text-start">
              {t("sectionThreshold")}
            </h2>
            <FieldBlock
              id="hp-threshold"
              label={t("threshold")}
              errorId="hp-threshold-error"
              error={thresholdError}
            >
              <Input
                id="hp-threshold"
                name="threshold"
                type="text"
                inputMode="numeric"
                value={threshold}
                onChange={(event) => setThreshold(event.target.value)}
                aria-invalid={thresholdError ? true : undefined}
                aria-describedby={
                  thresholdError ? "hp-threshold-error" : undefined
                }
              />
            </FieldBlock>
          </section>

          <Button
            type="submit"
            disabled={submitting}
            className="self-start bg-primary"
          >
            {t("submit")}
          </Button>
        </form>
      </CardContent>
    </FormShell>
  );
}

function CreateFormRoot(): ReactNode {
  const t = useTranslations("Create");
  const [session, setSession] = useState<SessionState>("checking");

  useEffect(() => {
    let cancelled = false;

    async function loadMe(): Promise<void> {
      try {
        const response = await fetch("/api/v1/me", { credentials: "same-origin" });
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          setSession("signed_out");
          return;
        }
        setSession("signed_in");
      } catch {
        if (!cancelled) {
          setSession("signed_out");
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
      <LanguageControl>
        <FormShell>
          <CardHeader>
            <h1 className="title text-foreground text-start text-pretty">
              {t("title")}
            </h1>
          </CardHeader>
        </FormShell>
      </LanguageControl>
    );
  }

  if (session === "signed_out") {
    return <AccountGate next="/plans/new" />;
  }

  return (
    <LanguageControl>
      <CreateFormFields />
    </LanguageControl>
  );
}

export function CreateForm(): ReactNode {
  return <CreateFormRoot />;
}
