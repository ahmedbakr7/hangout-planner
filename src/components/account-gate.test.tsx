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
    if (url === "/api/v1/me" && method === "GET") {
      if (config.me === "in") {
        return jsonResponse(200, nourAccount);
      }
      return jsonResponse(401, missingSession);
    }
    if (url === "/api/v1/sessions" && method === "POST") {
      if (config.sessions === "fail") {
        return jsonResponse(401, badCredentials);
      }
      return jsonResponse(200, nourAccount);
    }
    if (url === "/api/v1/accounts" && method === "POST") {
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

function renderGateWith(props: { next?: string; initialAccount?: unknown }) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AccountGate {...props} />
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

function classTokens(el: Element): string[] {
  return el.className.split(/\s+/);
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

  it("T-001-32/AC-2 says an account is required to organize when signed out", async () => {
    await renderSignedOut();
    expect(screen.getByRole("heading", { name: "Account" })).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: "Join without an account" }),
    ).toBeNull();
    expect(
      classTokens(screen.getByRole("button", { name: "Sign in" })),
    ).toContain("bg-primary");
    expect(classTokens(screen.getByRole("tab", { name: "Sign in" }))).not.toContain(
      "bg-primary",
    );
    expect(
      classTokens(screen.getByRole("tab", { name: "Create account" })),
    ).not.toContain("bg-primary");
  });

  it("offers a way back to join without an account when next is a join path", async () => {
    await renderSignedOut(JOIN_PATH);
    const link = screen.getByRole("link", { name: "Join without an account" });
    expect(link.getAttribute("href")).toBe(JOIN_PATH);
    expect(classTokens(link)).not.toContain("bg-primary");
  });

  it("keeps a failed sign-in on the gate, signed out, with non-secret values and text-destructive", async () => {
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
    expect(classTokens(alert)).toContain("text-destructive");
    expect(alert.textContent).toBe("Email or password is wrong.");
    expect(screen.getByText("An account is required to organize a plan.")).toBeTruthy();
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(
      "nour@example.com",
    );
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
    expect(screen.queryByText(/Signed in as/)).toBeNull();
    expect(router.push).not.toHaveBeenCalled();

    const urls = fetchUrls(fetchMock);
    expect(urls.some((url) => url.includes("/api/v1/plans"))).toBe(false);
    expect(urls.some((url) => url.includes("/api/v1/join"))).toBe(false);
    expect(urls.filter((url) => url === "/api/v1/sessions")).toEqual(["/api/v1/sessions"]);

    const posted = postCall(fetchMock, "/api/v1/sessions");
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

  it("keeps a failed registration on the gate, signed out, with non-secret values and text-destructive", async () => {
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
    expect(classTokens(alert)).toContain("text-destructive");
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
    expect(urls.some((url) => url.includes("/api/v1/plans"))).toBe(false);
    expect(urls.some((url) => url.includes("/join"))).toBe(false);

    const posted = postCall(fetchMock, "/api/v1/accounts");
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

  it("T-001-32/AC-1 continues to create after a successful sign-in", async () => {
    const fetchMock = stubFetch({ me: "out", sessions: "ok" });
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
    expect(fetchUrls(fetchMock)).toEqual(["/api/v1/me", "/api/v1/sessions"]);
  });

  it("T-001-32/AC-1 continues to join, home, or invitations after success", async () => {
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

  it("T-001-32/AC-2 shows the display name and a way home when already signed in", async () => {
    stubFetch({ me: "in" });
    renderGate("/plans/new");
    expect(await screen.findByText("Signed in as Nour")).toBeTruthy();
    const home = screen.getByRole("link", { name: "Go home" });
    expect(home.getAttribute("href")).toBe("/");
    expect(classTokens(home)).toContain("bg-primary");
    expect(screen.queryByText("An account is required to organize a plan.")).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("T-001-48/AC-2 starts signed in from initial data and sends exactly one GET /api/v1/me, the slide", async () => {
    const fetchMock = stubFetch({ me: "in" });
    renderGateWith({ next: "/plans/new", initialAccount: nourAccount });
    expect(screen.getByText("Signed in as Nour")).toBeTruthy();
    expect(screen.queryByText("An account is required to organize a plan.")).toBeNull();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/me", { credentials: "same-origin" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("T-001-48/AC-3 sends exactly one GET /api/v1/me after mount with initial data and none with null", async () => {
    const withData = stubFetch({ me: "in" });
    const view = renderGateWith({ initialAccount: nourAccount });
    await waitFor(() => {
      expect(withData).toHaveBeenCalledTimes(1);
    });
    view.rerender(
      <NextIntlClientProvider locale="en" messages={en}>
        <AccountGate initialAccount={nourAccount} />
      </NextIntlClientProvider>,
    );
    expect(withData).toHaveBeenCalledTimes(1);
    cleanup();

    const withNull = stubFetch({ me: "out" });
    renderGateWith({ initialAccount: null });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(withNull).not.toHaveBeenCalled();
  });

  it("T-001-48/AC-4 null initial data shows the sign-in form with no request and keeps the join link", () => {
    const fetchMock = stubFetch({ me: "out" });
    renderGateWith({ next: JOIN_PATH, initialAccount: null });
    expect(screen.getByText("An account is required to organize a plan.")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Join without an account" }).getAttribute("href"),
    ).toBe(JOIN_PATH);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("T-001-48/AC-4 initial data without a display name shows the sign-in form and sends no request", () => {
    const fetchMock = stubFetch({ me: "in" });
    renderGateWith({ initialAccount: { account: { id: "acc_1" } } });
    expect(screen.getByText("An account is required to organize a plan.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("T-001-48/AC-5 with no initialAccount prop the gate makes its first-load GET /api/v1/me as before", async () => {
    const signedOut = stubFetch({ me: "out" });
    renderGate();
    expect(screen.queryByText("An account is required to organize a plan.")).toBeNull();
    await screen.findByText("An account is required to organize a plan.");
    expect(fetchUrls(signedOut)).toEqual(["/api/v1/me"]);
    cleanup();

    // The contrast: the page's null starts signed out with no request at all.
    const withNull = stubFetch({ me: "out" });
    renderGateWith({ initialAccount: null });
    expect(screen.getByText("An account is required to organize a plan.")).toBeTruthy();
    expect(withNull).not.toHaveBeenCalled();
    cleanup();

    const signedIn = stubFetch({ me: "in" });
    renderGate();
    expect(await screen.findByText("Signed in as Nour")).toBeTruthy();
    expect(fetchUrls(signedIn)).toEqual(["/api/v1/me"]);
  });

  it("T-001-48/AC-7 signing in from the account page with null initial data redirects to the allow-listed next", async () => {
    const fetchMock = stubFetch({ me: "out" });
    renderGateWith({ next: "/invitations", initialAccount: null });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "nour@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password1" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith("/invitations");
    });
    expect(postCall(fetchMock, "/api/v1/sessions")?.method).toBe("POST");
  });

  it("T-001-48/AC-7 registering from the account page with null initial data redirects to the join next", async () => {
    const fetchMock = stubFetch({ me: "out" });
    renderGateWith({ next: JOIN_PATH, initialAccount: null });
    fireEvent.click(screen.getByRole("tab", { name: "Create account" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "nour@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password1" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Nour" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(JOIN_PATH);
    });
    expect(postCall(fetchMock, "/api/v1/accounts")?.method).toBe("POST");
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

  it("T-001-92/AC-2 T-001-08/AC-1 signed out, the gate says an account is required to organize, and a join next offers a way back to join without an account", async () => {
    // Signed out (GET /api/v1/me is 401) with no next: the requirement, no join link.
    const plain = await renderSignedOut();
    expect(fetchUrls(plain)).toEqual(["/api/v1/me"]);
    expect(screen.getByText(en.Account.requiredToOrganize)).toBeTruthy();
    expect(screen.queryByText(/Signed in as/)).toBeNull();
    expect(screen.getByRole("button", { name: en.Account.submitSignIn })).toBeTruthy();
    expect(screen.queryByRole("link", { name: en.Account.joinWithoutAccount })).toBeNull();
    cleanup();

    // A next that is not a join path offers no join link either.
    await renderSignedOut("/plans/new");
    expect(screen.getByText(en.Account.requiredToOrganize)).toBeTruthy();
    expect(screen.queryByRole("link", { name: en.Account.joinWithoutAccount })).toBeNull();
    cleanup();

    // Signed out with a join next: the requirement and a link back to that join path.
    const joining = await renderSignedOut(JOIN_PATH);
    expect(fetchUrls(joining)).toEqual(["/api/v1/me"]);
    expect(screen.getByText(en.Account.requiredToOrganize)).toBeTruthy();
    const back = screen.getByRole("link", { name: en.Account.joinWithoutAccount });
    expect(back.getAttribute("href")).toBe(JOIN_PATH);
    expect(screen.queryByText(/Signed in as/)).toBeNull();
  });

  it("T-001-92/AC-2 T-001-08/AC-3 after success the gate continues to create, join, home, or invitations, and opened while signed in it shows the display name and a way home", async () => {
    async function signInWith(next: string): Promise<void> {
      stubFetch({ me: "out", sessions: "ok" });
      renderGate(next);
      await screen.findByText(en.Account.requiredToOrganize);
      fireEvent.change(screen.getByLabelText(en.Account.email), { target: { value: "nour@example.com" } });
      fireEvent.change(screen.getByLabelText(en.Account.password), { target: { value: "a-secret-pass" } });
      fireEvent.click(screen.getByRole("button", { name: en.Account.submitSignIn }));
    }

    for (const next of ["/plans/new", JOIN_PATH, "/", "/invitations"]) {
      router.push.mockReset();
      await signInWith(next);
      await waitFor(() => {
        expect(router.push).toHaveBeenCalledWith(next);
      });
      expect(router.push).toHaveBeenCalledTimes(1);
      cleanup();
    }

    // Registration success continues the same way.
    for (const next of ["/plans/new", JOIN_PATH, "/", "/invitations"]) {
      router.push.mockReset();
      stubFetch({ me: "out", accounts: "ok" });
      renderGate(next);
      await screen.findByText(en.Account.requiredToOrganize);
      fireEvent.click(screen.getByRole("tab", { name: en.Account.register }));
      fireEvent.change(screen.getByLabelText(en.Account.email), { target: { value: "nour@example.com" } });
      fireEvent.change(screen.getByLabelText(en.Account.password), { target: { value: "a-secret-pass" } });
      fireEvent.change(screen.getByLabelText(en.Account.displayName), { target: { value: "Nour" } });
      fireEvent.click(screen.getByRole("button", { name: en.Account.submitRegister }));
      await waitFor(() => {
        expect(router.push).toHaveBeenCalledWith(next);
      });
      cleanup();
    }

    // Already signed in: the display name and a link home, and no redirect on its own.
    router.push.mockReset();
    stubFetch({ me: "in" });
    renderGate("/plans/new");
    expect(await screen.findByText(en.Account.signedInAs.replace("{name}", "Nour"))).toBeTruthy();
    const home = screen.getByRole("link", { name: en.Account.goHome });
    expect(home.getAttribute("href")).toBe("/");
    expect(screen.queryByText(en.Account.requiredToOrganize)).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
  });
});
