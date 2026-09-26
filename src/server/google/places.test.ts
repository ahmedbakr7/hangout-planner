import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PLACES_SEARCH_TEXT_URL,
  START_DETAILS_FIELD_MASK,
  START_SEARCH_FIELD_MASK,
  VENUE_DETAILS_FIELD_MASK,
  VENUE_SEARCH_FIELD_MASK,
  getStartPlaceDetails,
  getVenuePlaceDetails,
  parseStartPrice,
  regionCodeForTimezone,
  searchStartPlaces,
  searchVenuePlaces,
  startPlaceFromPlace,
  venueFromPlace,
  type FetchFn,
} from "./places";

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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
    return jsonResponse(body, status);
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

const startCafe = {
  id: "ChIJ-start",
  displayName: { text: "Maadi, Cairo" },
  location: { latitude: 29.96, longitude: 31.25 },
};

const pricedVenue = {
  id: "ChIJ-koshary",
  displayName: { text: "Koshary El Tahrir" },
  location: { latitude: 30.0444, longitude: 31.2357 },
  priceRange: {
    startPrice: { currencyCode: "EGP", units: "90", nanos: 0 },
    endPrice: { currencyCode: "EGP", units: "200", nanos: 0 },
  },
};

describe("field masks", () => {
  it("are the contracted strings, never a wildcard, and start omits priceRange", () => {
    expect(START_SEARCH_FIELD_MASK).toBe(
      "places.id,places.displayName,places.location",
    );
    expect(START_DETAILS_FIELD_MASK).toBe("id,displayName,location");
    expect(VENUE_SEARCH_FIELD_MASK).toBe(
      "places.id,places.displayName,places.location,places.priceRange",
    );
    expect(VENUE_DETAILS_FIELD_MASK).toBe(
      "id,displayName,location,priceRange",
    );
    expect(START_SEARCH_FIELD_MASK.includes("priceRange")).toBe(false);
    expect(START_DETAILS_FIELD_MASK.includes("priceRange")).toBe(false);
    expect(VENUE_SEARCH_FIELD_MASK.includes("places.priceRange")).toBe(true);
    expect(VENUE_DETAILS_FIELD_MASK.includes("priceRange")).toBe(true);
    for (const mask of [
      START_SEARCH_FIELD_MASK,
      START_DETAILS_FIELD_MASK,
      VENUE_SEARCH_FIELD_MASK,
      VENUE_DETAILS_FIELD_MASK,
    ]) {
      expect(mask.includes("*")).toBe(false);
    }
  });
});

describe("parseStartPrice", () => {
  it("uses amount_minor = units * 100 + nanos / 10000000 with exact integer division", () => {
    expect(
      parseStartPrice({ currencyCode: "EGP", units: 90, nanos: 0 }),
    ).toEqual({ amountMinor: 9000, currencyCode: "EGP" });
    expect(
      parseStartPrice({ currencyCode: "EGP", units: "12", nanos: 50_000_000 }),
    ).toEqual({ amountMinor: 1205, currencyCode: "EGP" });
    expect(
      parseStartPrice({ currencyCode: "USD", units: 10, nanos: 500_000_000 }),
    ).toEqual({ amountMinor: 1050, currencyCode: "USD" });
    expect(
      parseStartPrice({ currencyCode: "SAR", units: 0, nanos: 10_000_000 }),
    ).toEqual({ amountMinor: 1, currencyCode: "SAR" });
  });

  it("drops non-integer nanos, negative nanos, and a zero amount", () => {
    expect(
      parseStartPrice({ currencyCode: "EGP", units: 10, nanos: 1 }),
    ).toBeNull();
    expect(
      parseStartPrice({ currencyCode: "EGP", units: 10, nanos: 15_000_000 }),
    ).toBeNull();
    expect(
      parseStartPrice({ currencyCode: "EGP", units: 10, nanos: -10_000_000 }),
    ).toBeNull();
    expect(
      parseStartPrice({ currencyCode: "EGP", units: 0, nanos: 0 }),
    ).toBeNull();
  });
});

