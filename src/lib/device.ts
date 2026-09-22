"use client";

import { useSyncExternalStore } from "react";

const DEVICE_KEY = "ten-minutes-device-id";

export function useDeviceId() {
  return useSyncExternalStore(
    () => () => undefined,
    () => {
      let stored = window.localStorage.getItem(DEVICE_KEY);
      if (!stored) {
        stored = window.crypto.randomUUID();
        window.localStorage.setItem(DEVICE_KEY, stored);
      }
      return stored;
    },
    () => null,
  );
}

export function errorMessage(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "data" in error &&
    typeof error.data === "string"
  ) {
    return error.data;
  }
  if (!(error instanceof Error)) return "Something went wrong. Please try again.";
  return error.message.replace(/^\[CONVEX [^\]]+\]\s*/, "").split("\n")[0];
}
