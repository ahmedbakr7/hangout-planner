import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/en.json";
import { InvitePanel, InvitationsList } from "@/components/invite-panel";

const { router } = vi.hoisted(() => ({
  router: {
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

const TICKET_FILES = [
  "src/app/plans/[planId]/invite/page.tsx",
  "src/app/invitations/page.tsx",
  "src/components/invite-panel.tsx",
  "src/components/invite-panel.test.tsx",
];

const PLAN_ID = "pln_inviteaaaaaaaaaaaaaaaa";
const JOIN_PATH = `/join/jt_${"B".repeat(43)}`;
const INVITE_GET = `/v1/plans/${PLAN_ID}/invite`;
const INVITE_POST = `/v1/plans/${PLAN_ID}/invitations`;
const OPENING_GET = `/v1/plans/${PLAN_ID}/opening`;
const OTHER_PLAN_ID = "pln_otheraccountaaaaaaaaa";

const missingSession = {
  error: {
    code: "unauthenticated",
    reason: "missing_session",
    message: "missing session",
    fields: [],
  },
};

const nourAccount = {
  account: {
    id: "acc_aaaaaaaaaaaaaaaaaaaaaa",
    email: "nour@example.com",
    display_name: "Nour",
  },
};

const hanaInvited = {
  display_name: "Hana",
  distinguisher: "k7m2",
  status: "invited" as const,
};

const hanaJoined = {
  display_name: "Hana",
  distinguisher: "k7m2",
  status: "joined" as const,
};

const omarAnswered = {
  display_name: "Omar",
  distinguisher: "n8p3",
  status: "answered" as const,
};

const alexJoined = {
  display_name: "Alex",
  distinguisher: "a3k9",
  status: "joined" as const,
};

const alexAnswered = {
  display_name: "Alex",
  distinguisher: "b4m2",
  status: "answered" as const,
};

const leakedInvite = {
  join_path: `/join/jt_${"Z".repeat(43)}`,
  title: "Someone else's private plan",
  organizer_display_name: "Hidden Host",
  invitations: [
    {
      display_name: "Secret Person",
      distinguisher: "leak",
      status: "answered",
    },
  ],
  people: [{ display_name: "Secret Person", status: "answered" }],
  answered_count: 9,
};

const leakedInbox = {
  invitations: [
    {
      plan_id: OTHER_PLAN_ID,
      title: "Someone else's private plan",
      organizer_display_name: "Hidden Host",
      people: [{ display_name: "Secret Person" }],
      join_path: leakedInvite.join_path,
    },
  ],
  truncated: false,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function shareUrl(): string {
  return `${window.location.origin}${JOIN_PATH}`;
}

function stubClipboard(result: "ok" | "fail" | "missing" = "ok") {
  if (result === "missing") {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    return vi.fn();
  }
  const writeText =
    result === "fail"
      ? vi.fn(async () => {
          throw new Error("denied");
        })
      : vi.fn(async () => undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

type InviteConfig = {
  invite?: "ok" | "empty" | "fail" | "locked" | "collision";
  send?: "ok" | "identify" | "fail" | "locked" | "reuse";
  sendRow?: {
    display_name: string;
    distinguisher: string;
    status: "invited" | "joined" | "answered";
  };
};

type InboxConfig = {
  me?: "in" | "out";
  inbox?: "empty" | "list" | "fail" | "withNext";
  opening?: "join" | "respond" | "proposal" | "confirmed" | "fail";
};

function inviteBody(kind: NonNullable<InviteConfig["invite"]>): {
  status: number;
  body: unknown;
} {
  if (kind === "fail") {
    return {
      status: 500,
      body: {
        error: { code: "upstream", message: "fail", fields: [] },
        ...leakedInvite,
      },
    };
  }
  if (kind === "locked") {
    return {
      status: 409,
      body: {
        error: {
          code: "conflict",
          reason: "plan_locked",
          message: "locked",
          fields: [],
        },
        ...leakedInvite,
      },
    };
  }
  if (kind === "empty") {
    return {
      status: 200,
      body: { join_path: JOIN_PATH, invitations: [] },
    };
  }
  if (kind === "collision") {
    return {
      status: 200,
      body: {
        join_path: JOIN_PATH,
        invitations: [hanaInvited, alexJoined, alexAnswered],
      },
    };
  }
  return {
    status: 200,
    body: {
      join_path: JOIN_PATH,
      invitations: [hanaInvited, omarAnswered],
    },
  };
}

function stubInviteFetch(config: InviteConfig = {}) {
  const inviteKind = config.invite ?? "ok";
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url === INVITE_GET && method === "GET") {
      const result = inviteBody(inviteKind);
      return jsonResponse(result.status, result.body);
    }
    if (url === INVITE_POST && method === "POST") {
      if (config.send === "identify") {
        return jsonResponse(404, {
          error: {
            code: "not_found",
            reason: "account_not_found",
            message: "unknown",
            fields: [],
          },
        });
      }
      if (config.send === "fail") {
        return jsonResponse(500, {
          error: { code: "upstream", message: "fail", fields: [] },
          invitations: [leakedInvite.invitations[0]],
        });
      }
      if (config.send === "locked") {
        return jsonResponse(409, {
          error: {
            code: "conflict",
            reason: "plan_locked",
            message: "locked",
            fields: [],
          },
          ...leakedInvite,
        });
      }
      if (config.send === "reuse") {
        return jsonResponse(200, hanaInvited);
      }
      return jsonResponse(200, config.sendRow ?? hanaJoined);
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubInboxFetch(config: InboxConfig = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url === "/v1/me" && method === "GET") {
      if (config.me === "out") {
        return jsonResponse(401, missingSession);
      }
      return jsonResponse(200, nourAccount);
    }
    if (url === "/v1/invitations" && method === "GET") {
      if (config.inbox === "fail") {
        return jsonResponse(500, {
          error: { code: "upstream", message: "fail", fields: [] },
          ...leakedInbox,
        });
      }
      if (config.inbox === "empty") {
        return jsonResponse(200, { invitations: [], truncated: false });
      }
      if (config.inbox === "withNext") {
        return jsonResponse(200, {
          invitations: [
            {
              plan_id: PLAN_ID,
              title: "Thursday in Maadi",
              organizer_display_name: "Omar",
              next: "proposal",
            },
          ],
          truncated: false,
        });
      }
      return jsonResponse(200, {
        invitations: [
          {
            plan_id: PLAN_ID,
            title: "Thursday in Maadi",
            organizer_display_name: "Omar",
          },
        ],
        truncated: false,
      });
    }
    if (url === OPENING_GET && method === "GET") {
      if (config.opening === "fail") {
        return jsonResponse(500, {
          error: { code: "upstream", fields: [] },
          ...leakedInbox,
        });
      }
      return jsonResponse(200, {
        plan_id: PLAN_ID,
        next: config.opening ?? "respond",
        preview: null,
      });
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderInvite(planId = PLAN_ID) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <InvitePanel planId={planId} />
    </NextIntlClientProvider>,
  );
}

function renderInbox() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <InvitationsList />
    </NextIntlClientProvider>,
  );
}

async function renderLoadedInvite(config: InviteConfig = {}) {
  const fetchMock = stubInviteFetch({ invite: "ok", ...config });
  renderInvite();
  await screen.findByText(shareUrl());
  return fetchMock;
}

function postCall(
  fetchMock: ReturnType<typeof stubInviteFetch>,
  path: string,
): RequestInit | undefined {
  const match = fetchMock.mock.calls.find(
    (call) => String(call[0]) === path && (call[1]?.method ?? "GET") === "POST",
  );
  return match?.[1];
}

function getCall(
  fetchMock: ReturnType<typeof vi.fn>,
  path: string,
): RequestInit | undefined {
  const match = fetchMock.mock.calls.find(
    (call) => String(call[0]) === path && (call[1]?.method ?? "GET") === "GET",
  );
  return match?.[1];
}

function classTokens(el: Element): string[] {
  return el.className.split(/\s+/);
}

function sentItems(): HTMLElement[] {
  return screen.queryAllByRole("listitem");
}

function answeredRows(): HTMLElement[] {
  return sentItems().filter((item) => {
    const status = item.querySelector(".text-success");
    return status?.textContent === "answered";
  });
}

function expectLeakedInviteAbsent(): void {
  expect(screen.queryByText("Someone else's private plan")).toBeNull();
  expect(screen.queryByText("Secret Person")).toBeNull();
  expect(screen.queryByText("Hidden Host")).toBeNull();
  expect(screen.queryByText(leakedInvite.join_path)).toBeNull();
  expect(screen.queryByText(`${window.location.origin}${leakedInvite.join_path}`)).toBeNull();
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  router.push.mockReset();
  router.replace.mockReset();
  router.refresh.mockReset();
  document.cookie = "hp_locale=;path=/;max-age=0";
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
});

describe("Invite chrome", () => {
  it("composes shadcn primitives with DESIGN.md semantic classes and no raw hex", () => {
    const hex = new RegExp("#" + "[0-9a-fA-F]{3,8}\\b");
    const root = process.cwd();
    for (const relative of TICKET_FILES) {
      const source = readFileSync(join(root, relative), "utf8");
      expect(source, relative).not.toMatch(hex);
    }
    const panel = readFileSync(join(root, "src/components/invite-panel.tsx"), "utf8");
    expect(panel).toContain('from "@/components/ui/button"');
    expect(panel).toContain('from "@/components/ui/input"');
    expect(panel).toContain('from "@/components/ui/label"');
    expect(panel).toContain('from "@/components/ui/card"');
    expect(panel).toContain("bg-primary");
    expect(panel).toContain("text-destructive");
    expect(panel).toContain("text-muted-foreground");
    expect(panel).not.toContain('className="danger"');
    expect(panel).not.toContain("var(--accent)");
    expect(panel).not.toContain("var(--danger)");
    expect(panel.includes("style=" + "{{")).toBe(false);
    expect(panel.toLowerCase()).not.toContain("friend list");
    expect(panel.toLowerCase()).not.toContain("suggested people");
    expect(panel.toLowerCase()).not.toContain("co-planner");
    const invitePage = readFileSync(
      join(root, "src/app/plans/[planId]/invite/page.tsx"),
      "utf8",
    );
    const inboxPage = readFileSync(
      join(root, "src/app/invitations/page.tsx"),
      "utf8",
    );
    expect(invitePage).toContain("InvitePanel");
    expect(inboxPage).toContain("InvitationsList");
  });
});

describe("InvitePanel", () => {
  beforeEach(() => {
    stubClipboard("ok");
    stubInviteFetch({ invite: "empty" });
  });

  it("shows the share-link text and a copy control; when copy fails the link text stays visible", async () => {
    const writeText = stubClipboard("fail");
    await renderLoadedInvite({ invite: "empty" });
    const link = screen.getByText(shareUrl());
    expect(link.className.split(/\s+/)).not.toContain("text-destructive");
    const copy = screen.getByRole("button", { name: "Copy link" });
    expect(classTokens(copy)).not.toContain("bg-primary");
    fireEvent.click(copy);
    const alert = await screen.findByText("Copy failed. The link is still visible.");
    expect(classTokens(alert)).toContain("text-destructive");
    expect(screen.getByText(shareUrl())).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(shareUrl());
  });

  it("copies the share URL with a secondary copy control", async () => {
    const writeText = stubClipboard("ok");
    await renderLoadedInvite({ invite: "empty" });
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(shareUrl());
    });
    expect(screen.queryByText("Copy failed. The link is still visible.")).toBeNull();
    expect(screen.getByText(shareUrl())).toBeTruthy();
  });

  it("has one email field and no friend list, suggested people, or past co-planners", async () => {
    await renderLoadedInvite({ invite: "empty" });
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getByLabelText("Invitee email")).toBeTruthy();
    expect(screen.queryByText(/friend list/i)).toBeNull();
    expect(screen.queryByText(/suggested people/i)).toBeNull();
    expect(screen.queryByText(/co-planner/i)).toBeNull();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("the sent list shows each invited account once, with display name and status invited, joined, or answered; an empty list uses text-muted-foreground", async () => {
    stubInviteFetch({ invite: "empty" });
    renderInvite();
    const empty = await screen.findByText("No in-app invitations yet.");
    expect(classTokens(empty)).toContain("text-muted-foreground");
    expect(screen.queryByRole("listitem")).toBeNull();

    cleanup();
    stubInviteFetch({ invite: "ok" });
    renderInvite();
    expect(await screen.findByText("Hana")).toBeTruthy();
    expect(screen.getByText("Omar")).toBeTruthy();
    expect(sentItems()).toHaveLength(2);
    expect(sentItems().filter((item) => item.textContent?.includes("Hana"))).toHaveLength(
      1,
    );
    const hana = sentItems().find((item) => item.textContent?.includes("Hana"));
    const omar = sentItems().find((item) => item.textContent?.includes("Omar"));
    expect(hana?.textContent).toContain("invited");
    expect(hana?.textContent).not.toContain("joined");
    expect(hana?.textContent).not.toContain("answered");
    expect(omar?.textContent).toContain("answered");
    expect(omar?.querySelector(".text-success")?.textContent).toBe("answered");
  });

  it("shows the distinguisher only when another row in that list has the same display name", async () => {
    stubInviteFetch({ invite: "collision" });
    renderInvite();
    expect(await screen.findByText("Hana")).toBeTruthy();
    const hana = sentItems().find((item) => item.textContent?.includes("Hana"));
    expect(hana?.textContent).not.toContain("k7m2");
    expect(screen.queryByText("k7m2")).toBeNull();
    expect(screen.getByText("a3k9")).toBeTruthy();
    expect(screen.getByText("b4m2")).toBeTruthy();
  });

  it("a failed identification or failed send uses text-destructive, leaves the answered count unchanged, adds no row, and leaves the link section usable", async () => {
    const fetchMock = await renderLoadedInvite({
      invite: "ok",
      send: "identify",
    });
    const beforeAnswered = answeredRows().length;
    expect(beforeAnswered).toBe(1);
    expect(sentItems()).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Invitee email"), {
      target: { value: "missing@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));
    const identify = await screen.findByRole("alert");
    expect(identify.textContent).toBe("No account has that email.");
    expect(classTokens(identify)).toContain("text-destructive");
    expect(sentItems()).toHaveLength(2);
    expect(answeredRows()).toHaveLength(beforeAnswered);
    expect(screen.queryByText("Secret Person")).toBeNull();
    expect(screen.getByText(shareUrl())).toBeTruthy();
    const copy = screen.getByRole("button", { name: "Copy link" });
    expect(classTokens(copy)).not.toContain("bg-primary");
    const posted = postCall(fetchMock, INVITE_POST);
    expect(posted?.credentials).toBe("same-origin");
    expect(posted?.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-HP-Request": "1",
    });
    expect(JSON.parse(String(posted?.body))).toEqual({
      email: "missing@example.com",
    });

    cleanup();
    const failMock = stubInviteFetch({ invite: "ok", send: "fail" });
    renderInvite();
    await screen.findByText(shareUrl());
    const answeredBeforeFail = answeredRows().length;
    fireEvent.change(screen.getByLabelText("Invitee email"), {
      target: { value: "hana@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));
    const sendAlert = await screen.findByRole("alert");
    expect(sendAlert.textContent).toBe("A data source is unavailable. Retry.");
    expect(classTokens(sendAlert)).toContain("text-destructive");
    expect(sentItems()).toHaveLength(2);
    expect(answeredRows()).toHaveLength(answeredBeforeFail);
    expect(screen.getByText(shareUrl())).toBeTruthy();
    expect(classTokens(screen.getByRole("button", { name: "Copy link" }))).not.toContain(
      "bg-primary",
    );
    expect(classTokens(screen.getByRole("button", { name: "Send invite" }))).toContain(
      "bg-primary",
    );
    expect(postCall(failMock, INVITE_POST)?.headers).toMatchObject({
      "X-HP-Request": "1",
    });
  });

  it("sending again to an already invited account keeps one row", async () => {
    await renderLoadedInvite({ invite: "ok", send: "reuse" });
    fireEvent.change(screen.getByLabelText("Invitee email"), {
      target: { value: "hana@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));
    await waitFor(() => {
      expect(
        sentItems().filter((item) => item.textContent?.includes("Hana")),
      ).toHaveLength(1);
    });
    expect(sentItems()).toHaveLength(2);
  });

  it("while locked this surface is absent", async () => {
    stubInviteFetch({ invite: "locked" });
    renderInvite();
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(`/plans/${PLAN_ID}/confirmed`);
    });
    expect(screen.queryByText(shareUrl())).toBeNull();
    expect(screen.queryByLabelText("Invitee email")).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Send invite" })).toBeNull();
    expectLeakedInviteAbsent();
  });

  it("switching language keeps unsaved invite input", async () => {
    await renderLoadedInvite({ invite: "empty" });
    fireEvent.change(screen.getByLabelText("Invitee email"), {
      target: { value: "keep.this@example.com" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), {
      target: { value: "ar" },
    });
    expect(document.cookie).toMatch(/(?:^|; )hp_locale=ar(?:;|$)/);
    expect(document.documentElement.dir).toBe("rtl");
    expect((screen.getByLabelText("بريد المدعو") as HTMLInputElement).value).toBe(
      "keep.this@example.com",
    );
  });

  it("a load failure uses text-destructive and retry and omits another plan's link, title, or people", async () => {
    let gets = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === INVITE_GET && method === "GET") {
        gets += 1;
        if (gets === 1) {
          return jsonResponse(500, {
            error: { code: "upstream", message: "fail", fields: [] },
            ...leakedInvite,
          });
        }
        return jsonResponse(200, { join_path: JOIN_PATH, invitations: [] });
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderInvite();

    const alert = await screen.findByRole("alert");
    expect(classTokens(alert)).toContain("text-destructive");
    expect(alert.textContent).toBe("This invite page could not be loaded.");
    expectLeakedInviteAbsent();
    expect(screen.queryByText(shareUrl())).toBeNull();
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(classTokens(retry)).not.toContain("bg-primary");
    expect(getCall(fetchMock, INVITE_GET)?.credentials).toBe("same-origin");

    fireEvent.click(retry);
    expect(await screen.findByText(shareUrl())).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expectLeakedInviteAbsent();
  });
});

describe("InvitationsList", () => {
  it("signed-out opens the account gate with next=/invitations", async () => {
    const fetchMock = stubInboxFetch({ me: "out" });
    renderInbox();
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Account" })).toBeTruthy();
    expect(screen.queryByText("No invitations yet.")).toBeNull();
    expect(screen.queryByText("Thursday in Maadi")).toBeNull();
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls).toContain("/v1/me");
    expect(urls.some((url) => url === "/v1/invitations")).toBe(false);
  });

  it("shows one row per plan with the authored title and the organizer display name, and opening a row follows that plan's opening next", async () => {
    const fetchMock = stubInboxFetch({
      me: "in",
      inbox: "list",
      opening: "respond",
    });
    renderInbox();
    expect(await screen.findByText("Thursday in Maadi")).toBeTruthy();
    expect(screen.getByText("Organized by Omar")).toBeTruthy();
    expect(sentItems()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Thursday in Maadi/ }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/plans/${PLAN_ID}/respond`);
    });
    expect(getCall(fetchMock, OPENING_GET)?.credentials).toBe("same-origin");
    expect(screen.queryByText("Someone else's private plan")).toBeNull();
  });

  it("opening a row with next on the payload follows that next without another plan's data", async () => {
    const fetchMock = stubInboxFetch({ me: "in", inbox: "withNext" });
    renderInbox();
    expect(await screen.findByText("Thursday in Maadi")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Thursday in Maadi/ }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/plans/${PLAN_ID}/proposal`);
    });
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url === OPENING_GET)).toBe(false);
  });

  it("opening follows join and confirmed next from opening", async () => {
    stubInboxFetch({ me: "in", inbox: "list", opening: "join" });
    renderInbox();
    fireEvent.click(await screen.findByRole("button", { name: /Thursday in Maadi/ }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/plans/${PLAN_ID}/join`);
    });

    cleanup();
    router.push.mockReset();
    stubInboxFetch({ me: "in", inbox: "list", opening: "confirmed" });
    renderInbox();
    fireEvent.click(await screen.findByRole("button", { name: /Thursday in Maadi/ }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/plans/${PLAN_ID}/confirmed`);
    });
  });

  it("signed-in empty copy uses text-muted-foreground and offers home", async () => {
    stubInboxFetch({ me: "in", inbox: "empty" });
    renderInbox();
    const empty = await screen.findByText("No invitations yet.");
    expect(classTokens(empty)).toContain("text-muted-foreground");
    expect(classTokens(empty)).not.toContain("text-destructive");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("href")).toBe("/");
    expect(classTokens(screen.getByRole("link", { name: "Home" }))).not.toContain(
      "bg-primary",
    );
  });

  it("a load failure uses text-destructive and retry and omits another plan's link, title, or people", async () => {
    let inboxCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/v1/me" && method === "GET") {
        return jsonResponse(200, nourAccount);
      }
      if (url === "/v1/invitations" && method === "GET") {
        inboxCalls += 1;
        if (inboxCalls === 1) {
          return jsonResponse(500, {
            error: { code: "upstream", message: "fail", fields: [] },
            ...leakedInbox,
          });
        }
        return jsonResponse(200, {
          invitations: [
            {
              plan_id: PLAN_ID,
              title: "Thursday in Maadi",
              organizer_display_name: "Omar",
            },
          ],
          truncated: false,
        });
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderInbox();

    const alert = await screen.findByRole("alert");
    expect(classTokens(alert)).toContain("text-destructive");
    expect(alert.textContent).toBe("Invitations could not be loaded.");
    expect(screen.queryByText("Someone else's private plan")).toBeNull();
    expect(screen.queryByText("Hidden Host")).toBeNull();
    expect(screen.queryByText("Secret Person")).toBeNull();
    expect(screen.queryByText("Thursday in Maadi")).toBeNull();
    expect(screen.queryByText(leakedInvite.join_path)).toBeNull();
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(classTokens(retry)).not.toContain("bg-primary");

    fireEvent.click(retry);
    expect(await screen.findByText("Thursday in Maadi")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Someone else's private plan")).toBeNull();
    const inboxGets = fetchMock.mock.calls.filter(
      (call) => String(call[0]) === "/v1/invitations",
    );
    expect(inboxGets.length).toBe(2);
    expect(inboxGets[0]?.[1]?.credentials).toBe("same-origin");
  });
});
