import {
  readAccountSession,
  type AccountPublic,
  type AccountSession,
} from "@/server/auth/http";
import type { CookieReader } from "@/server/plans/role";

export type AccountView = { account: AccountPublic };

export type AccountPage =
  | {
      kind: "ok";
      view: AccountView;
      session: Extract<AccountSession, { ok: true }>;
    }
  | { kind: "signed_out" };

export async function loadAccountPage(
  readCookie: CookieReader,
): Promise<AccountPage> {
  const session = await readAccountSession(readCookie("hp_session"));
  if (!session.ok) {
    return { kind: "signed_out" };
  }
  return {
    kind: "ok",
    view: {
      account: {
        id: session.account.id,
        email: session.account.email,
        display_name: session.account.display_name,
      },
    },
    session,
  };
}
