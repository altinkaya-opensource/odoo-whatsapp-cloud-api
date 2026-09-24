import { useContext, useEffect, useRef } from "react";
import {
  RealtimeContext,
  type RealtimeHandlers,
} from "../context/realtime-provider";

/**
 * Receive the tab's realtime thread and message events.
 *
 * The latest handlers are always called, without re-subscribing when they
 * change.
 */
export const useRealtime = (handlers: RealtimeHandlers) => {
  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error("useRealtime must be used within a RealtimeProvider");
  }
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });
  const { subscribe } = context;
  useEffect(() => subscribe(handlersRef), [subscribe]);
  return { isConnected: context.isConnected };
};
