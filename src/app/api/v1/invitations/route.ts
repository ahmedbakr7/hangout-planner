import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { createDb } from "@/server/db/client";
import { accounts, invitations, plans } from "@/server/db/schema";
import {
  logged,
  missingSessionResponse,
  readAccountSession,
  readCookie,
} from "../accounts/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const INBOX_LIMIT = 100;

type Database = ReturnType<typeof createDb>;

let database: Database | undefined;

function db(): Database {
  if (!database) {
    database = createDb();
  }
  return database;
}

export async function closeDatabase(): Promise<void> {
  if (!database) {
    return;
  }
  await database.$client.end({ timeout: 5 });
  database = undefined;
}

export async function GET(request: Request): Promise<NextResponse> {
  const session = await readAccountSession(readCookie(request, "hp_session"));
  if (!session.ok) {
    return logged(request, missingSessionResponse());
  }

  const rows = await db()
    .select({
      planId: plans.id,
      title: plans.title,
      organizerDisplayName: accounts.displayName,
    })
    .from(invitations)
    .innerJoin(plans, eq(plans.id, invitations.planId))
    .innerJoin(accounts, eq(accounts.id, plans.organizerAccountId))
    .where(eq(invitations.accountId, session.account.id))
    .orderBy(desc(invitations.createdAt), desc(invitations.id))
    .limit(INBOX_LIMIT + 1);

  const truncated = rows.length > INBOX_LIMIT;
  const page = truncated ? rows.slice(0, INBOX_LIMIT) : rows;
  return logged(
    request,
    NextResponse.json({
      invitations: page.map((row) => ({
        plan_id: row.planId,
        title: row.title,
        organizer_display_name: row.organizerDisplayName,
      })),
      truncated,
    }),
  );
}
