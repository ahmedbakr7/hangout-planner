export const PLACES_SEARCH_TEXT_URL =
  "https://places.googleapis.com/v1/places:searchText";

export const START_SEARCH_FIELD_MASK =
  "places.id,places.displayName,places.location";

export const START_DETAILS_FIELD_MASK = "id,displayName,location";

export const VENUE_SEARCH_FIELD_MASK =
  "places.id,places.displayName,places.location,places.priceRange";

export const VENUE_DETAILS_FIELD_MASK = "id,displayName,location,priceRange";

const NANOS_PER_MINOR = 10_000_000;
const MINOR_PER_UNIT = 100;

const REGION_BY_TIMEZONE: Readonly<Record<string, string>> = {
  "Africa/Cairo": "EG",
  "Asia/Riyadh": "SA",
  "Asia/Dubai": "AE",
};

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

export type StartPlace = {
  id: string;
  displayName: string;
  location: LatLng;
};

export type VenuePlace = StartPlace & {
  amountMinor: number;
  currencyCode: string;
};

export type StartPrice = {
  amountMinor: number;
  currencyCode: string;
};

export type SearchStartPlacesInput = {
  textQuery: string;
  languageCode: string;
  regionCode?: string;
};

export type SearchVenuePlacesInput = {
  textQuery: string;
  languageCode: string;
  planCurrency: string;
  locationBias: LatLng & { radiusMeters: number };
  regionCode?: string;
  pageSize?: number;
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

function parseUnits(value: unknown): number | null {
  if (value === undefined) {
    return 0;
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? value : null;
  }
  if (typeof value === "string") {
    if (value.length === 0 || !/^-?\d+$/.test(value)) {
      return null;
    }
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

/** amount_minor = units * 100 + nanos / 10000000 with exact integer division. */
export function parseStartPrice(startPrice: unknown): StartPrice | null {
  if (typeof startPrice !== "object" || startPrice === null) {
    return null;
  }
  const record = startPrice as {
    currencyCode?: unknown;
    units?: unknown;
    nanos?: unknown;
  };
  if (typeof record.currencyCode !== "string" || record.currencyCode.length === 0) {
    return null;
  }
  const units = parseUnits(record.units);
  if (units === null || !Number.isSafeInteger(units * MINOR_PER_UNIT)) {
    return null;
  }
  const nanos = record.nanos === undefined ? 0 : record.nanos;
  if (
    typeof nanos !== "number" ||
    !Number.isInteger(nanos) ||
    nanos < 0 ||
    nanos % NANOS_PER_MINOR !== 0
  ) {
    return null;
  }
  const amountMinor = units * MINOR_PER_UNIT + nanos / NANOS_PER_MINOR;
  if (!Number.isInteger(amountMinor) || amountMinor < 1) {
    return null;
  }
  return { amountMinor, currencyCode: record.currencyCode };
}

function parseLatLng(value: unknown): LatLng | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as { latitude?: unknown; longitude?: unknown };
  if (
    typeof record.latitude !== "number" ||
    typeof record.longitude !== "number" ||
    !Number.isFinite(record.latitude) ||
    !Number.isFinite(record.longitude)
  ) {
    return null;
  }
  return { latitude: record.latitude, longitude: record.longitude };
}

function parseDisplayName(value: unknown): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const text = (value as { text?: unknown }).text;
  if (typeof text !== "string" || text.length === 0) {
    return null;
  }
  return text;
}

function parsePlaceId(value: unknown): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const id = (value as { id?: unknown }).id;
  if (typeof id !== "string" || id.length === 0) {
    return null;
  }
  return id;
}

function asPlaceRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function startPlaceFromPlace(place: unknown): StartPlace | null {
  const record = asPlaceRecord(place);
  if (record === null) {
    return null;
  }
  const id = parsePlaceId(record);
  const displayName = parseDisplayName(record.displayName);
  const location = parseLatLng(record.location);
  if (id === null || displayName === null || location === null) {
    return null;
  }
  return { id, displayName, location };
}

