import type { GoogleClientOptions } from "@/server/google/places";

let googleClientOptions: GoogleClientOptions | undefined;

export function setGoogleClientOptions(
  options: GoogleClientOptions | undefined,
): void {
  googleClientOptions = options;
}

export function responseGoogleOptions(): GoogleClientOptions | undefined {
  return googleClientOptions;
}
