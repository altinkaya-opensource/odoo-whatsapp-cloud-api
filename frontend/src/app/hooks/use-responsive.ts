"use client";

import { useSyncExternalStore } from "react";

// Below 768px the app shows one panel at a time
const MOBILE_QUERY = "(max-width: 767.98px)";

const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(MOBILE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

const isMobileNow = () => window.matchMedia(MOBILE_QUERY).matches;

// The server cannot know the width. The app shell only renders in the
// browser (after sign-in is checked), so this is never what users see.
const isMobileOnServer = () => false;

/**
 * Whether the viewport is phone-sized, from a media query: the browser
 * notifies only when the answer changes, not on every resize, and the
 * first render already has the right value.
 */
export function useResponsive() {
  const isMobile = useSyncExternalStore(
    subscribe,
    isMobileNow,
    isMobileOnServer
  );
  return { isMobile };
}
