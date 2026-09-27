import type { GoogleClientOptions } from "@/server/google/routes";

let googleClientOptions: GoogleClientOptions | undefined;

export function setGoogleClientOptions(
  options: GoogleClientOptions | undefined,
): void {
  googleClientOptions = options;
}

export function swapGoogleOptions(): GoogleClientOptions | undefined {
  return googleClientOptions;
}
