/**
 * T-001-60 — the real Google clients, with the platform fetch, send their requests to the loopback
 * origin named by HP_E2E_GOOGLE_BASE_URL (a local stub answers), keep the default hosts when it is
 * unset, and send nothing when it is bad. No request leaves the machine.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getStartPlaceDetails, searchStartPlaces } from "@/server/google/places";
import { computeRouteMatrix } from "@/server/google/routes";

type Seen = { method: string; url: string; fieldMask: string | undefined; body: string };

const OPTIONS = { apiKey: "test-key" };
const ORIGIN_VARIABLE = "HP_E2E_GOOGLE_BASE_URL";
const PLACE = {
  id: "ChIJabc",
  displayName: { text: "Maadi, Cairo" },
  location: { latitude: 29.96, longitude: 31.25 },
};
const MATRIX_INPUT = {
  origins: [{ latitude: 1, longitude: 2 }],
  destinations: [{ latitude: 3, longitude: 4 }],
};

let server: http.Server;
let origin: string;
let seen: Seen[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      seen.push({
        method: req.method ?? "",
        url: req.url ?? "",
        fieldMask: req.headers["x-goog-fieldmask"] as string | undefined,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      res.setHeader("content-type", "application/json");
      if (req.url?.startsWith("/distanceMatrix/")) {
        res.end(
          JSON.stringify([
            { originIndex: 0, destinationIndex: 0, status: {}, condition: "ROUTE_EXISTS", duration: "840s" },
          ]),
        );
      } else if (req.url === "/v1/places:searchText") {
        res.end(JSON.stringify({ places: [PLACE] }));
      } else {
        res.end(JSON.stringify(PLACE));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  seen = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Google clients over a loopback origin", () => {
  it("T-001-60/AC-1 with the variable empty the clients still target the Google hosts", async () => {
    vi.stubEnv(ORIGIN_VARIABLE, "");
    const urls: string[] = [];
    const capture = async (input: string | URL | Request) => {
      urls.push(String(input));
      return new Response("{}", { status: 200 });
    };
    await searchStartPlaces({ textQuery: "Maadi", languageCode: "en" }, { ...OPTIONS, fetch: capture });
    await getStartPlaceDetails("ChIJabc", { ...OPTIONS, fetch: capture });
    await computeRouteMatrix(MATRIX_INPUT, { ...OPTIONS, fetch: capture });
    expect(urls).toEqual([
      "https://places.googleapis.com/v1/places:searchText",
      "https://places.googleapis.com/v1/places/ChIJabc",
      "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
    ]);
    expect(seen).toHaveLength(0);
  });

  it("T-001-60/AC-2 with a loopback origin a real HTTP stub receives the same path, method, field mask and body", async () => {
    vi.stubEnv(ORIGIN_VARIABLE, origin);
    const found = await searchStartPlaces({ textQuery: "Maadi", languageCode: "en", regionCode: "EG" }, OPTIONS);
    const details = await getStartPlaceDetails("ChIJabc", OPTIONS);
    const matrix = await computeRouteMatrix(MATRIX_INPUT, OPTIONS);

    expect(found.map((place) => place.id)).toEqual(["ChIJabc"]);
    expect(details?.displayName).toBe("Maadi, Cairo");
    expect(matrix).toHaveLength(1);
    expect(seen.map((request) => [request.method, request.url])).toEqual([
      ["POST", "/v1/places:searchText"],
      ["GET", "/v1/places/ChIJabc"],
      ["POST", "/distanceMatrix/v2:computeRouteMatrix"],
    ]);
    expect(seen[0].fieldMask).toBe("places.id,places.displayName,places.location");
    expect(JSON.parse(seen[0].body)).toEqual({ textQuery: "Maadi", languageCode: "en", regionCode: "EG" });
    expect(seen[1].fieldMask).toBe("id,displayName,location");
    expect(seen[2].fieldMask).toBe("originIndex,destinationIndex,status,condition,duration");
    expect(JSON.parse(seen[2].body)).toMatchObject({ travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE" });
  });

  it.each([
    ["https scheme", "https://127.0.0.1:4010"],
    ["another host", "http://example.com:4010"],
    ["no port", "http://127.0.0.1"],
    ["trailing slash", "http://127.0.0.1:4010/"],
    ["a path", "http://127.0.0.1:4010/v1"],
    ["a query", "http://127.0.0.1:4010?a=b"],
    ["a fragment", "http://127.0.0.1:4010#x"],
    ["credentials", "http://user:pw@127.0.0.1:4010"],
  ])("T-001-60/AC-3 a bad value (%s) rejects without echoing it and sends nothing", async (_label, value) => {
    vi.stubEnv(ORIGIN_VARIABLE, value);
    const calls = [
      () => searchStartPlaces({ textQuery: "Maadi", languageCode: "en" }, OPTIONS),
      () => getStartPlaceDetails("ChIJabc", OPTIONS),
      () => computeRouteMatrix(MATRIX_INPUT, OPTIONS),
    ];
    for (const call of calls) {
      const error = await call().then(
        () => null,
        (caught: unknown) => caught as Error,
      );
      expect(error).toBeInstanceOf(Error);
      expect(error?.message).toContain(ORIGIN_VARIABLE);
      expect(error?.message).not.toContain(value);
    }
    expect(seen).toHaveLength(0);
  });
});
