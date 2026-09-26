import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/en.json";
import { HomeList } from "@/components/home-list";

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

const collecting = {
  id: "pln_collectingaaaaaaaaaaaa",
  title: "Thursday in Maadi",
  answered_count: 1,
  threshold: 3,
  state: "collecting" as const,
};

const blocked = {
  id: "pln_blockedaaaaaaaaaaaaaa",
  title: "Friday downtown",
  answered_count: 2,
  threshold: 2,
  state: "blocked" as const,
};

const proposed = {
  id: "pln_proposedaaaaaaaaaaaaa",
  title: "Saturday walk",
  answered_count: 4,
  threshold: 3,
  state: "proposed" as const,
};

const locked = {
  id: "pln_lockedaaaaaaaaaaaaaaa",
  title: "Sunday brunch",
  answered_count: 5,
  threshold: 3,
  state: "locked" as const,
};

const leakedPlan = {
  id: "pln_otheraccountaaaaaaaaa",
  title: "Someone else's private plan",
  answered_count: 9,
  threshold: 9,
  state: "collecting" as const,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type FetchConfig = {
  me?: "in" | "out" | "fail";
  plans?: "empty" | "list" | "fail" | "leak";
};

function stubFetch(config: FetchConfig = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url === "/v1/me" && method === "GET") {
      if (config.me === "fail") {
        return jsonResponse(500, { error: { code: "upstream", fields: [] } });
      }
      if (config.me === "in") {
        return jsonResponse(200, nourAccount);
      }
      return jsonResponse(401, missingSession);
    }
    if (url === "/v1/plans" && method === "GET") {
      if (config.plans === "fail") {
        return jsonResponse(500, {
          error: { code: "upstream", fields: [] },
          plans: [leakedPlan],
        });
      }
      if (config.plans === "leak") {
        return jsonResponse(500, { plans: [leakedPlan] });
      }
      if (config.plans === "list") {
        return jsonResponse(200, {
          plans: [collecting, blocked, proposed, locked],
          truncated: false,
        });
      }
      return jsonResponse(200, { plans: [], truncated: false });
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderHome() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <HomeList />
    </NextIntlClientProvider>,
  );
}

function getCreateLink(): HTMLAnchorElement {
  return screen.getByRole("link", { name: "Create a plan" }) as HTMLAnchorElement;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.cookie = "hp_locale=;path=/;max-age=0";
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
});

