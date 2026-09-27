import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { and, count, eq, gt, inArray } from "drizzle-orm";
import { errorResponse } from "@/server/auth/http";
import { now } from "@/server/clock";
import {
  plans,
  proposalAlternatives,
  proposalCandidates,
  proposalCohort,
  proposalLegs,
  proposalRuns,
  proposalSteps,
  proposals,
  stepSignals,
} from "@/server/db/schema";
import type { GoogleClientOptions } from "@/server/google/places";
import { httpError } from "@/server/http/errors";
import { db } from "@/server/plans/http";
import {
  runProposalAttempt,
  type ProposalAttemptResult,
} from "@/server/proposal/attempt";

export const PROPOSAL_ATTEMPT_HOUR_CAP = 20;
export const PROPOSAL_ATTEMPT_HOUR_MS = 60 * 60 * 1000;

type Database = ReturnType<typeof db>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

let proposalAttemptGoogle: GoogleClientOptions | undefined;

export function setProposalAttemptGoogleOptions(
  options: GoogleClientOptions | undefined,
): void {
  proposalAttemptGoogle = options;
}

export type TriggeredAttemptResult =
  | ProposalAttemptResult
  | { status: "hour_full" };

function newOpaqueId(prefix: string): string {
  return `${prefix}${randomBytes(16).toString("hex")}`;
}

export function attemptInProgressResponse(): NextResponse {
  return errorResponse(
    httpError(409, {
      reason: "attempt_in_progress",
      message: "a proposal attempt is already in progress",
    }),
  );
}

export function proposalAttemptHourCapResponse(): NextResponse {
  return errorResponse(
    httpError(429, {
      message: "too many proposal attempts",
    }),
  );
}

export function notBlockedResponse(): NextResponse {
  return errorResponse(
    httpError(409, {
      reason: "not_blocked",
      message: "plan is not blocked",
    }),
  );
}

export async function recentProposalRunCount(planId: string): Promise<number> {
  const cutoff = new Date(now().getTime() - PROPOSAL_ATTEMPT_HOUR_MS);
  const rows = await db()
    .select({ value: count() })
    .from(proposalRuns)
    .where(
      and(eq(proposalRuns.planId, planId), gt(proposalRuns.startedAt, cutoff)),
    );
  return Number(rows[0]?.value ?? 0);
}

async function deleteProposalsTx(
  tx: Transaction,
  planId: string,
): Promise<void> {
  const existing = await tx
    .select({ id: proposals.id })
    .from(proposals)
    .where(eq(proposals.planId, planId));
  const ids = existing.map((row) => row.id);
  if (ids.length === 0) {
    return;
  }
  await tx.delete(stepSignals).where(inArray(stepSignals.proposalId, ids));
  await tx
    .delete(proposalAlternatives)
    .where(inArray(proposalAlternatives.proposalId, ids));
  await tx
    .delete(proposalCandidates)
    .where(inArray(proposalCandidates.proposalId, ids));
  await tx.delete(proposalLegs).where(inArray(proposalLegs.proposalId, ids));
  await tx.delete(proposalSteps).where(inArray(proposalSteps.proposalId, ids));
  await tx.delete(proposalCohort).where(inArray(proposalCohort.proposalId, ids));
  await tx.delete(proposals).where(inArray(proposals.id, ids));
}

export async function applyHourFullVenueData(planId: string): Promise<void> {
  const instant = now();
  await db().transaction(async (tx) => {
    const rows = await tx
      .select({ id: plans.id })
      .from(plans)
      .where(eq(plans.id, planId))
      .for("update");
    if (!rows[0]) {
      return;
    }
    await deleteProposalsTx(tx, planId);
    await tx.insert(proposalRuns).values({
      id: newOpaqueId("prn_"),
      planId,
      startedAt: instant,
      outcome: "blocked",
      blockTime: false,
      blockBudget: false,
      blockVenueData: true,
    });
    await tx
      .update(plans)
      .set({
        state: "blocked",
        attemptLock: false,
        attemptLockAt: null,
        updatedAt: instant,
      })
      .where(eq(plans.id, planId));
  });
}

export async function runTriggeredAttempt(
  planId: string,
  languageCode?: string,
): Promise<TriggeredAttemptResult> {
  if ((await recentProposalRunCount(planId)) >= PROPOSAL_ATTEMPT_HOUR_CAP) {
    return { status: "hour_full" };
  }
  return runProposalAttempt(planId, {
    google: proposalAttemptGoogle,
    languageCode,
  });
}
