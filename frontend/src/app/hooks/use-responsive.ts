"use client";

import { useState, useEffect } from "react";

const BREAKPOINTS = {
  mobile: 768,
} as const;

export function useResponsive() {
  const [isMobile, setIsMobile] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    const checkSize = () => {
      const width = window.innerWidth;
      setIsMobile(width < BREAKPOINTS.mobile);
      setIsInitialized(true);
    };

    // Initial check
    checkSize();

    // Listen for resize events
    window.addEventListener("resize", checkSize);

    return () => {
      window.removeEventListener("resize", checkSize);
    };
  }, []);

  return {
    isMobile,
    isInitialized,
  };
}
