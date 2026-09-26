import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ROUTES_FIELD_MASK,
  ROUTES_MATRIX_URL,
  ROUTES_ROUTING_PREFERENCE,
  ROUTES_TRAVEL_MODE,
  computeRouteMatrix,
  isUsableRouteMatrixElement,
  parseDurationSeconds,
  type FetchFn,
} from "./routes";

type Captured = {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: unknown;
};

const originalMapsKey = process.env.GOOGLE_MAPS_API_KEY;
const originalApiKey = process.env.GOOGLE_API_KEY;

function headerRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (headers === undefined) {
    return {};
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return { ...headers };
}

function header(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) {
      return value;
    }
  }
  return undefined;
}

function captureFetch(
  body: unknown,
  captured: Captured[],
  status = 200,
): FetchFn {
  return async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    captured.push({
      url,
      method: init?.method,
      headers: headerRecord(init?.headers),
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", async () => {
    throw new Error("unit tests must not call the network");
  });
  delete process.env.GOOGLE_MAPS_API_KEY;
  delete process.env.GOOGLE_API_KEY;
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalMapsKey === undefined) {
    delete process.env.GOOGLE_MAPS_API_KEY;
  } else {
    process.env.GOOGLE_MAPS_API_KEY = originalMapsKey;
  }
  if (originalApiKey === undefined) {
    delete process.env.GOOGLE_API_KEY;
  } else {
    process.env.GOOGLE_API_KEY = originalApiKey;
  }
});

describe("computeRouteMatrix", () => {
  it("POSTs DRIVE, TRAFFIC_UNAWARE, lat/lng waypoints, and the contracted field mask", async () => {
    const captured: Captured[] = [];
    const origins = [{ latitude: 29.96, longitude: 31.25 }];
    const destinations = [
      { latitude: 30.0444, longitude: 31.2357 },
      { latitude: 30.05, longitude: 31.24 },
    ];
    const results = await computeRouteMatrix(
      { origins, destinations },
      {
        apiKey: "routes-key",
        fetch: captureFetch(
          [
            {
              originIndex: 0,
              destinationIndex: 0,
              status: {},
              condition: "ROUTE_EXISTS",
              duration: "327s",
            },
            {
              originIndex: 0,
              destinationIndex: 1,
              status: {},
              condition: "ROUTE_EXISTS",
              duration: "1.9s",
            },
          ],
          captured,
        ),
      },
    );

    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe(ROUTES_MATRIX_URL);
    expect(captured[0]?.url).toBe(
      "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
    );
    expect(captured[0]?.method).toBe("POST");
    expect(header(captured[0]?.headers ?? {}, "X-Goog-Api-Key")).toBe(
      "routes-key",
    );
    expect(header(captured[0]?.headers ?? {}, "X-Goog-FieldMask")).toBe(
      ROUTES_FIELD_MASK,
    );
    expect(header(captured[0]?.headers ?? {}, "X-Goog-FieldMask")).toBe(
      "originIndex,destinationIndex,status,condition,duration",
    );
    expect(header(captured[0]?.headers ?? {}, "X-Goog-FieldMask")).not.toContain(
      "*",
    );
    expect(captured[0]?.body).toEqual({
      origins: [
        {
          waypoint: {
            location: {
              latLng: { latitude: 29.96, longitude: 31.25 },
            },
          },
        },
      ],
      destinations: [
        {
          waypoint: {
            location: {
              latLng: { latitude: 30.0444, longitude: 31.2357 },
            },
          },
        },
        {
          waypoint: {
            location: {
              latLng: { latitude: 30.05, longitude: 31.24 },
            },
          },
        },
      ],
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_UNAWARE",
    });
    expect(ROUTES_TRAVEL_MODE).toBe("DRIVE");
    expect(ROUTES_ROUTING_PREFERENCE).toBe("TRAFFIC_UNAWARE");
    expect(results).toEqual([
      {
        originIndex: 0,
        destinationIndex: 0,
        status: {},
        condition: "ROUTE_EXISTS",
        durationSeconds: 327,
      },
      {
        originIndex: 0,
        destinationIndex: 1,
        status: {},
        condition: "ROUTE_EXISTS",
        durationSeconds: 1,
      },
    ]);
    expect(isUsableRouteMatrixElement(results[0]!)).toBe(true);
  });

  it("reads GOOGLE_API_KEY at call time when GOOGLE_MAPS_API_KEY is unset", async () => {
    process.env.GOOGLE_API_KEY = "fallback-key";
    const captured: Captured[] = [];
    await computeRouteMatrix(
      {
        origins: [{ latitude: 1, longitude: 2 }],
        destinations: [{ latitude: 3, longitude: 4 }],
      },
      { fetch: captureFetch([], captured) },
    );
    expect(header(captured[0]?.headers ?? {}, "X-Goog-Api-Key")).toBe(
      "fallback-key",
    );
  });

  it("drops a missing status, a non-ROUTE_EXISTS condition, and a duration under 1 second", () => {
    expect(
      isUsableRouteMatrixElement({
        originIndex: 0,
        destinationIndex: 0,
        status: undefined,
        condition: "ROUTE_EXISTS",
        durationSeconds: 10,
      }),
    ).toBe(false);
    expect(
      isUsableRouteMatrixElement({
        originIndex: 0,
        destinationIndex: 0,
        status: {},
        condition: "ROUTE_NOT_FOUND",
        durationSeconds: 10,
      }),
    ).toBe(false);
    expect(
      isUsableRouteMatrixElement({
        originIndex: 0,
        destinationIndex: 0,
        status: {},
        condition: "ROUTE_EXISTS",
        durationSeconds: 0,
      }),
    ).toBe(false);
  });
});

describe("parseDurationSeconds", () => {
  it("floors the returned duration to integer seconds", () => {
    expect(parseDurationSeconds("327s")).toBe(327);
    expect(parseDurationSeconds("1.9s")).toBe(1);
    expect(parseDurationSeconds("0.5s")).toBe(0);
    expect(parseDurationSeconds({ seconds: "12" })).toBe(12);
  });
});