export function venueFromPlace(
  place: unknown,
  planCurrency: string,
): VenuePlace | null {
  const start = startPlaceFromPlace(place);
  if (start === null) {
    return null;
  }
  const record = asPlaceRecord(place);
  if (record === null) {
    return null;
  }
  const priceRange = record.priceRange;
  if (typeof priceRange !== "object" || priceRange === null) {
    return null;
  }
  const parsed = parseStartPrice(
    (priceRange as { startPrice?: unknown }).startPrice,
  );
  if (parsed === null || parsed.currencyCode !== planCurrency) {
    return null;
  }
  return {
    ...start,
    amountMinor: parsed.amountMinor,
    currencyCode: parsed.currencyCode,
  };
}

export function regionCodeForTimezone(timezone: string): string | undefined {
  return REGION_BY_TIMEZONE[timezone];
}

function detailsPlaceId(placeId: string): string {
  return placeId.startsWith("places/") ? placeId.slice("places/".length) : placeId;
}

async function readJson(
  response: Response,
  operation: string,
): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`${operation} failed`);
  }
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${operation} returned invalid JSON`);
  }
}

function placesFromPayload(payload: unknown): unknown[] {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }
  const places = (payload as { places?: unknown }).places;
  return Array.isArray(places) ? places : [];
}

async function postSearchText(
  body: Record<string, unknown>,
  fieldMask: string,
  options: GoogleClientOptions | undefined,
  operation: string,
): Promise<unknown> {
  const response = await readFetch(options)(PLACES_SEARCH_TEXT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...googHeaders(readApiKey(options), fieldMask),
    },
    body: JSON.stringify(body),
  });
  return readJson(response, operation);
}

async function getPlaceDetails(
  placeId: string,
  fieldMask: string,
  options: GoogleClientOptions | undefined,
  operation: string,
): Promise<unknown> {
  if (typeof placeId !== "string" || placeId.length === 0) {
    throw new Error("place id is required");
  }
  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(
    detailsPlaceId(placeId),
  )}`;
  const response = await readFetch(options)(url, {
    method: "GET",
    headers: googHeaders(readApiKey(options), fieldMask),
  });
  return readJson(response, operation);
}

export async function searchStartPlaces(
  input: SearchStartPlacesInput,
  options?: GoogleClientOptions,
): Promise<StartPlace[]> {
  const body: Record<string, unknown> = {
    textQuery: input.textQuery,
    languageCode: input.languageCode,
  };
  if (input.regionCode !== undefined) {
    body.regionCode = input.regionCode;
  }
  const payload = await postSearchText(
    body,
    START_SEARCH_FIELD_MASK,
    options,
    "Places start search",
  );
  const results: StartPlace[] = [];
  for (const place of placesFromPayload(payload)) {
    const parsed = startPlaceFromPlace(place);
    if (parsed !== null) {
      results.push(parsed);
    }
  }
  return results;
}

export async function searchVenuePlaces(
  input: SearchVenuePlacesInput,
  options?: GoogleClientOptions,
): Promise<VenuePlace[]> {
  const body: Record<string, unknown> = {
    textQuery: input.textQuery,
    languageCode: input.languageCode,
    pageSize: input.pageSize ?? 20,
    locationBias: {
      circle: {
        center: {
          latitude: input.locationBias.latitude,
          longitude: input.locationBias.longitude,
        },
        radius: input.locationBias.radiusMeters,
      },
    },
  };
  if (input.regionCode !== undefined) {
    body.regionCode = input.regionCode;
  }
  const payload = await postSearchText(
    body,
    VENUE_SEARCH_FIELD_MASK,
    options,
    "Places venue search",
  );
  const results: VenuePlace[] = [];
  for (const place of placesFromPayload(payload)) {
    const parsed = venueFromPlace(place, input.planCurrency);
    if (parsed !== null) {
      results.push(parsed);
    }
  }
  return results;
}

export async function getStartPlaceDetails(
  placeId: string,
  options?: GoogleClientOptions,
): Promise<StartPlace | null> {
  const payload = await getPlaceDetails(
    placeId,
    START_DETAILS_FIELD_MASK,
    options,
    "Places start details",
  );
  return startPlaceFromPlace(payload);
}

export async function getVenuePlaceDetails(
  placeId: string,
  planCurrency: string,
  options?: GoogleClientOptions,
): Promise<VenuePlace | null> {
  const payload = await getPlaceDetails(
    placeId,
    VENUE_DETAILS_FIELD_MASK,
    options,
    "Places venue details",
  );
  return venueFromPlace(payload, planCurrency);
}
