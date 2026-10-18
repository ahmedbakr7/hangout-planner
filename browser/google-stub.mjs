import http from "node:http";

const HOST = "127.0.0.1";
const SCRIPT_PORT = 3125;
const PLACE_PATH_PREFIX = "/v1/places/";

const FIXTURE_PLACES = [
  {
    id: "ChIJstubmaadi1",
    displayName: { text: "Stub Koshary House" },
    location: { latitude: 29.96, longitude: 31.25 },
    priceRange: { startPrice: { currencyCode: "EGP", units: "120", nanos: 0 } },
  },
  {
    id: "ChIJstubmaadi2",
    displayName: { text: "Stub Grill Corner" },
    location: { latitude: 29.97, longitude: 31.26 },
    priceRange: { startPrice: { currencyCode: "EGP", units: "250", nanos: 500000000 } },
  },
];

const ROUTE_DURATION = "600s";

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function sendError(res, status) {
  sendJson(res, status, { error: { code: status } });
}

function hasUsableHeaders(req) {
  const apiKey = req.headers["x-goog-api-key"];
  const fieldMask = req.headers["x-goog-fieldmask"];
  return Boolean(apiKey) && Boolean(fieldMask) && !String(fieldMask).includes("*");
}

function placeIdFromPath(pathname) {
  try {
    return decodeURIComponent(pathname.slice(PLACE_PATH_PREFIX.length));
  } catch {
    return null;
  }
}

function routeMatrix(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = {};
  }
  if (parsed === null || typeof parsed !== "object") {
    parsed = {};
  }
  const origins = Array.isArray(parsed.origins) ? parsed.origins.length : 0;
  const destinations = Array.isArray(parsed.destinations) ? parsed.destinations.length : 0;
  const elements = [];
  for (let originIndex = 0; originIndex < origins; originIndex += 1) {
    for (let destinationIndex = 0; destinationIndex < destinations; destinationIndex += 1) {
      elements.push({
        originIndex,
        destinationIndex,
        status: {},
        condition: "ROUTE_EXISTS",
        duration: ROUTE_DURATION,
      });
    }
  }
  return elements;
}

function handle(req, res, body) {
  let pathname;
  try {
    ({ pathname } = new URL(req.url ?? "/", `http://${HOST}`));
  } catch {
    sendError(res, 404);
    return;
  }
  const method = req.method ?? "";
  const isSearch = method === "POST" && pathname === "/v1/places:searchText";
  const isMatrix = method === "POST" && pathname === "/distanceMatrix/v2:computeRouteMatrix";
  const isDetails =
    method === "GET" && pathname.startsWith(PLACE_PATH_PREFIX) && pathname.length > PLACE_PATH_PREFIX.length;
  if (!isSearch && !isMatrix && !isDetails) {
    sendError(res, 404);
    return;
  }
  if (!hasUsableHeaders(req)) {
    sendError(res, 400);
    return;
  }
  if (isSearch) {
    sendJson(res, 200, { places: FIXTURE_PLACES });
  } else if (isMatrix) {
    sendJson(res, 200, routeMatrix(body));
  } else {
    const id = placeIdFromPath(pathname);
    const place = FIXTURE_PLACES.find((candidate) => candidate.id === id);
    if (place === undefined) {
      sendError(res, 404);
      return;
    }
    sendJson(res, 200, place);
  }
}

export function startGoogleStub(port) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        handle(req, res, Buffer.concat(chunks).toString("utf8"));
      } catch {
        if (res.headersSent) {
          res.end();
        } else {
          sendError(res, 500);
        }
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, HOST, () => resolve(server));
  });
}

if (import.meta.url === new URL(process.argv[1] ?? "", "file:").href) {
  await startGoogleStub(SCRIPT_PORT);
}
