import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSessionSlide } from "@/components/use-session-slide";

function Probe({ signedIn }: { signedIn: boolean }) {
  useSessionSlide(signedIn);
  return <p>screen</p>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useSessionSlide", () => {
  it("T-001-44/AC-1 sends one same-origin GET /api/v1/me after mount when signed in", () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<Probe signedIn />);
    view.rerender(<Probe signedIn />);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/me", {
      credentials: "same-origin",
    });
  });

  it("T-001-44/AC-1 sends no request when not signed in", () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<Probe signedIn={false} />);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("T-001-44/AC-2 a rejected request changes nothing and throws nothing", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("network down");
    });
    vi.stubGlobal("fetch", fetchMock);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Probe signedIn />);
    await new Promise((resolve) => setTimeout(resolve, 10));
    process.off("unhandledRejection", unhandled);
    expect(screen.getByText("screen")).toBeTruthy();
    expect(unhandled).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("T-001-44/AC-2 a 401 answer changes nothing the screen shows", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<Probe signedIn />);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("screen")).toBeTruthy();
  });
});
