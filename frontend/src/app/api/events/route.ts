import { NextRequest } from "next/server";
import { getBusConnection, type BusSignal } from "@/app/lib/realtime/odoo-bus";
import { requireSession } from "@/app/lib/odoo/server";

// Proxies close idle streams: a comment line keeps this one open
const HEARTBEAT_INTERVAL_MS = 20_000;
// How long the browser waits before reconnecting a dropped stream
const RETRY_MS = 3_000;

/**
 * One event stream per tab, fed by the session's Odoo bus connection.
 *
 * Each event carries the bus notification id; a tab that reconnects sends
 * the last one it saw and gets what it missed, or a "resync" event when that
 * is no longer available.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const auth = await requireSession(request);
  if ("response" in auth) {
    return auth.response;
  }
  const { sessionId } = auth;
  const lastEventIdParam =
    request.headers.get("last-event-id") || url.searchParams.get("lastEventId");
  const lastEventId = lastEventIdParam ? Number(lastEventIdParam) : null;

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const write = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const send = (signal: BusSignal) => {
        const id = "id" in signal ? `id: ${signal.id}\n` : "";
        const data =
          "id" in signal
            ? { type: signal.type, payload: signal.payload }
            : { type: signal.type };
        write(`${id}data: ${JSON.stringify(data)}\n\n`);
      };

      write(`retry: ${RETRY_MS}\n\n`);
      const connection = getBusConnection(sessionId);
      const { replay, unsubscribe } = connection.subscribe(send, lastEventId);
      if (replay === null) {
        write(`data: ${JSON.stringify({ type: "resync" })}\n\n`);
      } else {
        replay.forEach(send);
      }

      const heartbeat = setInterval(() => {
        write(": ping\n\n");
      }, HEARTBEAT_INTERVAL_MS);

      let isCleanedUp = false;
      cleanup = () => {
        if (isCleanedUp) {
          return;
        }
        isCleanedUp = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed
        }
      };
      request.signal.addEventListener("abort", cleanup);
      if (request.signal.aborted) {
        cleanup();
      }
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx would otherwise buffer the stream
      "X-Accel-Buffering": "no",
    },
  });
}
