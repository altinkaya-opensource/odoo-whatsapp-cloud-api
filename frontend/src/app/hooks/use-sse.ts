import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./use-auth";

export type SSEUpdate = {
  type: "threads" | "messages" | "heartbeat";
  data?: {
    threads?: unknown[];
    messages?: unknown[];
    threadId?: string;
  };
  timestamp: number;
};

export type SSECallbacks = {
  onThreadsUpdate?: (threads: unknown[]) => void;
  onMessagesUpdate?: (messages: unknown[], threadId: string) => void;
  onHeartbeat?: (timestamp: number) => void;
  onError?: (error: Event) => void;
  onReconnect?: () => void;
};

export type SSEOptions = {
  threadId?: string | null;
  enabled?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  maxBackoff?: number; // Maximum backoff time in milliseconds
};

export const useSSE = (callbacks: SSECallbacks, options: SSEOptions = {}) => {
  const {
    threadId = null,
    enabled = true,
    reconnectInterval = 3000, // Start with 3s
    maxBackoff = 60000, // Max 60 seconds backoff
  } = options;

  const { sessionId, loginWithSessionId } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const [reconnectCount, setReconnectCount] = useState(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const callbacksRef = useRef(callbacks);
  const sessionRevalidationAttemptedRef = useRef(false);
  const lastSessionIdRef = useRef<string | null>(null);

  // Update callbacks ref when callbacks change
  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

  // Reset session revalidation flag when sessionId changes
  useEffect(() => {
    if (sessionId !== lastSessionIdRef.current) {
      sessionRevalidationAttemptedRef.current = false;
      lastSessionIdRef.current = sessionId;
    }
  }, [sessionId]);

  const connect = useCallback(() => {
    if (!enabled || !sessionId) {
      return;
    }

    // Prevent multiple simultaneous connections
    if (eventSourceRef.current) {
      const state = eventSourceRef.current.readyState;
      if (state === EventSource.CONNECTING || state === EventSource.OPEN) {
        return;
      }
    }

    // Close existing connection properly
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    try {
      // Build SSE URL
      const url = new URL("/api/events", window.location.origin);
      if (threadId) {
        url.searchParams.set("threadId", threadId);
      }

      // EventSource cannot set headers, so the session goes in the query
      url.searchParams.set("sessionId", sessionId);

      console.log(
        `[SSE] Connecting (attempt ${reconnectAttemptsRef.current + 1})...`
      );

      const eventSource = new EventSource(url.toString());
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        console.log("[SSE] Connected successfully");
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
        setReconnectCount(0);
        sessionRevalidationAttemptedRef.current = false;
        callbacksRef.current.onReconnect?.();
      };

      eventSource.onmessage = (event) => {
        try {
          const update: SSEUpdate = JSON.parse(event.data);

          switch (update.type) {
            case "threads":
              if (update.data?.threads) {
                callbacksRef.current.onThreadsUpdate?.(update.data.threads);
              }
              break;
            case "messages":
              if (update.data?.messages && update.data?.threadId) {
                callbacksRef.current.onMessagesUpdate?.(
                  update.data.messages,
                  update.data.threadId
                );
              }
              break;
            case "heartbeat":
              callbacksRef.current.onHeartbeat?.(update.timestamp);
              break;
          }
        } catch {
          // Failed to parse SSE message
        }
      };

      eventSource.onerror = async (error) => {
        console.log(
          `[SSE] Connection error (attempt ${reconnectAttemptsRef.current + 1})`
        );
        setIsConnected(false);
        callbacksRef.current.onError?.(error);

        // Close the failed connection
        eventSource.close();
        eventSourceRef.current = null;

        // Always attempt reconnection (unlimited retries)
        if (!enabled || !sessionId) {
          return;
        }

        reconnectAttemptsRef.current++;
        setReconnectCount(reconnectAttemptsRef.current);

        // After 3 failed attempts, try to revalidate session (likely 401 error)
        // This repopulates the server-side session cache if it was cleared
        if (
          reconnectAttemptsRef.current === 3 &&
          !sessionRevalidationAttemptedRef.current
        ) {
          console.log(
            "[SSE] Multiple failures detected, attempting session revalidation..."
          );
          sessionRevalidationAttemptedRef.current = true;

          try {
            await loginWithSessionId(sessionId);
            console.log(
              "[SSE] Session revalidated successfully, reconnecting immediately..."
            );
            // Reset attempts and reconnect immediately after successful revalidation
            reconnectAttemptsRef.current = 0;
            setReconnectCount(0);
            // Reconnect immediately on next tick
            setTimeout(() => connect(), 100);
            return;
          } catch (revalidationError) {
            console.error(
              "[SSE] Session revalidation failed:",
              revalidationError
            );
            // Continue with normal retry logic
          }
        }

        // Calculate exponential backoff with max cap
        // 3s, 6s, 12s, 24s, 48s, 60s, 60s, ...
        const backoffDelay = Math.min(
          reconnectInterval * Math.pow(2, reconnectAttemptsRef.current - 1),
          maxBackoff
        );

        console.log(`[SSE] Reconnecting in ${backoffDelay / 1000}s...`);

        // Clear any existing timeout
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }

        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, backoffDelay);
      };
    } catch (error) {
      console.error("[SSE] Failed to create connection:", error);
      setIsConnected(false);
    }
  }, [
    enabled,
    sessionId,
    threadId,
    reconnectInterval,
    maxBackoff,
    loginWithSessionId,
  ]);

  const disconnect = useCallback(() => {
    console.log("[SSE] Disconnecting...");

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setIsConnected(false);
    reconnectAttemptsRef.current = 0;
    setReconnectCount(0);
    sessionRevalidationAttemptedRef.current = false;
  }, []);

  // Connect/disconnect based on dependencies
  useEffect(() => {
    if (enabled && sessionId) {
      connect();
    } else {
      disconnect();
    }

    // Cleanup: disconnect when dependencies change or component unmounts
    return () => {
      disconnect();
    };
  }, [enabled, sessionId, threadId, connect, disconnect]);

  return {
    isConnected,
    reconnectCount,
    connect,
    disconnect,
  };
};