describe("HomeList", () => {
  beforeEach(() => {
    stubFetch({ me: "out" });
  });

  it("signed-out home shows a create action that opens the account gate and shows no plan rows", async () => {
    const fetchMock = stubFetch({ me: "out", plans: "list" });
    renderHome();

    const create = await screen.findByRole("link", { name: "Create a plan" });
    expect(create.getAttribute("href")).toBe("/account?next=/plans/new");
    expect(screen.getByText("Friends enter through an invite link.")).toBeTruthy();
    expect(screen.queryByRole("listitem")).toBeNull();
    expect(screen.queryByText("Thursday in Maadi")).toBeNull();
    expect(screen.queryByText("This account has no plans yet.")).toBeNull();
    expect(screen.queryByText("The plan list could not be loaded.")).toBeNull();
    expect(screen.queryByRole("link", { name: "Invitations" })).toBeNull();

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls).toContain("/v1/me");
    expect(urls.some((url) => url === "/v1/plans")).toBe(false);
  });

  it("signed-in empty copy uses text-muted and is distinct from the error", async () => {
    stubFetch({ me: "in", plans: "empty" });
    renderHome();

    const empty = await screen.findByText("This account has no plans yet.");
    expect(empty.className.split(/\s+/)).toContain("text-muted");
    expect(empty.className.split(/\s+/)).not.toContain("danger");
    expect(screen.queryByText("The plan list could not be loaded.")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(getCreateLink().getAttribute("href")).toBe("/plans/new");
    expect(screen.getByRole("link", { name: "Invitations" }).getAttribute("href")).toBe(
      "/invitations",
    );
    expect(screen.queryByText("Friends enter through an invite link.")).toBeNull();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("a home load failure uses danger, offers retry, keeps create available, and hides empty copy and other plans", async () => {
    let plansCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/v1/me" && method === "GET") {
        return jsonResponse(200, nourAccount);
      }
      if (url === "/v1/plans" && method === "GET") {
        plansCalls += 1;
        if (plansCalls === 1) {
          return jsonResponse(500, {
            error: { code: "upstream", message: "fail", fields: [] },
            plans: [leakedPlan],
          });
        }
        return jsonResponse(200, {
          plans: [collecting],
          truncated: false,
        });
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHome();

    const alert = await screen.findByRole("alert");
    expect(alert.className.split(/\s+/)).toContain("danger");
    expect(alert.textContent).toBe("The plan list could not be loaded.");
    expect(screen.queryByText("This account has no plans yet.")).toBeNull();
    expect(screen.queryByText("Someone else's private plan")).toBeNull();
    expect(screen.queryByText("Thursday in Maadi")).toBeNull();
    expect(getCreateLink().getAttribute("href")).toBe("/plans/new");

    const retry = screen.getByRole("button", { name: "Retry" });
    fireEvent.click(retry);

    expect(await screen.findByText("Thursday in Maadi")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Someone else's private plan")).toBeNull();
    expect(screen.queryByText("This account has no plans yet.")).toBeNull();

    const planGets = fetchMock.mock.calls.filter(
      (call) => String(call[0]) === "/v1/plans",
    );
    expect(planGets.length).toBe(2);
    expect(planGets[0]?.[1]?.credentials).toBe("same-origin");
  });

  it("a loaded row shows title, answered count, threshold, and one state with the matching open", async () => {
    stubFetch({ me: "in", plans: "list" });
    renderHome();

    expect(await screen.findByText("Thursday in Maadi")).toBeTruthy();
    expect(screen.getByText("Friday downtown")).toBeTruthy();
    expect(screen.getByText("Saturday walk")).toBeTruthy();
    expect(screen.getByText("Sunday brunch")).toBeTruthy();
    expect(screen.queryByText("Someone else's private plan")).toBeNull();

    const collectingLink = screen.getByRole("link", {
      name: /Thursday in Maadi/,
    });
    expect(collectingLink.getAttribute("href")).toBe(
      `/plans/${collecting.id}`,
    );
    expect(collectingLink.textContent).toContain("1 of 3 answered");
    expect(collectingLink.textContent).toContain("collecting");
    expect(collectingLink.textContent).not.toContain("blocked");
    expect(collectingLink.textContent).not.toContain("proposed");
    expect(collectingLink.textContent).not.toContain("locked");

    const blockedLink = screen.getByRole("link", { name: /Friday downtown/ });
    expect(blockedLink.getAttribute("href")).toBe(`/plans/${blocked.id}`);
    expect(blockedLink.textContent).toContain("2 of 2 answered");
    expect(blockedLink.textContent).toContain("blocked");
    expect(blockedLink.querySelector(".danger")?.textContent).toBe("blocked");

    const proposedLink = screen.getByRole("link", { name: /Saturday walk/ });
    expect(proposedLink.getAttribute("href")).toBe(`/plans/${proposed.id}`);
    expect(proposedLink.textContent).toContain("4 of 3 answered");
    expect(proposedLink.textContent).toContain("proposed");
    expect(proposedLink.querySelector(".danger")).toBeNull();
    expect(proposedLink.querySelector(".success")).toBeNull();

    const lockedLink = screen.getByRole("link", { name: /Sunday brunch/ });
    expect(lockedLink.getAttribute("href")).toBe(
      `/plans/${locked.id}/confirmed`,
    );
    expect(lockedLink.textContent).toContain("5 of 3 answered");
    expect(lockedLink.textContent).toContain("locked");
    expect(lockedLink.querySelector(".success")?.textContent).toBe("locked");

    await waitFor(() => {
      expect(getCreateLink().getAttribute("href")).toBe("/plans/new");
    });
  });
});
