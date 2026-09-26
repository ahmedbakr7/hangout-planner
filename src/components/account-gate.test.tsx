import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/en.json";
import { AccountGate, allowedNextPath, isJoinNextPath } from "@/components/account-gate";

const { router } = vi.hoisted(() => ({
  router: {
    push: vi.fn(),
    refresh: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

const JOIN_TOKEN = `jt_${"A".repeat(43)}`;
const JOIN_PATH = `/join/${JOIN_TOKEN}`;

const missingSession = {
  error: {
    code: "unauthenticated",
    reason: "missing_session",
    message: "missing session",
    fields: [],
  },
};

const badCredentials = {
  error: {
    code: "unauthenticated",
    reason: "bad_credentials",
    message: "sign-in rejected",
    fields: [],
  },
};

const emailTaken = {
  error: {
    code: "conflict",
    reason: "email_taken",
    message: "email is already registered",
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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type FetchConfig = {
  me?: "out" | "in";
  sessions?: "ok" | "fail";
  accounts?: "ok" | "fail";
};

function stubFetch(config: FetchConfig = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url === "/v1/me" && method === "GET") {
      if (config.me === "in") {
        return jsonResponse(200, nourAccount);
      }
      return jsonResponse(401, missingSession);
    }
    if (url === "/v1/sessions" && method === "POST") {
      if (config.sessions === "fail") {
        return jsonResponse(401, badCredentials);
      }
      return jsonResponse(200, nourAccount);
    }
    if (url === "/v1/accounts" && method === "POST") {
      if (config.accounts === "fail") {
        return jsonResponse(409, emailTaken);
      }
      return jsonResponse(201, nourAccount);
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderGate(next?: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AccountGate next={next} />
    </NextIntlClientProvider>,
  );
}

async function renderSignedOut(next?: string) {
  const fetchMock = stubFetch({ me: "out" });
  renderGate(next);
  await screen.findByText("An account is required to organize a plan.");
  return fetchMock;
}

function fetchUrls(fetchMock: ReturnType<typeof stubFetch>): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]));
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  router.push.mockReset();
  router.refresh.mockReset();
  document.cookie = "hp_locale=;path=/;max-age=0";
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
});

describe("allowedNextPath", () => {
  it("accepts only /, /plans/new, /invitations, or /join/ plus a join token", () => {
    expect(allowedNextPath("/")).toBe("/");
    expect(allowedNextPath("/plans/new")).toBe("/plans/new");
    expect(allowedNextPath("/invitations")).toBe("/invitations");
    expect(allowedNextPath(JOIN_PATH)).toBe(JOIN_PATH);
    expect(isJoinNextPath(JOIN_PATH)).toBe(true);
  });

  it("ignores any other value and returns home", () => {
    expect(allowedNextPath(undefined)).toBe("/");
    expect(allowedNextPath("/account")).toBe("/");
    expect(allowedNextPath("/plans/new/extra")).toBe("/");
    expect(allowedNextPath("/plans/pln_aaaaaaaaaaaaaaaaaaaaaa")).toBe("/");
    expect(allowedNextPath("//evil.example")).toBe("/");
    expect(allowedNextPath("https://example.com")).toBe("/");
    expect(allowedNextPath("/join/jt_short")).toBe("/");
    expect(allowedNextPath(`/join/${JOIN_TOKEN}/extra`)).toBe("/");
    expect(allowedNextPath(`${JOIN_PATH}?x=1`)).toBe("/");
    expect(allowedNextPath("/JOIN/" + JOIN_TOKEN)).toBe("/");
    expect(isJoinNextPath("/plans/new")).toBe(false);
  });
});

describe("AccountGate", () => {
  beforeEach(() => {
    stubFetch({ me: "out" });
  });

  it("says an account is required to organize when signed out", async () => {
    await renderSignedOut();
    expect(screen.getByRole("heading", { name: "Account" })).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: "Join without an account" }),
    ).toBeNull();
  });

  it("offers a way back to join without an account when next is a join path", async () => {
    await renderSignedOut(JOIN_PATH);
    const link = screen.getByRole("link", { name: "Join without an account" });
    expect(link.getAttribute("href")).toBe(JOIN_PATH);
  });

  it("keeps a failed sign-in on the gate, signed out, with non-secret values and danger", async () => {
    const fetchMock = stubFetch({ me: "out", sessions: "fail" });
    renderGate("/plans/new");
    await screen.findByText("An account is required to organize a plan.");

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "nour@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "wrong-pass" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    const alert = await screen.findByRole("alert");
    expect(alert.className.split(/\s+/)).toContain("danger");
    expect(alert.textContent).toBe("Email or password is wrong.");
    expect(screen.getByText("An account is required to organize a plan.")).toBeTruthy();
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(
      "nour@example.com",
    );
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
    expect(screen.queryByText(/Signed in as/)).toBeNull();
    expect(router.push).not.toHaveBeenCalled();

    const urls = fetchUrls(fetchMock);
    expect(urls.some((url) => url.includes("/v1/plans"))).toBe(false);
    expect(urls.some((url) => url.includes("/v1/join"))).toBe(false);
    expect(urls.filter((url) => url === "/v1/sessions")).toEqual(["/v1/sessions"]);

    const posted = postCall(fetchMock, "/v1/sessions");
    expect(posted?.credentials).toBe("same-origin");
    expect(posted?.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-HP-Request": "1",
    });
    expect(JSON.parse(String(posted?.body))).toEqual({
      email: "nour@example.com",
      password: "wrong-pass",
    });
  });

  it("keeps a failed registration on the gate, signed out, with non-secret values and danger", async () => {
    const fetchMock = stubFetch({ me: "out", accounts: "fail" });
    renderGate();
    await screen.findByText("An account is required to organize a plan.");

    fireEvent.click(screen.getByRole("tab", { name: "Create account" }));
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "nour@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "a-secret-pass" },
    });
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Nour" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    const alert = await screen.findByRole("alert");
    expect(alert.className.split(/\s+/)).toContain("danger");
    expect(alert.textContent).toBe("That email already has an account.");
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(
      "nour@example.com",
    );
    expect((screen.getByLabelText("Display name") as HTMLInputElement).value).toBe(
      "Nour",
    );
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
    expect(router.push).not.toHaveBeenCalled();

    const urls = fetchUrls(fetchMock);
    expect(urls.some((url) => url.includes("/v1/plans"))).toBe(false);
    expect(urls.some((url) => url.includes("/join"))).toBe(false);

    const posted = postCall(fetchMock, "/v1/accounts");
    expect(posted?.credentials).toBe("same-origin");
    expect(posted?.headers).toMatchObject({
      "X-HP-Request": "1",
    });
    expect(JSON.parse(String(posted?.body))).toEqual({
      email: "nour@example.com",
      password: "a-secret-pass",
      display_name: "Nour",
    });
  });

  it("continues to create after a successful sign-in", async () => {
    stubFetch({ me: "out", sessions: "ok" });
    renderGate("/plans/new");
    await screen.findByText("An account is required to organize a plan.");

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "nour@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "a-secret-pass" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith("/plans/new");
    });
  });

  it("continues to join, home, or invitations after success", async () => {
    stubFetch({ me: "out", sessions: "ok" });
    renderGate(JOIN_PATH);
    await screen.findByText("An account is required to organize a plan.");
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "nour@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "a-secret-pass" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(JOIN_PATH);
    });

    cleanup();
    router.push.mockReset();
    stubFetch({ me: "out", accounts: "ok" });
    renderGate("/invitations");
    await screen.findByText("An account is required to organize a plan.");
    fireEvent.click(screen.getByRole("tab", { name: "Create account" }));
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "nour@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "a-secret-pass" },
    });
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Nour" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith("/invitations");
    });

    cleanup();
    router.push.mockReset();
    stubFetch({ me: "out", sessions: "ok" });
    renderGate("/");
    await screen.findByText("An account is required to organize a plan.");
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "nour@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "a-secret-pass" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith("/");
    });
  });

  it("returns home after success when next is not allow-listed", async () => {
    stubFetch({ me: "out", sessions: "ok" });
    renderGate("/plans/pln_aaaaaaaaaaaaaaaaaaaaaa");
    await screen.findByText("An account is required to organize a plan.");
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "nour@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "a-secret-pass" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith("/");
    });
  });

  it("shows the display name and a way home when already signed in", async () => {
    stubFetch({ me: "in" });
    renderGate("/plans/new");
    expect(await screen.findByText("Signed in as Nour")).toBeTruthy();
    const home = screen.getByRole("link", { name: "Go home" });
    expect(home.getAttribute("href")).toBe("/");
    expect(screen.queryByText("An account is required to organize a plan.")).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("keeps unsaved gate input when the language control updates hp_locale", async () => {
    await renderSignedOut();
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "keep@example.com" },
    });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "ar" } });
    expect(document.cookie).toMatch(/(?:^|; )hp_locale=ar(?:;|$)/);
    expect(document.documentElement.dir).toBe("rtl");
    expect((screen.getByLabelText("البريد") as HTMLInputElement).value).toBe(
      "keep@example.com",
    );
  });
});
