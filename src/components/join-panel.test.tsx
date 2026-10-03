import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/en.json";
import { JoinPanel } from "@/components/join-panel";

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
  "src/app/join/[token]/page.tsx",
  "src/app/plans/[planId]/join/page.tsx",
  "src/components/join-panel.tsx",
  "src/components/join-panel.test.tsx",
];

const JOIN_TOKEN = `jt_${"A".repeat(43)}`;
const PLAN_ID = "pln_joinaaaaaaaaaaaaaaaaaa";
const JOIN_GET = `/api/v1/join/${JOIN_TOKEN}`;
const JOIN_POST = `/api/v1/join/${JOIN_TOKEN}`;
const OPENING_GET = `/api/v1/plans/${PLAN_ID}/opening`;
const PLAN_JOIN_POST = `/api/v1/plans/${PLAN_ID}/join`;

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

const preview = {
  title: "Thursday in Maadi",
  organizer_display_name: "Omar",
  timezone: "Africa/Cairo",
  windows: [
    {
      local_date: "2026-10-02",
      start_local: "18:00",
      end_local: "23:00",
    },
  ],
  budget: { amount_minor: 50000, currency: "EGP" },
  step_names: ["Dinner", "Coffee"],
};

const leakedPreview = {
  ...preview,
  options: [{ label: "Koshary" }, { label: "Grills" }],
  option_labels: ["Koshary", "Grills"],
  answered_count: 1,
  threshold: 3,
  participants: [
    {
      display_name: "Secret Person",
      status: "answered",
      start: "Helwan rooftop",
    },
  ],
  itinerary: { time: "19:00", places: ["Secret Cafe"] },
};

const leakedUnknown = {
  error: {
    code: "not_found",
    message: "unknown join token",
    fields: [],
  },
  title: "Someone else's private plan",
  organizer_display_name: "Hidden Host",
  participants: [{ display_name: "Secret Person", status: "answered" }],
  itinerary: { places: ["Secret Cafe"] },
};

const joinOpening = {
  plan_id: PLAN_ID,
  next: "join" as const,
  preview: leakedPreview,
  answered_count: 1,
  threshold: 3,
  participants: leakedPreview.participants,
  itinerary: leakedPreview.itinerary,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type FetchConfig = {
  me?: "in" | "out";
  opening?:
    | "join"
    | "unknown"
    | "fail"
    | "organizer"
    | "respond"
    | "proposal"
    | "confirmed";
  joinPost?: "ok" | "fail" | "locked";
  joinNext?: "respond" | "proposal" | "confirmed";
};

function openingBody(kind: NonNullable<FetchConfig["opening"]>): {
  status: number;
  body: unknown;
} {
  if (kind === "unknown") {
    return { status: 404, body: leakedUnknown };
  }
  if (kind === "fail") {
    return {
      status: 500,
      body: {
        error: { code: "upstream", message: "fail", fields: [] },
        ...leakedUnknown,
      },
    };
  }
  if (kind === "join") {
    return { status: 200, body: joinOpening };
  }
  return {
    status: 200,
    body: { plan_id: PLAN_ID, next: kind, preview: null },
  };
}

function stubFetch(config: FetchConfig = {}) {
  const openingKind = config.opening ?? "join";
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url === "/api/v1/me" && method === "GET") {
      if (config.me === "out") {
        return jsonResponse(401, missingSession);
      }
      return jsonResponse(200, nourAccount);
    }
    if ((url === JOIN_GET || url === OPENING_GET) && method === "GET") {
      const result = openingBody(openingKind);
      return jsonResponse(result.status, result.body);
    }
    if ((url === JOIN_POST || url === PLAN_JOIN_POST) && method === "POST") {
      if (config.joinPost === "fail") {
        return jsonResponse(401, missingSession);
      }
      if (config.joinPost === "locked") {
        return jsonResponse(409, {
          error: {
            code: "conflict",
            reason: "plan_locked",
            message: "locked",
            fields: [],
          },
        });
      }
      return jsonResponse(201, {
        participant: {
          id: "prt_joinaaaaaaaaaaaaaaaaaa",
          display_name: "Nour",
          distinguisher: "a3k9",
        },
        next: config.joinNext ?? "respond",
      });
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderJoin(props: { token?: string; planId?: string }) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <JoinPanel token={props.token} planId={props.planId} />
    </NextIntlClientProvider>,
  );
}

async function renderLoaded(
  props: { token?: string; planId?: string },
  config: FetchConfig = {},
) {
  const fetchMock = stubFetch({ me: "in", opening: "join", ...config });
  renderJoin(props);
  await screen.findByRole("heading", { name: "Thursday in Maadi" });
  return fetchMock;
}

function postCall(
  fetchMock: ReturnType<typeof stubFetch>,
  path: string,
): RequestInit | undefined {
  const match = fetchMock.mock.calls.find(
    (call) => String(call[0]) === path && (call[1]?.method ?? "GET") === "POST",
  );
  return match?.[1];
}

