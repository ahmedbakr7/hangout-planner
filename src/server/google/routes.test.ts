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
  vi.stubEnv("HP_E2E_GOOGLE_BASE_URL", "");
  delete process.env.GOOGLE_MAPS_API_KEY;
  delete process.env.GOOGLE_API_KEY;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
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
  it("T-001-91/AC-7 T-001-13/AC-3 POSTs DRIVE, TRAFFIC_UNAWARE, lat/lng waypoints, and the contracted field mask", async () => {
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

describe("Google origin override", () => {
  const input = {
    origins: [{ latitude: 29.96, longitude: 31.25 }],
    destinations: [{ latitude: 30.0444, longitude: 31.2357 }],
  };
  const row = [
    {
      originIndex: 0,
      destinationIndex: 0,
      status: {},
      condition: "ROUTE_EXISTS",
      duration: "60s",
    },
  ];

  it("T-001-60/AC-1 Route Matrix goes to routes.googleapis.com when the variable is empty", async () => {
    const captured: Captured[] = [];
    await computeRouteMatrix(input, {
      apiKey: "k",
      fetch: captureFetch(row, captured),
    });
    expect(captured[0]?.url).toBe(ROUTES_MATRIX_URL);
    expect(captured[0]?.url).toBe(
      "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
    );
  });

  it("T-001-60/AC-2 Route Matrix goes to the loopback origin with the same method, headers, and body", async () => {
    const unset: Captured[] = [];
    await computeRouteMatrix(input, {
      apiKey: "k",
      fetch: captureFetch(row, unset),
    });
    vi.stubEnv("HP_E2E_GOOGLE_BASE_URL", "http://localhost:4010");
    const set: Captured[] = [];
    await computeRouteMatrix(input, {
      apiKey: "k",
      fetch: captureFetch(row, set),
    });
    expect(set[0]?.url).toBe(
      "http://localhost:4010/distanceMatrix/v2:computeRouteMatrix",
    );
    expect(set[0]?.method).toBe(unset[0]?.method);
    expect(set[0]?.headers).toEqual(unset[0]?.headers);
    expect(set[0]?.body).toEqual(unset[0]?.body);
  });

  it.each([
    "https://127.0.0.1:4010",
    "http://example.com:4010",
    "http://localhost",
    "http://localhost:4010/",
  ])(
    "T-001-60/AC-3 %s rejects Route Matrix without sending or echoing",
    async (value) => {
      vi.stubEnv("HP_E2E_GOOGLE_BASE_URL", value);
      const captured: Captured[] = [];
      const error = await computeRouteMatrix(input, {
        fetch: captureFetch(row, captured),
      }).then(
        () => null,
        (reason: unknown) => reason as Error,
      );
      expect(error?.message).toContain("HP_E2E_GOOGLE_BASE_URL");
      expect(error?.message).not.toContain(value);
      expect(captured).toEqual([]);
    },
  );
});
