import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionCache } from "@/app/lib/session-cache";
import { POST } from "./route";

const SESSION_ID = "a".repeat(40);

describe("POST /api/auth/logout", () => {
  afterEach(() => {
    sessionCache.clear();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("ends the Odoo session and drops the cookie", async () => {
    vi.stubEnv("ODOO_JSONRPC_HOST", "odoo.test");
    sessionCache.set(SESSION_ID, [1]);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ jsonrpc: "2.0", result: null }));

    const response = await POST(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { cookie: `whatsapp_session=${SESSION_ID}` },
      })
    );

    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://odoo.test/web/session/destroy"
    );
    expect(
      (fetchMock.mock.calls[0][1]?.headers as Record<string, string>).Cookie
    ).toContain(SESSION_ID);
    expect(sessionCache.has(SESSION_ID)).toBe(false);
    expect(response.headers.get("set-cookie")).toMatch(
      /^whatsapp_session=;.*Max-Age=0/
    );
  });
});
