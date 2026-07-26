import { afterEach, describe, expect, it, vi } from "vitest";
import { OdooClient } from "../jsonrpc";

const PARTIAL_SESSION_ID = "a".repeat(40);
const FINAL_SESSION_ID = "b".repeat(40);

const jsonResponse = (body: unknown, sessionId?: string) =>
  new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      ...(sessionId ? { "set-cookie": `session_id=${sessionId}; Path=/` } : {}),
    },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OdooClient TOTP authentication", () => {
  it("keeps the password-authenticated partial session available for TOTP", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          jsonrpc: "2.0",
          id: 1,
          result: { uid: null },
        },
        PARTIAL_SESSION_ID
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new OdooClient({ host: "odoo.test", port: 8069 });
    const response = await client.authenticate({
      database: "16test2",
      username: "mfa@example.com",
      password: "password",
    });

    expect(response.result.uid).toBeNull();
    expect(response.sessionId).toBe(PARTIAL_SESSION_ID);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://odoo.test:8069/web/session/authenticate",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("verifies TOTP on the partial session and uses Odoo's rotated session id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          jsonrpc: "2.0",
          id: 1,
          result: {
            uid: 42,
            user_context: { lang: "tr_TR" },
          },
        },
        FINAL_SESSION_ID
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new OdooClient({ host: "odoo.test", port: 8069 });
    const response = await client.verifyTotp(PARTIAL_SESSION_ID, "123 456");

    expect(response.result.uid).toBe(42);
    expect(response.sessionId).toBe(FINAL_SESSION_ID);

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(request.headers).toMatchObject({
      Cookie: `session_id=${PARTIAL_SESSION_ID};`,
    });
    expect(JSON.parse(request.body as string)).toEqual({
      jsonrpc: "2.0",
      method: "call",
      params: { totp_token: "123 456" },
      id: 1,
    });
  });

  it("does not fall back to the partial session when Odoo omits the rotated cookie", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          jsonrpc: "2.0",
          id: 1,
          result: { uid: 42 },
        })
      )
    );

    const client = new OdooClient({ host: "odoo.test", port: 8069 });

    await expect(
      client.verifyTotp(PARTIAL_SESSION_ID, "123456")
    ).rejects.toThrow(
      "Unable to determine finalized Odoo session id from response"
    );
  });

  it("preserves Odoo's expired-session JSON-RPC error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          jsonrpc: "2.0",
          id: 1,
          error: {
            code: 100,
            message: "Odoo Session Expired",
          },
        })
      )
    );

    const client = new OdooClient({ host: "odoo.test", port: 8069 });

    await expect(
      client.verifyTotp(PARTIAL_SESSION_ID, "123456")
    ).rejects.toMatchObject({
      code: 100,
      message: "Odoo Session Expired",
    });
  });
});