describe("venueFromPlace", () => {
  it("qualifies on startPrice and ignores endPrice", () => {
    expect(venueFromPlace(pricedVenue, "EGP")).toEqual({
      id: "ChIJ-koshary",
      displayName: "Koshary El Tahrir",
      location: { latitude: 30.0444, longitude: 31.2357 },
      amountMinor: 9000,
      currencyCode: "EGP",
    });
  });

  it("does not qualify a place that only has priceLevel", () => {
    expect(
      venueFromPlace(
        {
          id: "ChIJ-level",
          displayName: { text: "Fancy" },
          location: { latitude: 30, longitude: 31 },
          priceLevel: "PRICE_LEVEL_EXPENSIVE",
        },
        "EGP",
      ),
    ).toBeNull();
  });

  it("does not qualify a price in another currency or a place without a location", () => {
    expect(
      venueFromPlace(
        {
          ...pricedVenue,
          priceRange: {
            startPrice: { currencyCode: "USD", units: 20, nanos: 0 },
          },
        },
        "EGP",
      ),
    ).toBeNull();
    expect(
      venueFromPlace(
        {
          id: "ChIJ-nocoords",
          displayName: { text: "Somewhere" },
          priceRange: {
            startPrice: { currencyCode: "EGP", units: 90, nanos: 0 },
          },
        },
        "EGP",
      ),
    ).toBeNull();
  });

  it("still qualifies when priceLevel is present alongside a matching startPrice", () => {
    expect(
      venueFromPlace({ ...pricedVenue, priceLevel: "PRICE_LEVEL_MODERATE" }, "EGP")
        ?.amountMinor,
    ).toBe(9000);
  });
});

describe("startPlaceFromPlace", () => {
  it("requires id, displayName.text, and location", () => {
    expect(startPlaceFromPlace(startCafe)).toEqual({
      id: "ChIJ-start",
      displayName: "Maadi, Cairo",
      location: { latitude: 29.96, longitude: 31.25 },
    });
    expect(startPlaceFromPlace({ ...startCafe, location: undefined })).toBeNull();
  });
});

describe("regionCodeForTimezone", () => {
  it("maps the contracted IANA names and omits others", () => {
    expect(regionCodeForTimezone("Africa/Cairo")).toBe("EG");
    expect(regionCodeForTimezone("Asia/Riyadh")).toBe("SA");
    expect(regionCodeForTimezone("Asia/Dubai")).toBe("AE");
    expect(regionCodeForTimezone("Europe/London")).toBeUndefined();
  });
});

describe("searchStartPlaces", () => {
  it("POSTs searchText with the start mask, API key, and no location circle", async () => {
    const captured: Captured[] = [];
    const results = await searchStartPlaces(
      { textQuery: "Maadi", languageCode: "ar", regionCode: "EG" },
      { apiKey: "start-key", fetch: captureFetch({ places: [startCafe] }, captured) },
    );
    expect(results).toEqual([
      {
        id: "ChIJ-start",
        displayName: "Maadi, Cairo",
        location: { latitude: 29.96, longitude: 31.25 },
      },
    ]);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe(PLACES_SEARCH_TEXT_URL);
    expect(captured[0]?.method).toBe("POST");
    expect(header(captured[0]?.headers ?? {}, "X-Goog-Api-Key")).toBe(
      "start-key",
    );
    expect(header(captured[0]?.headers ?? {}, "X-Goog-FieldMask")).toBe(
      START_SEARCH_FIELD_MASK,
    );
    expect(header(captured[0]?.headers ?? {}, "X-Goog-FieldMask")).not.toContain(
      "*",
    );
    expect(header(captured[0]?.headers ?? {}, "X-Goog-FieldMask")).not.toContain(
      "priceRange",
    );
    expect(captured[0]?.body).toEqual({
      textQuery: "Maadi",
      languageCode: "ar",
      regionCode: "EG",
    });
    expect(captured[0]?.body).not.toHaveProperty("locationBias");
    expect(captured[0]?.url).toContain("places.googleapis.com");
  });

  it("reads GOOGLE_MAPS_API_KEY at call time", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "env-maps-key";
    const captured: Captured[] = [];
    await searchStartPlaces(
      { textQuery: "Maadi", languageCode: "en" },
      { fetch: captureFetch({ places: [] }, captured) },
    );
    expect(header(captured[0]?.headers ?? {}, "X-Goog-Api-Key")).toBe(
      "env-maps-key",
    );
  });
});

