/**
 * T-001-61 — the browser suite's local Google stub answers the real Google clients over HTTP with
 * fixture places, EGP start prices and a usable route element per pair, and refuses what Google
 * would refuse. No request leaves the machine.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startGoogleStub } from "../browser/google-stub.mjs";
import {
  getStartPlaceDetails,
  getVenuePlaceDetails,
  searchStartPlaces,
  searchVenuePlaces,
} from "@/server/google/places";
import { computeRouteMatrix, isUsableRouteMatrixElement } from "@/server/google/routes";

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
