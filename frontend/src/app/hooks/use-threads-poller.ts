import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./use-auth";

export type ThreadsPollerCallbacks = {
  onThreadsFound?: (threads: unknown[]) => void;
  onError?: (error: Error) => void;
  onPollComplete?: () => void;
};

export type ThreadsPollerOptions = {
  enabled?: boolean;
  interval?: number; // Polling interval in milliseconds
};

/**
 * Hook for periodic thread list polling via REST API
 *
 * Covers threads the user never opened, when SSE drops:
 * 1. Thread list stays fresh for all conversations
 * 2. Unread counts update for unopened threads
 * 3. Works as fallback when no specific thread is open
 *
 * Default interval: 10 minutes (600000ms) - 20 seconds for dev testing
 */
export const useThreadsPoller = (
  callbacks: ThreadsPollerCallbacks,
  options: ThreadsPollerOptions = {}
) => {
  const { enabled = true, interval = 600000 } = options; // 10 minutes

  const { sessionId, isAuthenticating } = useAuth();
  const [isPolling, setIsPolling] = useState(false);
  const [lastPollTime, setLastPollTime] = useState<number | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const callbacksRef = useRef(callbacks);
  const isPollingRef = useRef(false);

  // Update callbacks ref when callbacks change
  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

  const poll = useCallback(async () => {
    // Prevent concurrent polls
    if (isPollingRef.current) {
      return;
    }

    // Wait for session validation to complete before polling
    if (!enabled || !sessionId || isAuthenticating) {
      return;
    }

    isPollingRef.current = true;
    setIsPolling(true);

    const pollStartTime = Date.now();

    try {
      const response = await fetch(`/api/threads`, {
        headers: {
          "x-session-id": sessionId,
        },
      });

      const pollDuration = Date.now() - pollStartTime;

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        const message =
          errorBody?.error ?? `Failed to poll threads (${response.status})`;
        console.error(
          `[ThreadsPoller] Poll failed (${pollDuration}ms): ${message}`
        );
        throw new Error(message);
      }

      const data = await response.json();
      const threads: unknown[] = Array.isArray(data?.threads)
        ? data.threads
        : [];

      // Always notify with threads (even if empty) to allow merge logic
      if (threads.length > 0) {
        callbacksRef.current.onThreadsFound?.(threads);
      }

      setLastPollTime(Date.now());
      callbacksRef.current.onPollComplete?.();
    } catch (error) {
      const pollDuration = Date.now() - pollStartTime;
      console.error(
        `[ThreadsPoller] Poll failed after ${pollDuration}ms:`,
        error
      );
      callbacksRef.current.onError?.(error as Error);
    } finally {
      isPollingRef.current = false;
      setIsPolling(false);
    }
  }, [enabled, sessionId, isAuthenticating]);

  // Start/stop polling based on dependencies
  useEffect(() => {
    if (!enabled || !sessionId || isAuthenticating) {
      // Clear interval if conditions not met
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Perform initial poll immediately
    poll();

    // Set up interval for subsequent polls
    intervalRef.current = setInterval(() => {
      poll();
    }, interval);

    // Cleanup on unmount or when dependencies change
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, sessionId, isAuthenticating, interval, poll]);

  return {
    isPolling,
    lastPollTime,
    poll, // Allow manual poll trigger
  };
};
