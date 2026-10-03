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

const OPENING_NEXTS = [
  "organizer",
  "respond",
  "proposal",
  "confirmed",
  "join",
] as const;

type OpeningNext = (typeof OPENING_NEXTS)[number];
type InvitationStatus = "invited" | "joined" | "answered";
type SessionState = "checking" | "signed_out" | "signed_in";
type InviteLoadState = "loading" | "loaded" | "error" | "locked";
type InboxLoadState = "idle" | "loading" | "loaded" | "error";

type FieldError = {
  path: string;
  code: string;
};

type ParsedError = {
  code?: string;
  reason?: string;
  fields: FieldError[];
};

type SentInvitation = {
  displayName: string;
  distinguisher: string;
  status: InvitationStatus;
};

type InboxInvitation = {
  planId: string;
  title: string;
  organizerDisplayName: string;
  next: OpeningNext | null;
};

export type InvitePanelProps = {
  planId: string;
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

function isInvitationStatus(value: unknown): value is InvitationStatus {
  return value === "invited" || value === "joined" || value === "answered";
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

function isPlanLockedResponse(status: number, body: unknown): boolean {
  return status === 409 && parseError(body).reason === "plan_locked";
}

function parseSentInvitation(value: unknown): SentInvitation | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as {
    display_name?: unknown;
    distinguisher?: unknown;
    status?: unknown;
  };
  if (typeof record.display_name !== "string") {
    return null;
  }
  if (!isInvitationStatus(record.status)) {
    return null;
  }
  return {
    displayName: record.display_name,
    distinguisher:
      typeof record.distinguisher === "string" ? record.distinguisher : "",
    status: record.status,
  };
}

function parseSentInvitations(value: unknown): SentInvitation[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const rows: SentInvitation[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const parsed = parseSentInvitation(item);
    if (!parsed) {
      continue;
    }
    const key =
      parsed.distinguisher.length > 0
        ? `d:${parsed.distinguisher}`
        : `n:${parsed.displayName}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    rows.push(parsed);
  }
  return rows;
}

function parseInviteBody(
  value: unknown,
): { joinPath: string; invitations: SentInvitation[] } | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as { join_path?: unknown; invitations?: unknown };
  if (typeof record.join_path !== "string" || !record.join_path.startsWith("/")) {
    return null;
  }
  const invitations = parseSentInvitations(record.invitations);
  if (!invitations) {
    return null;
  }
  return { joinPath: record.join_path, invitations };
}

function parseInboxInvitation(value: unknown): InboxInvitation | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as {
    plan_id?: unknown;
    title?: unknown;
    organizer_display_name?: unknown;
    next?: unknown;
  };
  if (typeof record.plan_id !== "string" || record.plan_id.length === 0) {
    return null;
  }
  if (typeof record.title !== "string") {
    return null;
  }
  if (typeof record.organizer_display_name !== "string") {
    return null;
  }
  return {
    planId: record.plan_id,
    title: record.title,
    organizerDisplayName: record.organizer_display_name,
    next: isOpeningNext(record.next) ? record.next : null,
  };
}

function parseInbox(body: unknown): InboxInvitation[] | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const invitations = (body as { invitations?: unknown }).invitations;
  if (!Array.isArray(invitations)) {
    return null;
  }
  const rows: InboxInvitation[] = [];
  const seen = new Set<string>();
  for (const item of invitations) {
    const parsed = parseInboxInvitation(item);
    if (!parsed) {
      continue;
    }
    if (seen.has(parsed.planId)) {
      continue;
    }
    seen.add(parsed.planId);
    rows.push(parsed);
  }
  return rows;
}

function parseOpening(
  value: unknown,
): { planId: string; next: OpeningNext } | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as { plan_id?: unknown; next?: unknown };
  if (typeof record.plan_id !== "string" || record.plan_id.length === 0) {
    return null;
  }
  if (!isOpeningNext(record.next)) {
    return null;
  }
  return { planId: record.plan_id, next: record.next };
}

function hrefForInvitationNext(planId: string, next: OpeningNext): string {
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
  return `/plans/${planId}/join`;
}

function shareUrlFromJoinPath(joinPath: string): string {
  if (joinPath.startsWith("http://") || joinPath.startsWith("https://")) {
    return joinPath;
  }
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}${joinPath}`;
}

function foldDisplayName(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase();
}

function collidingNameKeys(
  invitations: readonly SentInvitation[],
): Set<string> {
  const counts = new Map<string, number>();
  for (const invitation of invitations) {
    const key = foldDisplayName(invitation.displayName);
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

function upsertSentInvitation(
  list: readonly SentInvitation[],
  row: SentInvitation,
): SentInvitation[] {
  const matchIndex = list.findIndex((item) => {
    if (row.distinguisher.length > 0 && item.distinguisher.length > 0) {
      return item.distinguisher === row.distinguisher;
    }
    return foldDisplayName(item.displayName) === foldDisplayName(row.displayName);
  });
  if (matchIndex < 0) {
    return [...list, row];
  }
  const next = list.slice();
  next[matchIndex] = row;
  return next;
}

function statusClassName(status: InvitationStatus): string {
  if (status === "answered") {
    return "text-success";
  }
  if (status === "joined") {
    return "text-warning";
  }
  return "text-muted-foreground";
}

function statusLabelFor(
  status: InvitationStatus,
  t: (key: string) => string,
): string {
  if (status === "joined") {
    return t("statusJoined");
  }
  if (status === "answered") {
    return t("statusAnswered");
  }
  return t("statusInvited");
}

function PanelShell({ children }: { children: ReactNode }): ReactNode {
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

function InvitePanelBody({ planId }: InvitePanelProps): ReactNode {
  const router = useRouter();
  const t = useTranslations("invite");
  const tCommon = useTranslations("common");
  const tReason = useTranslations("errors.reason");
  const tCode = useTranslations("errors.code");
  const tFields = useTranslations("errors.fields");

  const [load, setLoad] = useState<InviteLoadState>("loading");
  const [joinPath, setJoinPath] = useState<string | null>(null);
  const [invitations, setInvitations] = useState<SentInvitation[]>([]);
  const [email, setEmail] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function clearInviteData(): void {
    setJoinPath(null);
    setInvitations([]);
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

  function leaveLocked(): void {
    clearInviteData();
    setFormError(null);
    setCopyError(null);
    setFieldErrors([]);
    setLoad("locked");
    router.replace(`/plans/${planId}/confirmed`);
  }

  async function loadInvite(): Promise<void> {
    setLoad("loading");
    clearInviteData();
    setFormError(null);
    setCopyError(null);
    setFieldErrors([]);
    try {
      const response = await fetch(`/api/v1/plans/${planId}/invite`, {
        credentials: "same-origin",
      });
      const body = await readJson(response);
      if (isPlanLockedResponse(response.status, body)) {
        leaveLocked();
        return;
      }
      if (!response.ok) {
        clearInviteData();
        setLoad("error");
        return;
      }
      const parsed = parseInviteBody(body);
      if (!parsed) {
        clearInviteData();
        setLoad("error");
        return;
      }
      setJoinPath(parsed.joinPath);
      setInvitations(parsed.invitations);
      setLoad("loaded");
    } catch {
      clearInviteData();
      setLoad("error");
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function start(): Promise<void> {
      setLoad("loading");
      setJoinPath(null);
      setInvitations([]);
      setFormError(null);
      setCopyError(null);
      setFieldErrors([]);
      try {
        const response = await fetch(`/api/v1/plans/${planId}/invite`, {
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
          setJoinPath(null);
          setInvitations([]);
          setLoad("locked");
          router.replace(`/plans/${planId}/confirmed`);
          return;
        }
        if (!response.ok) {
          setJoinPath(null);
          setInvitations([]);
          setLoad("error");
          return;
        }
        const parsed = parseInviteBody(body);
        if (!parsed) {
          setJoinPath(null);
          setInvitations([]);
          setLoad("error");
          return;
        }
        setJoinPath(parsed.joinPath);
        setInvitations(parsed.invitations);
        setLoad("loaded");
      } catch {
        if (!cancelled) {
          setJoinPath(null);
          setInvitations([]);
          setLoad("error");
        }
      }
    }

    void start();
    return () => {
      cancelled = true;
    };
  }, [planId, router]);

  async function onCopy(): Promise<void> {
    if (!joinPath) {
      return;
    }
    const shareUrl = shareUrlFromJoinPath(joinPath);
    setCopyError(null);
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
        throw new Error("clipboard unavailable");
      }
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      setCopyError(t("copyFailed"));
    }
  }

  async function onSend(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    setFieldErrors([]);
    try {
      const response = await fetch(`/api/v1/plans/${planId}/invitations`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-HP-Request": "1",
        },
        body: JSON.stringify({ email }),
      });
      const payload = await readJson(response);
      if (isPlanLockedResponse(response.status, payload)) {
        leaveLocked();
        return;
      }
      if (response.ok) {
        const row = parseSentInvitation(payload);
        if (!row) {
          setFormError(t("sendFailed"));
          return;
        }
        setInvitations((current) => upsertSentInvitation(current, row));
        setEmail("");
        return;
      }
      const parsed = parseError(payload);
      setFieldErrors(parsed.fields);
      if (parsed.reason === "account_not_found") {
        setFormError(chromeFor(parsed, t("identifyFailed")));
      } else {
        setFormError(chromeFor(parsed, t("sendFailed")));
      }
    } catch {
      setFormError(t("sendFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  const emailError = fieldMessage("email");

  if (load === "error") {
    return (
      <PanelShell>
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
            onClick={() => void loadInvite()}
          >
            {tCommon("retry")}
          </Button>
        </CardContent>
      </PanelShell>
    );
  }

  if (load !== "loaded" || !joinPath) {
    return (
      <PanelShell>
        <CardHeader>
          <h1 className="title text-foreground text-start text-pretty">
            {t("title")}
          </h1>
        </CardHeader>
      </PanelShell>
    );
  }

  const shareUrl = shareUrlFromJoinPath(joinPath);
  const colliding = collidingNameKeys(invitations);

  return (
    <PanelShell>
      <CardHeader className="gap-3">
        <h1 className="title text-foreground text-start text-pretty">
          {t("title")}
        </h1>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <h2 className="section text-foreground text-start">{t("linkLabel")}</h2>
          <p className="body text-foreground text-start break-all">{shareUrl}</p>
          <Button
            type="button"
            variant="secondary"
            className="self-start"
            onClick={() => void onCopy()}
          >
            {t("copy")}
          </Button>
          {copyError ? (
            <p className="text-destructive text-start" role="alert">
              {copyError}
            </p>
          ) : null}
        </section>

        <section className="flex flex-col gap-4">
          {formError ? (
            <p className="text-destructive text-start" role="alert">
              {formError}
            </p>
          ) : null}

          <form onSubmit={onSend} className="flex flex-col gap-4" noValidate>
            <FieldBlock
              id="hp-invite-email"
              label={t("email")}
              errorId="hp-invite-email-error"
              error={emailError}
            >
              <Input
                id="hp-invite-email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-invalid={emailError ? true : undefined}
                aria-describedby={emailError ? "hp-invite-email-error" : undefined}
              />
            </FieldBlock>
            <Button
              type="submit"
              disabled={submitting}
              className="self-start bg-primary"
            >
              {t("send")}
            </Button>
          </form>

          {invitations.length === 0 ? (
            <p className="body text-muted-foreground text-start text-pretty">
              {t("emptySent")}
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {invitations.map((invitation) => {
                const showDistinguisher =
                  invitation.distinguisher.length > 0 &&
                  colliding.has(foldDisplayName(invitation.displayName));
                return (
                  <li
                    key={
                      invitation.distinguisher.length > 0
                        ? invitation.distinguisher
                        : invitation.displayName
                    }
                    className="flex flex-col items-start gap-1"
                  >
                    <span className="body text-foreground text-start">
                      {invitation.displayName}
                    </span>
                    {showDistinguisher ? (
                      <span className="caption text-muted-foreground text-start">
                        {invitation.distinguisher}
                      </span>
                    ) : null}
                    <span
                      className={`caption text-start ${statusClassName(invitation.status)}`}
                    >
                      {statusLabelFor(invitation.status, t)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </CardContent>
    </PanelShell>
  );
}

export function InvitePanel({ planId }: InvitePanelProps): ReactNode {
  return (
    <LanguageControl>
      <InvitePanelBody planId={planId} />
    </LanguageControl>
  );
}

function InvitationsListBody(): ReactNode {
  const router = useRouter();
  const t = useTranslations("invitations");
  const [load, setLoad] = useState<InboxLoadState>("loading");
  const [invitations, setInvitations] = useState<InboxInvitation[]>([]);
  const [openError, setOpenError] = useState<string | null>(null);

  async function loadInbox(): Promise<void> {
    setLoad("loading");
    setInvitations([]);
    setOpenError(null);
    try {
      const response = await fetch("/api/v1/invitations", {
        credentials: "same-origin",
      });
      if (!response.ok) {
        setInvitations([]);
        setLoad("error");
        return;
      }
      const body = await readJson(response);
      const rows = parseInbox(body);
      if (!rows) {
        setInvitations([]);
        setLoad("error");
        return;
      }
      setInvitations(rows);
      setLoad("loaded");
    } catch {
      setInvitations([]);
      setLoad("error");
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function start(): Promise<void> {
      setLoad("loading");
      setInvitations([]);
      setOpenError(null);
      try {
        const response = await fetch("/api/v1/invitations", {
          credentials: "same-origin",
        });
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          setInvitations([]);
          setLoad("error");
          return;
        }
        const body = await readJson(response);
        if (cancelled) {
          return;
        }
        const rows = parseInbox(body);
        if (!rows) {
          setInvitations([]);
          setLoad("error");
          return;
        }
        setInvitations(rows);
        setLoad("loaded");
      } catch {
        if (!cancelled) {
          setInvitations([]);
          setLoad("error");
        }
      }
    }

    void start();
    return () => {
      cancelled = true;
    };
  }, []);

  async function openInvitation(row: InboxInvitation): Promise<void> {
    setOpenError(null);
    if (row.next) {
      router.push(hrefForInvitationNext(row.planId, row.next));
      return;
    }
    try {
      const response = await fetch(`/api/v1/plans/${row.planId}/opening`, {
        credentials: "same-origin",
      });
      if (!response.ok) {
        setOpenError(t("loadError"));
        return;
      }
      const body = await readJson(response);
      const parsed = parseOpening(body);
      if (!parsed) {
        setOpenError(t("loadError"));
        return;
      }
      router.push(hrefForInvitationNext(parsed.planId, parsed.next));
    } catch {
      setOpenError(t("loadError"));
    }
  }

  if (load === "error") {
    return (
      <PanelShell>
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
            onClick={() => void loadInbox()}
          >
            {t("retry")}
          </Button>
        </CardContent>
      </PanelShell>
    );
  }

  if (load !== "loaded") {
    return (
      <PanelShell>
        <CardHeader>
          <h1 className="title text-foreground text-start text-pretty">
            {t("title")}
          </h1>
        </CardHeader>
      </PanelShell>
    );
  }

  return (
    <PanelShell>
      <CardHeader className="gap-3">
        <h1 className="title text-foreground text-start text-pretty">
          {t("title")}
        </h1>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Button variant="link" asChild className="h-auto self-start p-0">
          <a href="/">{t("goHome")}</a>
        </Button>

        {openError ? (
          <p className="text-destructive text-start" role="alert">
            {openError}
          </p>
        ) : null}

        {invitations.length === 0 ? (
          <p className="body text-muted-foreground text-start text-pretty">
            {t("empty")}
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {invitations.map((row) => (
              <li key={row.planId}>
                <button
                  type="button"
                  className="flex w-full flex-col gap-1 rounded-md border border-border bg-card p-3 text-foreground text-start"
                  onClick={() => void openInvitation(row)}
                >
                  <span className="body text-foreground text-start">
                    {row.title}
                  </span>
                  <span className="caption text-muted-foreground text-start">
                    {t("organizedBy", { name: row.organizerDisplayName })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </PanelShell>
  );
}

function InvitationsListRoot(): ReactNode {
  const t = useTranslations("invitations");
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

  if (session === "signed_out") {
    return <AccountGate next="/invitations" />;
  }

  if (session === "checking") {
    return (
      <LanguageControl>
        <PanelShell>
          <CardHeader>
            <h1 className="title text-foreground text-start text-pretty">
              {t("title")}
            </h1>
          </CardHeader>
        </PanelShell>
      </LanguageControl>
    );
  }

  return (
    <LanguageControl>
      <InvitationsListBody />
    </LanguageControl>
  );
}

export function InvitationsList(): ReactNode {
  return <InvitationsListRoot />;
}
