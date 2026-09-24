import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionCache } from "@/app/lib/session-cache";

const SESSION_ID = "e".repeat(40);

const mocks = vi.hoisted(() => {
  const session = { call: vi.fn() };
  const authenticate = vi.fn();
  // vitest 4 constructs mocks with Reflect.construct, so `new OdooClient()`
  // needs a real function here, not an arrow.
  const OdooClient = vi.fn(function () {
    return { authenticate };
  });
  return { OdooClient, authenticate, session };
});

vi.mock("@/app/lib/odoo/jsonrpc", () => ({ OdooClient: mocks.OdooClient }));

import { POST } from "./route";

const login = () =>
  POST(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "agent", password: "secret" }),
    })
  );

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.stubEnv("ODOO_JSONRPC_HOST", "odoo.test");
    vi.stubEnv("ODOO_JSONRPC_DATABASE", "test");
    mocks.session.call.mockResolvedValue({ backend_ids: [1] });
  });

  afterEach(() => {
    sessionCache.clear();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("puts the session in an HttpOnly cookie, never in the body", async () => {
    mocks.authenticate.mockResolvedValue({
      sessionId: SESSION_ID,
      result: { uid: 7 },
      session: mocks.session,
    });

    const response = await login();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toContain(SESSION_ID);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`whatsapp_session=${SESSION_ID}`);
    expect(cookie).toMatch(/HttpOnly/i);
  });

  it("keeps a TOTP half-session out of the session cookie", async () => {
    mocks.authenticate.mockResolvedValue({
      sessionId: SESSION_ID,
      result: { uid: null },
      session: mocks.session,
    });

    const response = await login();

    expect(await response.json()).toEqual({ totpRequired: true });
    expect(response.headers.get("set-cookie")).not.toContain(
      "whatsapp_session="
    );
  });
});
