/**
 * T-001-61 — the browser suite's local Google stub answers the real Google clients over HTTP with
 * fixture places, EGP start prices and a usable route element per pair, and refuses what Google
 * would refuse. No request leaves the machine.
 */
import { spawn } from "node:child_process";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { scriptPort, startGoogleStub } from "../browser/google-stub.mjs";
import {
  getStartPlaceDetails,
  getVenuePlaceDetails,
  searchStartPlaces,
  searchVenuePlaces,
} from "@/server/google/places";
import { computeRouteMatrix, isUsableRouteMatrixElement } from "@/server/google/routes";

const root = path.resolve(import.meta.dirname, "..");
const PORT_VARIABLE = "HP_E2E_GOOGLE_STUB_PORT";
const ORIGIN_VARIABLE = "HP_E2E_GOOGLE_BASE_URL";
const OPTIONS = { apiKey: "test-key" };
const HEADERS = { "X-Goog-Api-Key": "test-key", "X-Goog-FieldMask": "id" };
const POINTS = [
  { latitude: 29.96, longitude: 31.25 },
  { latitude: 29.97, longitude: 31.26 },
];

let server: http.Server;
let origin: string;

beforeAll(async () => {
  server = (await startGoogleStub(0)) as http.Server;
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.stubEnv(ORIGIN_VARIABLE, origin);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Google stub", () => {
  it("T-001-61/AC-1 the unchanged clients parse the stub's places, EGP prices and route pairs", async () => {
    const recorded: { origin: string; method: string; path: string }[] = [];
    const recordingFetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.origin !== origin) {
        throw new Error("request left the stub origin");
      }
      recorded.push({ origin: url.origin, method: init?.method ?? "GET", path: url.pathname });
      return fetch(input, init);
    };
    const options = { ...OPTIONS, fetch: recordingFetch };

    const starts = await searchStartPlaces({ textQuery: "Maadi", languageCode: "en" }, options);
    const venues = await searchVenuePlaces(
      {
        textQuery: "Koshary",
        languageCode: "en",
        planCurrency: "EGP",
        locationBias: { ...POINTS[0], radiusMeters: 15000 },
      },
      options,
    );
    const startDetails = await getStartPlaceDetails(starts[1].id, options);
    const venueDetails = await getVenuePlaceDetails(venues[1].id, "EGP", options);
    const matrix = await computeRouteMatrix({ origins: POINTS, destinations: POINTS }, options);

    expect(starts.map((place) => place.displayName)).toEqual(["Stub Koshary House", "Stub Grill Corner"]);
    expect(venues.map((place) => [place.id, place.amountMinor, place.currencyCode])).toEqual([
      ["ChIJstubmaadi1", 12000, "EGP"],
      ["ChIJstubmaadi2", 25050, "EGP"],
    ]);
    expect(startDetails?.id).toBe(starts[1].id);
    expect(venueDetails).toMatchObject({ id: venues[1].id, amountMinor: 25050, currencyCode: "EGP" });
    expect(matrix.every(isUsableRouteMatrixElement)).toBe(true);
    expect(matrix.map((element) => `${element.originIndex}-${element.destinationIndex}`).sort()).toEqual([
      "0-0",
      "0-1",
      "1-0",
      "1-1",
    ]);
    expect(new Set(recorded.map((request) => request.origin))).toEqual(new Set([origin]));
    expect(new Set(recorded.map((request) => `${request.method} ${request.path}`))).toEqual(
      new Set([
        "POST /v1/places:searchText",
        "GET /v1/places/ChIJstubmaadi2",
        "POST /distanceMatrix/v2:computeRouteMatrix",
      ]),
    );
  });

  it("T-001-61/AC-2 answers 404 outside its three, 400 on bad headers, then 404 for an unknown place id", async () => {
    const send = (method: string, path: string, headers: Record<string, string> = HEADERS) =>
      fetch(`${origin}${path}`, { method, headers, body: method === "POST" ? "{}" : undefined });

    expect((await send("GET", "/v1/places:searchText")).status).toBe(404);
    expect((await send("POST", "/v1/places/ChIJstubmaadi1")).status).toBe(404);
    expect((await send("POST", "/elsewhere")).status).toBe(404);
    expect((await send("GET", "/elsewhere", {})).status).toBe(404);

    const missingKey = { "X-Goog-FieldMask": "id" };
    const missingMask = { "X-Goog-Api-Key": "test-key" };
    const wildcardMask = { "X-Goog-Api-Key": "test-key", "X-Goog-FieldMask": "*" };
    for (const [method, path] of [
      ["POST", "/v1/places:searchText"],
      ["GET", "/v1/places/ChIJstubmaadi1"],
      ["POST", "/distanceMatrix/v2:computeRouteMatrix"],
    ]) {
      for (const headers of [missingKey, missingMask, wildcardMask]) {
        expect((await send(method, path, headers)).status).toBe(400);
      }
    }
    expect((await send("GET", "/v1/places/ChIJunknown", {})).status).toBe(400);

    expect((await send("GET", "/v1/places/ChIJunknown")).status).toBe(404);
    expect((await send("GET", "/v1/places/%E0%A4%A")).status).toBe(404);
    expect((await send("GET", "/v1/places/ChIJstubmaadi1")).status).toBe(200);
  });

  it("T-001-61/AC-2 keeps serving after a null or malformed matrix body and an unparseable target", async () => {
    const validBody = JSON.stringify({ origins: [{}], destinations: [{}] });
    const matrix = (body: string) =>
      fetch(`${origin}/distanceMatrix/v2:computeRouteMatrix`, { method: "POST", headers: HEADERS, body });

    expect((await matrix("null")).status).toBe(200);
    expect((await matrix("{not json")).status).toBe(200);
    const valid = await matrix(validBody);
    expect(valid.status).toBe(200);
    expect(await valid.json()).toHaveLength(1);

    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port: new URL(origin).port, method: "GET", path: "//[" },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(404);
    expect((await matrix(validBody)).status).toBe(200);
  });
});

