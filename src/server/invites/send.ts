import type { PlanRole } from "../auth/authorize";
import { httpError, type ErrorField, type HttpError } from "../http/errors";
import { isDistinguisher } from "../ids";
import { allocateDistinguisher } from "../join/open";

export const EMAIL_MAX = 254;

export const INVITATION_STATUSES = ["invited", "joined", "answered"] as const;

export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export type SentInvitation = {
  display_name: string;
  distinguisher: string;
  status: InvitationStatus;
};

export type InviteReadBody = {
  join_path: string;
  invitations: SentInvitation[];
};

export type ParsedInviteEmail =
  | { ok: true; email: string }
  | { ok: false; fields: ErrorField[] };

export type SendInviteDecision =
  | { action: "locked" }
  | { action: "invalid"; fields: ErrorField[] }
  | { action: "unknown" }
  | { action: "self" }
  | { action: "proceed"; email: string };

function emailShape(email: string): boolean {
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@")) {
    return false;
  }
  const domain = email.slice(at + 1);
  if (domain.length === 0 || /\s/.test(email)) {
    return false;
  }
  if (domain.startsWith(".") || domain.endsWith(".")) {
    return false;
  }
  const labels = domain.split(".");
  if (labels.length < 2) {
    return false;
  }
  return labels.every((label) => label.length > 0);
}

export function parseInviteEmail(value: unknown): ParsedInviteEmail {
  if (typeof value !== "string") {
    return { ok: false, fields: [{ path: "email", code: "required" }] };
  }
  const email = value.trim().toLowerCase();
  if (email.length === 0) {
    return { ok: false, fields: [{ path: "email", code: "required" }] };
  }
  if (email.length > EMAIL_MAX) {
    return { ok: false, fields: [{ path: "email", code: "too_long" }] };
  }
  if (!emailShape(email)) {
    return { ok: false, fields: [{ path: "email", code: "bad_email" }] };
  }
  return { ok: true, email };
}

export function invitationStatus(input: {
  hasParticipant: boolean;
  responseComplete: boolean;
}): InvitationStatus {
  if (!input.hasParticipant) {
    return "invited";
  }
  if (input.responseComplete) {
    return "answered";
  }
  return "joined";
}

export function sentInvitation(input: {
  displayName: string;
  distinguisher: string;
  hasParticipant: boolean;
  responseComplete: boolean;
}): SentInvitation {
  return {
    display_name: input.displayName,
    distinguisher: input.distinguisher,
    status: invitationStatus({
      hasParticipant: input.hasParticipant,
      responseComplete: input.responseComplete,
    }),
  };
}

export function invitationDistinguisher(input: {
  participantDistinguisher: string | null;
  taken: ReadonlySet<string>;
  generate?: () => string;
}): string {
  if (
    input.participantDistinguisher !== null &&
    isDistinguisher(input.participantDistinguisher)
  ) {
    return input.participantDistinguisher;
  }
  return allocateDistinguisher(input.taken, input.generate);
}

export function inviteJoinPath(joinToken: string): string {
  return `/join/${joinToken}`;
}

export function inviteReadBody(
  joinToken: string,
  invitations: readonly SentInvitation[],
): InviteReadBody {
  return {
    join_path: inviteJoinPath(joinToken),
    invitations: invitations.map((row) => ({
      display_name: row.display_name,
      distinguisher: row.distinguisher,
      status: row.status,
    })),
  };
}

export function sendInviteDecision(input: {
  locked: boolean;
  email: unknown;
  organizerAccountId: string;
  matchedAccount: { id: string } | null;
}): SendInviteDecision {
  if (input.locked) {
    return { action: "locked" };
  }
  const parsed = parseInviteEmail(input.email);
  if (!parsed.ok) {
    return { action: "invalid", fields: parsed.fields };
  }
  if (input.matchedAccount === null) {
    return { action: "unknown" };
  }
  if (input.matchedAccount.id === input.organizerAccountId) {
    return { action: "self" };
  }
  return { action: "proceed", email: parsed.email };
}

export function inviteCallerError(role: PlanRole | null): HttpError | null {
  if (role === "organizer") {
    return null;
  }
  if (role === "participant" || role === "invited" || role === "link_reader") {
    return httpError(403, {
      reason: "organizer_only",
      message: "organizer only",
    });
  }
  return httpError(404, { message: "plan not found" });
}

export function accountNotFoundError(): HttpError {
  return httpError(404, {
    reason: "account_not_found",
    message: "invite email is not registered",
  });
}

export function cannotInviteSelfError(): HttpError {
  return httpError(409, {
    reason: "cannot_invite_self",
    message: "cannot invite the organizer",
  });
}

export function planLockedInviteError(): HttpError {
  return httpError(409, {
    reason: "plan_locked",
    message: "plan is locked",
  });
}
