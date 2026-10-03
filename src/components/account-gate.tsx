"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
  CardDescription,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

function GateShell({ children }: { children: ReactNode }): ReactNode {
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
        const response = await fetch("/api/v1/me", { credentials: "same-origin" });
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
    const path = mode === "signIn" ? "/api/v1/sessions" : "/api/v1/accounts";
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
      <GateShell>
        <CardHeader>
          <h1 className="title text-foreground text-start text-pretty">
            {t("title")}
          </h1>
        </CardHeader>
      </GateShell>
    );
  }

  if (session === "signed_in") {
    return (
      <GateShell>
        <CardHeader className="gap-3">
          <h1 className="title text-foreground text-start text-pretty">
            {t("title")}
          </h1>
          <p className="body text-foreground text-start text-pretty">
            {t("signedInAs", { name: displayName })}
          </p>
        </CardHeader>
        <CardFooter>
          <Button asChild className="bg-primary">
            <a href="/">{t("goHome")}</a>
          </Button>
        </CardFooter>
      </GateShell>
    );
  }

  const emailError = fieldMessage("email");
  const passwordError = fieldMessage("password");
  const nameError = fieldMessage("display_name");

  return (
    <GateShell>
      <CardHeader className="gap-3">
        <h1 className="title text-foreground text-start text-pretty">
          {t("title")}
        </h1>
        <CardDescription className="body text-muted-foreground text-start text-pretty">
          {t("requiredToOrganize")}
        </CardDescription>
        {joinPath ? (
          <Button variant="link" asChild className="h-auto self-start p-0">
            <a href={joinPath}>{t("joinWithoutAccount")}</a>
          </Button>
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div role="tablist" className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            role="tab"
            variant={mode === "signIn" ? "secondary" : "outline"}
            aria-selected={mode === "signIn"}
            onClick={() => {
              setMode("signIn");
              setFormError(null);
              setFieldErrors([]);
            }}
          >
            {t("signIn")}
          </Button>
          <Button
            type="button"
            role="tab"
            variant={mode === "register" ? "secondary" : "outline"}
            aria-selected={mode === "register"}
            onClick={() => {
              setMode("register");
              setFormError(null);
              setFieldErrors([]);
            }}
          >
            {t("register")}
          </Button>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {formError ? (
            <p className="text-destructive text-start" role="alert">
              {formError}
            </p>
          ) : null}

          <FieldBlock
            id="hp-email"
            label={t("email")}
            errorId="hp-email-error"
            error={emailError}
          >
            <Input
              id="hp-email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? "hp-email-error" : undefined}
            />
          </FieldBlock>

          <FieldBlock
            id="hp-password"
            label={t("password")}
            errorId="hp-password-error"
            error={passwordError}
          >
            <Input
              id="hp-password"
              name="password"
              type="password"
              autoComplete={
                mode === "signIn" ? "current-password" : "new-password"
              }
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={passwordError ? true : undefined}
              aria-describedby={passwordError ? "hp-password-error" : undefined}
            />
          </FieldBlock>

          {mode === "register" ? (
            <FieldBlock
              id="hp-display-name"
              label={t("displayName")}
              errorId="hp-display-name-error"
              error={nameError}
            >
              <Input
                id="hp-display-name"
                name="display_name"
                type="text"
                autoComplete="nickname"
                value={registerName}
                onChange={(event) => setRegisterName(event.target.value)}
                aria-invalid={nameError ? true : undefined}
                aria-describedby={
                  nameError ? "hp-display-name-error" : undefined
                }
              />
            </FieldBlock>
          ) : null}

          <Button
            type="submit"
            disabled={submitting}
            className="self-start bg-primary"
          >
            {mode === "signIn" ? t("submitSignIn") : t("submitRegister")}
          </Button>
        </form>
      </CardContent>
    </GateShell>
  );
}

export function AccountGate({ next }: AccountGateProps): ReactNode {
  return (
    <LanguageControl>
      <AccountGateBody next={next} />
    </LanguageControl>
  );
}