type StubExit = { status: number | null; stderr: string };

// Async on purpose: a blocking spawn starves the worker's RPC heartbeat to Vitest.
function runStub(port: string): { exit: Promise<StubExit>; kill: () => void } {
  const env = { ...process.env };
  env[PORT_VARIABLE] = port;
  const child = spawn("node", ["browser/google-stub.mjs"], { cwd: root, env });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const exit = new Promise<StubExit>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stderr }));
  });
  return { exit, kill: () => child.kill() };
}

async function freePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

async function searchUntilAnswered(port: number): Promise<number> {
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      const res = await fetch("http://127.0.0.1:" + port + "/v1/places:searchText", {
        method: "POST",
        headers: HEADERS,
        body: "{}",
      });
      return res.status;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

describe("Google stub script port", () => {
  it("T-001-72/AC-1 the script listens on HP_E2E_GOOGLE_STUB_PORT and answers a place search", async () => {
    const port = await freePort();
    const stub = runStub(String(port));
    try {
      expect(await searchUntilAnswered(port)).toBe(200);
    } finally {
      stub.kill();
      await stub.exit;
    }
  });

  it("T-001-72/AC-2 an unset or empty variable gives the script port 3125", () => {
    vi.stubEnv(PORT_VARIABLE, undefined);
    expect(scriptPort()).toBe(3125);
    vi.stubEnv(PORT_VARIABLE, "");
    expect(scriptPort()).toBe(3125);
    vi.stubEnv(PORT_VARIABLE, "4125");
    expect(scriptPort()).toBe(4125);
  });

  it.each(["abc", "0", "65536", "3125x", "03125"])(
    "T-001-72/AC-3 %s exits non-zero naming the variable and listens on no port",
    async (value) => {
      const stub = runStub(value);
      const timer = setTimeout(stub.kill, 5000);
      try {
        const { status, stderr } = await stub.exit;
        expect(status).toBeGreaterThan(0);
        expect(stderr).toContain(PORT_VARIABLE);
      } finally {
        clearTimeout(timer);
        stub.kill();
      }
    },
  );
});
