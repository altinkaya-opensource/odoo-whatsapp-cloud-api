/**
 * One websocket to Odoo's bus per Odoo session, shared by the session's tabs.
 *
 * Odoo checks the session on every websocket message and only delivers the
 * channels of the user's backends (the "whatsapp" subscription), so this
 * server keeps no access list of its own. Recent events stay in a buffer so a
 * tab that reconnects gets what it missed.
 */
import { getOdooBaseUrl } from "../odoo/server";
import { sessionCache } from "../session-cache";

export type BusEvent = { id: number; type: string; payload: unknown };
export type BusSignal = BusEvent | { type: "session-expired" };
type Listener = (signal: BusSignal) => void;

type BusNotification = {
  id: number;
  message: { type: string; payload: unknown };
};

const BUFFER_SIZE = 500;
// Tabs reload and phones blink: keep the upstream socket for a while
const RELEASE_DELAY_MS = 30_000;
const MAX_RETRY_DELAY_MS = 30_000;
// Odoo closes the socket with this code when the session is gone
const SESSION_EXPIRED_CODE = 4001;

/** Odoo's websocket: ODOO_WEBSOCKET_URL, or /websocket next to JSON-RPC. */
const busUrl = () =>
  process.env.ODOO_WEBSOCKET_URL ||
  `${getOdooBaseUrl().replace(/^http/, "ws")}/websocket`;

class OdooBusConnection {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private buffer: BusEvent[] = [];
  private lastId = 0;
  private retries = 0;
  private closed = false;
  private releaseTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sessionId: string,
    private readonly onDispose: () => void
  ) {
    this.connect();
  }

  /**
   * Listen to the session's events.
   *
   * Returns the events after lastEventId, or null when the buffer no longer
   * reaches back that far and the tab has to reload its data.
   */
  subscribe(listener: Listener, lastEventId: number | null) {
    this.listeners.add(listener);
    if (this.releaseTimer) {
      clearTimeout(this.releaseTimer);
      this.releaseTimer = null;
    }
    // Replay only from an event this connection has seen; anything else
    // (a new connection after a restart, a gap longer than the buffer)
    // means the tab reloads its data.
    let replay: BusEvent[] | null = [];
    if (lastEventId !== null && lastEventId !== this.lastId) {
      const index = this.buffer.findIndex((event) => event.id === lastEventId);
      replay = index === -1 ? null : this.buffer.slice(index + 1);
    }
    const unsubscribe = () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && !this.releaseTimer) {
        this.releaseTimer = setTimeout(() => this.dispose(), RELEASE_DELAY_MS);
      }
    };
    return { replay, unsubscribe };
  }

  private connect() {
    const origin = getOdooBaseUrl();
    // Node's WebSocket (undici) accepts headers; Odoo requires an Origin
    const socket = new WebSocket(busUrl(), {
      headers: { Cookie: `session_id=${this.sessionId}`, Origin: origin },
    } as unknown as string[]);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.retries = 0;
      // From the last event seen, Odoo sends what happened meanwhile
      socket.send(
        JSON.stringify({
          event_name: "subscribe",
          data: { channels: ["whatsapp"], last: this.lastId },
        })
      );
    });

    socket.addEventListener("message", (message) => {
      let notifications: BusNotification[];
      try {
        notifications = JSON.parse(String(message.data));
      } catch {
        return;
      }
      for (const notification of notifications) {
        if (notification.id <= this.lastId) {
          continue;
        }
        this.lastId = notification.id;
        const event = {
          id: notification.id,
          type: notification.message.type,
          payload: notification.message.payload,
        };
        this.buffer.push(event);
        if (this.buffer.length > BUFFER_SIZE) {
          this.buffer.shift();
        }
        this.emit(event);
      }
    });

    socket.addEventListener("close", (event) => {
      if (this.closed) {
        return;
      }
      if (event.code === SESSION_EXPIRED_CODE) {
        console.warn("[OdooBus] Session expired, closing the bus connection");
        sessionCache.delete(this.sessionId);
        this.emit({ type: "session-expired" });
        this.dispose();
        return;
      }
      const delay = Math.min(1000 * 2 ** this.retries, MAX_RETRY_DELAY_MS);
      this.retries += 1;
      console.warn(
        `[OdooBus] Connection closed (${event.code}), retrying in ${delay} ms`
      );
      setTimeout(() => {
        if (!this.closed) {
          this.connect();
        }
      }, delay);
    });

    socket.addEventListener("error", () => {
      // "close" follows and schedules the retry
    });
  }

  private emit(signal: BusSignal) {
    for (const listener of this.listeners) {
      try {
        listener(signal);
      } catch (error) {
        console.error("[OdooBus] Listener failed:", error);
      }
    }
  }

  private dispose() {
    this.closed = true;
    this.socket?.close();
    this.listeners.clear();
    this.onDispose();
  }
}

// One node: the Next server is a single instance (see CLAUDE.md)
const connections = new Map<string, OdooBusConnection>();

/** The bus connection of an Odoo session, opened on first use. */
export const getBusConnection = (sessionId: string): OdooBusConnection => {
  let connection = connections.get(sessionId);
  if (!connection) {
    connection = new OdooBusConnection(sessionId, () =>
      connections.delete(sessionId)
    );
    connections.set(sessionId, connection);
  }
  return connection;
};