describe("searchVenuePlaces", () => {
  it("POSTs the venue mask with pageSize 20 and a circle bias", async () => {
    const captured: Captured[] = [];
    const results = await searchVenuePlaces(
      {
        textQuery: "koshary",
        languageCode: "en",
        planCurrency: "EGP",
        regionCode: "EG",
        locationBias: {
          latitude: 30.0444,
          longitude: 31.2357,
          radiusMeters: 15000,
        },
      },
      {
        apiKey: "venue-key",
        fetch: captureFetch(
          {
            places: [
              pricedVenue,
              {
                id: "ChIJ-level-only",
                displayName: { text: "Level Only" },
                location: { latitude: 30.05, longitude: 31.24 },
                priceLevel: "PRICE_LEVEL_INEXPENSIVE",
              },
            ],
          },
          captured,
        ),
      },
    );
    expect(results).toEqual([
      {
        id: "ChIJ-koshary",
        displayName: "Koshary El Tahrir",
        location: { latitude: 30.0444, longitude: 31.2357 },
        amountMinor: 9000,
        currencyCode: "EGP",
      },
    ]);
    expect(captured[0]?.url).toBe(PLACES_SEARCH_TEXT_URL);
    expect(captured[0]?.method).toBe("POST");
    expect(header(captured[0]?.headers ?? {}, "X-Goog-Api-Key")).toBe(
      "venue-key",
    );
    expect(header(captured[0]?.headers ?? {}, "X-Goog-FieldMask")).toBe(
      VENUE_SEARCH_FIELD_MASK,
    );
    expect(header(captured[0]?.headers ?? {}, "X-Goog-FieldMask")).toContain(
      "places.priceRange",
    );
    expect(header(captured[0]?.headers ?? {}, "X-Goog-FieldMask")).not.toContain(
      "*",
    );
    expect(captured[0]?.body).toEqual({
      textQuery: "koshary",
      languageCode: "en",
      pageSize: 20,
      regionCode: "EG",
      locationBias: {
        circle: {
          center: { latitude: 30.0444, longitude: 31.2357 },
          radius: 15000,
        },
      },
    });
  });
});

describe("place details", () => {
  it("GETs start details with the start mask and no priceRange", async () => {
    const captured: Captured[] = [];
    const result = await getStartPlaceDetails("ChIJ-start", {
      apiKey: "details-key",
      fetch: captureFetch(startCafe, captured),
    });
    expect(result).toEqual({
      id: "ChIJ-start",
      displayName: "Maadi, Cairo",
      location: { latitude: 29.96, longitude: 31.25 },
    });
    expect(captured[0]?.method).toBe("GET");
    expect(captured[0]?.url).toBe(
      "https://places.googleapis.com/v1/places/ChIJ-start",
    );
    expect(header(captured[0]?.headers ?? {}, "X-Goog-Api-Key")).toBe(
      "details-key",
    );
    expect(header(captured[0]?.headers ?? {}, "X-Goog-FieldMask")).toBe(
      START_DETAILS_FIELD_MASK,
    );
    expect(header(captured[0]?.headers ?? {}, "X-Goog-FieldMask")).not.toContain(
      "priceRange",
    );
    expect(captured[0]?.body).toBeUndefined();
  });

  it("GETs venue details with priceRange on the mask", async () => {
    const captured: Captured[] = [];
    const result = await getVenuePlaceDetails("places/ChIJ-koshary", "EGP", {
      apiKey: "details-key",
      fetch: captureFetch(pricedVenue, captured),
    });
    expect(result?.amountMinor).toBe(9000);
    expect(captured[0]?.url).toBe(
      "https://places.googleapis.com/v1/places/ChIJ-koshary",
    );
    expect(header(captured[0]?.headers ?? {}, "X-Goog-FieldMask")).toBe(
      VENUE_DETAILS_FIELD_MASK,
    );
    expect(header(captured[0]?.headers ?? {}, "X-Goog-FieldMask")).toContain(
      "priceRange",
    );
  });

  it("does not qualify venue details that only have priceLevel", async () => {
    const result = await getVenuePlaceDetails("ChIJ-level", "EGP", {
      apiKey: "details-key",
      fetch: captureFetch(
        {
          id: "ChIJ-level",
          displayName: { text: "Level Only" },
          location: { latitude: 30, longitude: 31 },
          priceLevel: "PRICE_LEVEL_EXPENSIVE",
        },
        [],
      ),
    });
    expect(result).toBeNull();
  });
});
