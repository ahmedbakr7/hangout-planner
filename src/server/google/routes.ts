export const ROUTES_MATRIX_URL =
  "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";

export const ROUTES_FIELD_MASK =
  "originIndex,destinationIndex,status,condition,duration";

export const ROUTES_TRAVEL_MODE = "DRIVE";

export const ROUTES_ROUTING_PREFERENCE = "TRAFFIC_UNAWARE";

export type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type GoogleClientOptions = {
  fetch?: FetchFn;
  apiKey?: string;
};

export type LatLng = {
  latitude: number;
  longitude: number;
};

export type RouteMatrixElement = {
  originIndex: number;
  destinationIndex: number;
  status: unknown;
  condition: string | undefined;
  durationSeconds: number | null;
};

export type ComputeRouteMatrixInput = {
  origins: readonly LatLng[];
  destinations: readonly LatLng[];
};

function readApiKey(options: GoogleClientOptions | undefined): string {
  const key =
    options?.apiKey ??
    process.env.GOOGLE_MAPS_API_KEY ??
    process.env.GOOGLE_API_KEY;
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("GOOGLE_MAPS_API_KEY is required");
  }
  return key;
}

function readFetch(options: GoogleClientOptions | undefined): FetchFn {
  const fetchFn = options?.fetch ?? globalThis.fetch;
  if (typeof fetchFn !== "function") {
    throw new Error("fetch is required");
  }
  return fetchFn;
}

function googHeaders(apiKey: string, fieldMask: string): Record<string, string> {
  if (fieldMask.includes("*")) {
    throw new Error("Google field mask must not contain a wildcard");
  }
  return {
    "X-Goog-Api-Key": apiKey,
    "X-Goog-FieldMask": fieldMask,
  };
}

function waypoint(point: LatLng): unknown {
  return {
    waypoint: {
      location: {
        latLng: {
          latitude: point.latitude,
          longitude: point.longitude,
        },
      },
    },
  };
}

export function parseDurationSeconds(value: unknown): number | null {
  if (typeof value === "string") {
    const match = /^(-?)(\d+)(?:\.(\d+))?s$/.exec(value);
    if (match === null) {
      return null;
    }
    const sign = match[1] === "-" ? -1 : 1;
    return sign * Number(match[2]);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value === "object" && value !== null) {
    const seconds = (value as { seconds?: unknown }).seconds;
    if (typeof seconds === "number" && Number.isFinite(seconds)) {
      return Math.floor(seconds);
    }
    if (typeof seconds === "string" && /^-?\d+$/.test(seconds)) {
      return Number(seconds);
    }
  }
  return null;
}

function parseIndex(value: unknown): number | null {
  if (value === undefined) {
    return 0;
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  return null;
}

export function parseRouteMatrixElement(
  value: unknown,
): RouteMatrixElement | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as {
    originIndex?: unknown;
    destinationIndex?: unknown;
    status?: unknown;
    condition?: unknown;
    duration?: unknown;
  };
  const originIndex = parseIndex(record.originIndex);
  const destinationIndex = parseIndex(record.destinationIndex);
  if (originIndex === null || destinationIndex === null) {
    return null;
  }
  return {
    originIndex,
    destinationIndex,
    status: record.status,
    condition: typeof record.condition === "string" ? record.condition : undefined,
    durationSeconds: parseDurationSeconds(record.duration),
  };
}

export function isUsableRouteMatrixElement(
  element: RouteMatrixElement,
): boolean {
  if (element.status === undefined || element.status === null) {
    return false;
  }
  if (element.condition !== "ROUTE_EXISTS") {
    return false;
  }
  return element.durationSeconds !== null && element.durationSeconds >= 1;
}

async function parseMatrixBody(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new Error("Routes matrix failed");
  }
  const text = (await response.text()).trim();
  if (text.length === 0) {
    return [];
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const rows: unknown[] = [];
    for (const line of text.split("\n")) {
      const row = line.trim();
      if (row.length === 0) {
        continue;
      }
      rows.push(JSON.parse(row) as unknown);
    }
    return rows;
  }
}

function elementsFromPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (typeof payload === "object" && payload !== null) {
    return [payload];
  }
  return [];
}

export async function computeRouteMatrix(
  input: ComputeRouteMatrixInput,
  options?: GoogleClientOptions,
): Promise<RouteMatrixElement[]> {
  const body = {
    origins: input.origins.map(waypoint),
    destinations: input.destinations.map(waypoint),
    travelMode: ROUTES_TRAVEL_MODE,
    routingPreference: ROUTES_ROUTING_PREFERENCE,
  };
  const response = await readFetch(options)(ROUTES_MATRIX_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...googHeaders(readApiKey(options), ROUTES_FIELD_MASK),
    },
    body: JSON.stringify(body),
  });
  const payload = await parseMatrixBody(response);
  const results: RouteMatrixElement[] = [];
  for (const raw of elementsFromPayload(payload)) {
    const parsed = parseRouteMatrixElement(raw);
    if (parsed !== null) {
      results.push(parsed);
    }
  }
  return results;
}
