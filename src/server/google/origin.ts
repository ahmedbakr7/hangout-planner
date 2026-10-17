const ORIGIN_VARIABLE = "HP_E2E_GOOGLE_BASE_URL";

const LOOPBACK_ORIGIN = /^http:\/\/(?:127\.0\.0\.1|localhost):([1-9][0-9]{0,4})$/;

const MAX_PORT = 65535;

/**
 * Request origin for the Google clients. Browser tests set
 * HP_E2E_GOOGLE_BASE_URL to a loopback stub; production never sets it.
 * Read on every call so tests can set and clear it.
 */
export function googleOrigin(defaultOrigin: string): string {
  const value = process.env[ORIGIN_VARIABLE];
  if (value === undefined || value === "") {
    return defaultOrigin;
  }
  const match = LOOPBACK_ORIGIN.exec(value);
  if (match === null || Number(match[1]) > MAX_PORT) {
    throw new Error(`${ORIGIN_VARIABLE} must be a loopback origin with a port`);
  }
  return value;
}
