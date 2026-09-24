import {
  createContext,
  PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../hooks/use-auth";
import { useTabSync } from "../hooks/use-tab-sync";
import { useConnection } from "./connection-provider";
import type {
  OdooMessageRecord,
  OdooThreadRecord,
} from "../lib/whatsapp/records";

export type RealtimeHandlers = {
  onThread?: (record: OdooThreadRecord) => void;
  onMessage?: (
    event: "created" | "updated",
    threadId: string,
    record: OdooMessageRecord
  ) => void;
};

type RealtimeContextValue = {
  subscribe: (handlers: { current: RealtimeHandlers }) => () => void;
  isConnected: boolean;
};

type StreamEvent =
  | { type: "whatsapp/thread"; payload: OdooThreadRecord }
  | {
      type: "whatsapp/message";
      payload: {
        event: "created" | "updated";
        thread_id: number;
        message: OdooMessageRecord;
      };
    }
  | { type: "resync" }
  | { type: "session-expired" };

export const RealtimeContext = createContext<RealtimeContextValue | undefined>(
  undefined
);

const RETRY_MS = 3_000;
const MAX_RETRY_MS = 60_000;
// After this many failed attempts, ask whether the session is still valid
const REVALIDATE_AFTER_RETRIES = 3;

/**
 * One event stream per tab, from the Odoo bus through /api/events.
 *
 * It resumes from the last event it saw after a drop; when the server can no
 * longer replay the gap it says "resync" and the cached data is reloaded.
 */
export default function RealtimeProvider({ children }: PropsWithChildren) {
  const { isAuthenticated, revalidateSession } = useAuth();
  const { isBlocked } = useTabSync();
  const { reportApiError, reportConnectionRestored } = useConnection();
  const queryClient = useQueryClient();
  const [isConnected, setIsConnected] = useState(false);
  const subscribersRef = useRef(new Set<{ current: RealtimeHandlers }>());
  const lastEventIdRef = useRef<string | null>(null);

  const subscribe = useCallback((handlers: { current: RealtimeHandlers }) => {
    subscribersRef.current.add(handlers);
    return () => {
      subscribersRef.current.delete(handlers);
    };
  }, []);

  useEffect(() => {
    // A tab blocked by the single-active-tab rule stays offline
    if (!isAuthenticated || isBlocked) {
      return;
    }
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retries = 0;
    let stopped = false;

    const dispatch = (event: StreamEvent) => {
      const subscribers = [...subscribersRef.current];
      switch (event.type) {
        case "whatsapp/thread":
          subscribers.forEach((s) => s.current.onThread?.(event.payload));
          break;
        case "whatsapp/message": {
          const { event: kind, thread_id, message } = event.payload;
          subscribers.forEach((s) =>
            s.current.onMessage?.(kind, String(thread_id), message)
          );
          break;
        }
        case "resync":
          void queryClient.invalidateQueries({ queryKey: ["threads"] });
          void queryClient.invalidateQueries({ queryKey: ["messages"] });
          void queryClient.invalidateQueries({ queryKey: ["unread-count"] });
          break;
        case "session-expired":
          // Signs out only if Odoo rejects the session
          revalidateSession().catch(() => undefined);
          break;
      }
    };

    const connect = () => {
      // The session cookie goes with the request
      const url = new URL("/api/events", window.location.origin);
      if (lastEventIdRef.current) {
        url.searchParams.set("lastEventId", lastEventIdRef.current);
      }
      source = new EventSource(url);
      source.onopen = () => {
        retries = 0;
        setIsConnected(true);
        reportConnectionRestored();
      };
      source.onmessage = (message) => {
        if (message.lastEventId) {
          lastEventIdRef.current = message.lastEventId;
        }
        try {
          dispatch(JSON.parse(message.data) as StreamEvent);
        } catch (error) {
          console.error("[Realtime]", "Unreadable event:", error);
        }
      };
      source.onerror = (error) => {
        // Reconnect here rather than natively: the URL carries the last
        // event id, and a rejected session must stop retrying.
        source?.close();
        setIsConnected(false);
        reportApiError(error);
        if (stopped) {
          return;
        }
        retries += 1;
        if (retries === REVALIDATE_AFTER_RETRIES) {
          revalidateSession().catch(() => undefined);
        }
        const delay =
          Math.min(RETRY_MS * 2 ** (retries - 1), MAX_RETRY_MS) *
          (0.5 + Math.random() / 2);
        retryTimer = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      source?.close();
      setIsConnected(false);
    };
  }, [
    isAuthenticated,
    isBlocked,
    queryClient,
    revalidateSession,
    reportApiError,
    reportConnectionRestored,
  ]);

  const value = useMemo(
    () => ({ subscribe, isConnected }),
    [subscribe, isConnected]
  );

  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  );
}
