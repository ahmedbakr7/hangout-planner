"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import React, { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { LanguageControl } from "@/components/language-control";

const JOIN_NEXT = /^\/join\/jt_[A-Za-z0-9-_]{43}$/;
const FIXED_NEXT = new Set(["/", "/plans/new", "/invitations"]);

type Mode = "signIn" | "register";
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

export type AccountGateProps = {
  next?: string;
};

export function allowedNextPath(value: string | undefined): string {
  if (typeof value !== "string") {
    return "/";
  }
  if (FIXED_NEXT.has(value)) {
    return value;
  }
  if (JOIN_NEXT.test(value)) {
    return value;
  }
  return "/";
}

export function isJoinNextPath(value: string | undefined): boolean {
  return typeof value === "string" && JOIN_NEXT.test(value);
}

const stackStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-md)",
  alignItems: "stretch",
};

const fieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2xs)",
  alignItems: "stretch",
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

const primaryButtonStyle: CSSProperties = {
  backgroundColor: "var(--accent)",
  color: "var(--surface)",
  border: "none",
  borderRadius: "var(--radius-sm)",
  paddingBlock: "var(--space-xs)",
  paddingInline: "var(--space-md)",
  font: "inherit",
  cursor: "pointer",
  alignSelf: "start",
};

const tabStyle: CSSProperties = {
  backgroundColor: "var(--surface)",
  color: "var(--text)",
  border: "var(--focus-ring-width) solid var(--border)",
  borderRadius: "var(--radius-sm)",
  paddingBlock: "var(--space-xs)",
  paddingInline: "var(--space-md)",
  font: "inherit",
  cursor: "pointer",
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

function readDisplayName(body: unknown): string | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const account = (body as { account?: unknown }).account;
  if (typeof account !== "object" || account === null) {
    return null;
  }
  const name = (account as { display_name?: unknown }).display_name;
  if (typeof name !== "string" || name.length === 0) {
    return null;
  }
  return name;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function AccountGateBody({ next }: AccountGateProps): ReactNode {
  const router = useRouter();
  const t = useTranslations("Account");
  const tReason = useTranslations("errors.reason");
  const tCode = useTranslations("errors.code");
  const tFields = useTranslations("errors.fields");

  const [session, setSession] = useState<SessionState>("checking");
  const [displayName, setDisplayName] = useState("");
  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [registerName, setRegisterName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const destination = allowedNextPath(next);
  const joinPath = isJoinNextPath(next) ? next : null;

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
          return;
        }
        const body = await readJson(response);
        const name = readDisplayName(body);
        if (cancelled) {
          return;
        }
        if (!name) {
          setSession("signed_out");
          return;
        }
        setDisplayName(name);
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

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    setFieldErrors([]);

    const fallback =
      mode === "signIn" ? t("signInError") : t("registerError");
    const path = mode === "signIn" ? "/v1/sessions" : "/v1/accounts";
    const body =
      mode === "signIn"
        ? { email, password }
        : { email, password, display_name: registerName };

    try {
      const response = await fetch(path, {
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
        const name = readDisplayName(payload);
        if (name) {
          setDisplayName(name);
        }
        setPassword("");
        setSession("signed_in");
        router.push(destination);
        return;
      }
      const parsed = parseError(payload);
      setSession("signed_out");
      setPassword("");
      setFieldErrors(parsed.fields);
      setFormError(chromeFor(parsed, fallback));
    } catch {
      setSession("signed_out");
      setPassword("");
      setFormError(fallback);
    } finally {
      setSubmitting(false);
    }
  }

  if (session === "checking") {
    return (
      <main className="surface" style={stackStyle}>
        <h1 className="title">{t("title")}</h1>
      </main>
    );
  }

  if (session === "signed_in") {
    return (
      <main className="surface" style={stackStyle}>
        <h1 className="title">{t("title")}</h1>
        <p className="body">{t("signedInAs", { name: displayName })}</p>
        <a href="/">{t("goHome")}</a>
      </main>
    );
  }

  const emailError = fieldMessage("email");
  const passwordError = fieldMessage("password");
  const nameError = fieldMessage("display_name");

  return (
    <main className="surface" style={stackStyle}>
      <h1 className="title">{t("title")}</h1>
      <p className="body">{t("requiredToOrganize")}</p>
      {joinPath ? <a href={joinPath}>{t("joinWithoutAccount")}</a> : null}

      <div role="tablist" style={{ display: "flex", gap: "var(--space-xs)" }}>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "signIn"}
          onClick={() => {
            setMode("signIn");
            setFormError(null);
            setFieldErrors([]);
          }}
          style={tabStyle}
        >
          {t("signIn")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "register"}
          onClick={() => {
            setMode("register");
            setFormError(null);
            setFieldErrors([]);
          }}
          style={tabStyle}
        >
          {t("register")}
        </button>
      </div>

      <form onSubmit={onSubmit} style={stackStyle}>
        {formError ? (
          <p className="danger" role="alert">
            {formError}
          </p>
        ) : null}

        <div style={fieldStyle}>
          <label htmlFor="hp-email">{t("email")}</label>
          <input
            id="hp-email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? "hp-email-error" : undefined}
            style={inputStyle}
          />
          {emailError ? (
            <p id="hp-email-error" className="danger">
              {emailError}
            </p>
          ) : null}
        </div>

        <div style={fieldStyle}>
          <label htmlFor="hp-password">{t("password")}</label>
          <input
            id="hp-password"
            name="password"
            type="password"
            autoComplete={mode === "signIn" ? "current-password" : "new-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={passwordError ? true : undefined}
            aria-describedby={passwordError ? "hp-password-error" : undefined}
            style={inputStyle}
          />
          {passwordError ? (
            <p id="hp-password-error" className="danger">
              {passwordError}
            </p>
          ) : null}
        </div>

        {mode === "register" ? (
          <div style={fieldStyle}>
            <label htmlFor="hp-display-name">{t("displayName")}</label>
            <input
              id="hp-display-name"
              name="display_name"
              type="text"
              autoComplete="nickname"
              value={registerName}
              onChange={(event) => setRegisterName(event.target.value)}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? "hp-display-name-error" : undefined}
              style={inputStyle}
            />
            {nameError ? (
              <p id="hp-display-name-error" className="danger">
                {nameError}
              </p>
            ) : null}
          </div>
        ) : null}

        <button type="submit" disabled={submitting} style={primaryButtonStyle}>
          {mode === "signIn" ? t("submitSignIn") : t("submitRegister")}
        </button>
      </form>
    </main>
  );
}

export function AccountGate({ next }: AccountGateProps): ReactNode {
  return (
    <LanguageControl>
      <AccountGateBody next={next} />
    </LanguageControl>
  );
}