function getCall(
  fetchMock: ReturnType<typeof stubFetch>,
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

function expectForbiddenPreviewAbsent(): void {
  expect(screen.queryByText("Koshary")).toBeNull();
  expect(screen.queryByText("Grills")).toBeNull();
  expect(screen.queryByText("1 of 3 answered")).toBeNull();
  expect(screen.queryByText("answered")).toBeNull();
  expect(screen.queryByText("in progress")).toBeNull();
  expect(screen.queryByText("Helwan rooftop")).toBeNull();
  expect(screen.queryByText("Secret Person")).toBeNull();
  expect(screen.queryByText("Secret Cafe")).toBeNull();
  expect(screen.queryByText("Someone else's private plan")).toBeNull();
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

describe("JoinPanel chrome", () => {
  it("composes shadcn primitives with DESIGN.md semantic classes and no raw hex", () => {
    const hex = new RegExp("#" + "[0-9a-fA-F]{3,8}\\b");
    const root = process.cwd();
    for (const relative of TICKET_FILES) {
      const source = readFileSync(join(root, relative), "utf8");
      expect(source, relative).not.toMatch(hex);
    }
    const panel = readFileSync(join(root, "src/components/join-panel.tsx"), "utf8");
    expect(panel).toContain('from "@/components/ui/button"');
    expect(panel).toContain('from "@/components/ui/input"');
    expect(panel).toContain('from "@/components/ui/label"');
    expect(panel).toContain('from "@/components/ui/card"');
    expect(panel).toContain("bg-primary");
    expect(panel).toContain("text-destructive");
    expect(panel).not.toContain('className="danger"');
    expect(panel).not.toContain("var(--accent)");
    expect(panel).not.toContain("var(--danger)");
    expect(panel.includes("style=" + "{{")).toBe(false);
    expect(panel).not.toContain('type="password"');
    expect(panel).not.toContain("password");
    const tokenPage = readFileSync(
      join(root, "src/app/join/[token]/page.tsx"),
      "utf8",
    );
    const planPage = readFileSync(
      join(root, "src/app/plans/[planId]/join/page.tsx"),
      "utf8",
    );
    expect(tokenPage).toContain("JoinPanel");
    expect(planPage).toContain("JoinPanel");
  });
});

describe("JoinPanel", () => {
  beforeEach(() => {
    stubFetch({ me: "out", opening: "join" });
  });

  it("shows the authored title, organizer display name, timezone, day windows, per-person budget with currency, and step names", async () => {
    const fetchMock = await renderLoaded({ token: JOIN_TOKEN });
    expect(screen.getByText("Organized by Omar")).toBeTruthy();
    expect(screen.getByText("Africa/Cairo")).toBeTruthy();
    expect(screen.getByText("2026-10-02 18:00-23:00")).toBeTruthy();
    expect(screen.getByText(/500\.00/)).toBeTruthy();
    expect(screen.getByText(/EGP/)).toBeTruthy();
    expect(screen.getByText("Dinner")).toBeTruthy();
    expect(screen.getByText("Coffee")).toBeTruthy();
    expect(getCall(fetchMock, JOIN_GET)?.credentials).toBe("same-origin");
  });

  it("omits option labels, answered count, threshold, other people's statuses, starting points, and any itinerary", async () => {
    await renderLoaded({ token: JOIN_TOKEN });
    expectForbiddenPreviewAbsent();
    expect(screen.queryByText("3")).toBeNull();
  });

  it("offers join with an account and join without an account, with a display name field and no password on the without-account path", async () => {
    await renderLoaded({ token: JOIN_TOKEN }, { me: "out" });
    const account = screen.getByRole("link", { name: "Join with an account" });
    expect(account.getAttribute("href")).toBe(`/account?next=/join/${JOIN_TOKEN}`);
    expect(classTokens(account)).toContain("bg-primary");
    expect(
      screen.getByRole("button", { name: "Join without an account" }),
    ).toBeTruthy();
    expect(
      classTokens(screen.getByRole("button", { name: "Join without an account" })),
    ).not.toContain("bg-primary");
    expect(screen.getByLabelText("Display name")).toBeTruthy();
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it("an unknown link uses text-destructive and shows no other plan's title and no participant list", async () => {
    stubFetch({ me: "out", opening: "unknown" });
    renderJoin({ token: JOIN_TOKEN });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("This link does not open a plan.");
    expect(classTokens(alert)).toContain("text-destructive");
    expect(screen.queryByText("Thursday in Maadi")).toBeNull();
    expect(screen.queryByText("Someone else's private plan")).toBeNull();
    expect(screen.queryByText("Secret Person")).toBeNull();
    expect(screen.queryByText("Hidden Host")).toBeNull();
    expect(screen.queryByRole("listitem")).toBeNull();
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(classTokens(retry)).not.toContain("bg-primary");
  });

  it("T-001-32/AC-1 retry after a failed load reloads the preview and the signed-in state", async () => {
    stubFetch({ me: "out", opening: "fail" });
    renderJoin({ token: JOIN_TOKEN });
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(screen.queryByRole("heading", { name: "Thursday in Maadi" })).toBeNull();

    const fetchMock = stubFetch({ me: "in", opening: "join" });
    fireEvent.click(retry);
    expect(await screen.findByRole("heading", { name: "Thursday in Maadi" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Join with an account" })).toBeTruthy();
    expect(getCall(fetchMock, JOIN_GET)?.credentials).toBe("same-origin");
    expect(getCall(fetchMock, "/api/v1/me")?.credentials).toBe("same-origin");
  });

  it("a failed account join stays here and still is not a participant", async () => {
    const fetchMock = await renderLoaded(
      { token: JOIN_TOKEN },
      { me: "in", joinPost: "fail" },
    );
    fireEvent.click(screen.getByRole("button", { name: "Join with an account" }));
    const alert = await screen.findByRole("alert");
    expect(classTokens(alert)).toContain("text-destructive");
    expect(screen.getByRole("heading", { name: "Thursday in Maadi" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Join without an account" }),
    ).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    const posted = postCall(fetchMock, JOIN_POST);
    expect(posted?.credentials).toBe("same-origin");
    expect(posted?.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-HP-Request": "1",
    });
    expect(JSON.parse(String(posted?.body))).toEqual({ kind: "account" });
  });

  it("an empty display name is identified and creates no participant", async () => {
    const fetchMock = await renderLoaded({ token: JOIN_TOKEN }, { me: "out" });
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Join without an account" }));
    expect(await screen.findByText("Enter a display name.")).toBeTruthy();
    expect(
      classTokens(screen.getByText("Enter a display name.")),
    ).toContain("text-destructive");
    expect(postCall(fetchMock, JOIN_POST)).toBeUndefined();
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Thursday in Maadi" })).toBeTruthy();
  });

  it("while locked this surface is absent and the open shows the confirmed surface", async () => {
    stubFetch({ me: "in", opening: "confirmed" });
    renderJoin({ token: JOIN_TOKEN });
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(
        `/plans/${PLAN_ID}/confirmed`,
      );
    });
    expect(screen.queryByText("Thursday in Maadi")).toBeNull();
    expect(screen.queryByRole("button", { name: "Join with an account" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Join without an account" }),
    ).toBeNull();
    expectForbiddenPreviewAbsent();
  });

  it("a direct hit on the wrong path for this plan redirects to next", async () => {
    stubFetch({ me: "in", opening: "organizer" });
    renderJoin({ token: JOIN_TOKEN });
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(`/plans/${PLAN_ID}`);
    });

    cleanup();
    router.replace.mockReset();
    stubFetch({ me: "in", opening: "respond" });
    renderJoin({ planId: PLAN_ID });
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(
        `/plans/${PLAN_ID}/respond`,
      );
    });

    cleanup();
    router.replace.mockReset();
    stubFetch({ me: "in", opening: "proposal" });
    renderJoin({ planId: PLAN_ID });
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(
        `/plans/${PLAN_ID}/proposal`,
      );
    });
  });

  it("T-001-32/AC-1 joins without an account through the token route and opens the participant next", async () => {
    const fetchMock = await renderLoaded(
      { token: JOIN_TOKEN },
      { me: "out", joinNext: "respond" },
    );
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: " Nour " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Join without an account" }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/plans/${PLAN_ID}/respond`);
    });
    const posted = postCall(fetchMock, JOIN_POST);
    expect(posted?.credentials).toBe("same-origin");
    expect(posted?.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-HP-Request": "1",
    });
    expect(JSON.parse(String(posted?.body))).toEqual({
      kind: "anonymous",
      display_name: "Nour",
    });
  });

  it("T-001-32/AC-1 joins with an account on the in-app plan path", async () => {
    const fetchMock = await renderLoaded(
      { planId: PLAN_ID },
      { me: "in", joinNext: "proposal" },
    );
    expect(getCall(fetchMock, OPENING_GET)?.credentials).toBe("same-origin");
    fireEvent.click(screen.getByRole("button", { name: "Join with an account" }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/plans/${PLAN_ID}/proposal`);
    });
    const posted = postCall(fetchMock, PLAN_JOIN_POST);
    expect(posted?.headers).toMatchObject({
      "X-HP-Request": "1",
    });
    expect(JSON.parse(String(posted?.body))).toEqual({ kind: "account" });
  });

  it("signed-out in-app account join goes to the account gate", async () => {
    await renderLoaded({ planId: PLAN_ID }, { me: "out" });
    const account = screen.getByRole("link", { name: "Join with an account" });
    expect(account.getAttribute("href")).toBe("/account?next=/invitations");
    expect(classTokens(account)).toContain("bg-primary");
  });

  it("keeps an unsaved display name when the language control updates hp_locale", async () => {
    await renderLoaded({ token: JOIN_TOKEN }, { me: "out" });
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "keep this name" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), {
      target: { value: "ar" },
    });
    expect(document.cookie).toMatch(/(?:^|; )hp_locale=ar(?:;|$)/);
    expect(document.documentElement.dir).toBe("rtl");
    expect((screen.getByLabelText("اسم العرض") as HTMLInputElement).value).toBe(
      "keep this name",
    );
  });
});
