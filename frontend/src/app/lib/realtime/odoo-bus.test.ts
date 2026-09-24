import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeSocket {
  static instances: FakeSocket[] = [];
  sent: string[] = [];
  private handlers = new Map<string, (event: unknown) => void>();

  constructor(
    public url: string,
    public init: { headers: Record<string, string> }
  ) {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, handler: (event: unknown) => void) {
    this.handlers.set(type, handler);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {}

  open() {
    this.handlers.get("open")?.({});
  }

  receive(ids: number[]) {
    const notifications = ids.map((id) => ({
      id,
      message: { type: "whatsapp/message", payload: { id } },
    }));
    this.handlers.get("message")?.({ data: JSON.stringify(notifications) });
  }

  drop(code: number) {
    this.handlers.get("close")?.({ code });
  }
}

const SESSION = "a".repeat(40);

describe("Odoo bus connection", () => {
  let getBusConnection: typeof import("./odoo-bus").getBusConnection;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubEnv("ODOO_JSONRPC_HOST", "odoo.test");
    vi.stubEnv("ODOO_JSONRPC_PORT", "8069");
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    FakeSocket.instances = [];
    vi.resetModules();
    ({ getBusConnection } = await import("./odoo-bus"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("subscribes with the session cookie and an Origin", () => {
    getBusConnection(SESSION);
    const [socket] = FakeSocket.instances;
    expect(socket.url).toBe("ws://odoo.test:8069/websocket");
    expect(socket.init.headers).toEqual({
      Cookie: `session_id=${SESSION}`,
      Origin: "http://odoo.test:8069",
    });
    socket.open();
    expect(JSON.parse(socket.sent[0])).toEqual({
      event_name: "subscribe",
      data: { channels: ["whatsapp"], last: 0 },
    });
  });

  it("replays what a tab missed, or asks it to resync", () => {
    const connection = getBusConnection(SESSION);
    const [socket] = FakeSocket.instances;
    const listener = vi.fn();
    connection.subscribe(listener, null);
    socket.open();
    socket.receive([5, 6, 7]);
    expect(listener).toHaveBeenCalledTimes(3);

    const ids = (replay: { id: number }[] | null) =>
      replay && replay.map((event) => event.id);
    expect(ids(connection.subscribe(vi.fn(), 7).replay)).toEqual([]);
    expect(ids(connection.subscribe(vi.fn(), 5).replay)).toEqual([6, 7]);
    // An event this connection never saw: the tab reloads its data
    expect(connection.subscribe(vi.fn(), 3).replay).toBeNull();
  });

  it("resumes from the last event after a drop", () => {
    getBusConnection(SESSION);
    const [first] = FakeSocket.instances;
    first.open();
    first.receive([41]);
    first.drop(1006);
    vi.advanceTimersByTime(1000);
    const [, second] = FakeSocket.instances;
    second.open();
    expect(JSON.parse(second.sent[0]).data.last).toBe(41);
  });

  it("tells the tabs when Odoo ends the session", () => {
    const connection = getBusConnection(SESSION);
    const listener = vi.fn();
    connection.subscribe(listener, null);
    FakeSocket.instances[0].drop(4001);
    expect(listener).toHaveBeenCalledWith({ type: "session-expired" });
    // The next tab opens a new connection
    expect(getBusConnection(SESSION)).not.toBe(connection);
  });
});
