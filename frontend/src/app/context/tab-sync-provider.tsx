"use client";

import {
  createContext,
  useEffect,
  useMemo,
  useState,
  PropsWithChildren,
} from "react";

const LOCK_NAME = "whatsapp-active-tab";
// Older versions kept the active tab here, with heartbeats
const LEGACY_STORAGE_KEY = "whatsapp_active_tab";

type TabSyncContextValue = {
  isBlocked: boolean;
  isActive: boolean;
};

export const TabSyncContext = createContext<TabSyncContextValue | undefined>(
  undefined
);

/**
 * One active tab per browser: the newest tab takes over, older ones show an
 * overlay and wait.
 *
 * The active tab holds a Web Lock. A new tab steals it; the tab it was taken
 * from queues for it again, so it becomes active as soon as the holder
 * closes, reloads or crashes. The browser keeps the books: no heartbeats,
 * timestamps or messages between tabs.
 */
export default function TabSyncProvider({ children }: PropsWithChildren) {
  const [isActive, setIsActive] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // Storage may be unavailable; nothing to clean up then
    }
    if (!navigator.locks) {
      // No Web Locks: no single-tab rule either
      setIsActive(true);
      return;
    }

    const stopWaiting = new AbortController();
    let release: (() => void) | null = null;

    // Held until release() or until another tab steals the lock
    const hold = () =>
      new Promise<void>((resolve) => {
        release = resolve;
        setIsActive(true);
        setIsBlocked(false);
      });

    const claim = (steal: boolean) => {
      const options: LockOptions = steal
        ? { steal: true }
        : { signal: stopWaiting.signal };
      navigator.locks.request(LOCK_NAME, options, hold).catch(() => {
        if (stopWaiting.signal.aborted) {
          return;
        }
        // Another tab took over: wait for our turn
        release = null;
        setIsActive(false);
        setIsBlocked(true);
        claim(false);
      });
    };

    claim(true);
    return () => {
      stopWaiting.abort();
      release?.();
    };
  }, []);

  const value = useMemo<TabSyncContextValue>(
    () => ({ isBlocked, isActive }),
    [isBlocked, isActive]
  );

  return (
    <TabSyncContext.Provider value={value}>{children}</TabSyncContext.Provider>
  );
}
