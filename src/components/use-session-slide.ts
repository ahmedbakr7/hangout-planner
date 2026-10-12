"use client";

import { useEffect } from "react";

export function useSessionSlide(signedIn: boolean): void {
  useEffect(() => {
    if (!signedIn) {
      return;
    }
    try {
      fetch("/api/v1/me", { credentials: "same-origin" }).catch(() => {});
    } catch {
      // The slide is best effort; a failure changes nothing on screen.
    }
  }, [signedIn]);
}
