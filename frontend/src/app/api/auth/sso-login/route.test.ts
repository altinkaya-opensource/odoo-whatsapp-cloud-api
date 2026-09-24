import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionCache } from "@/app/lib/session-cache";
import { GET } from "./route";

const CODE = "c".repeat(43);
const NEW_SESSION = "f".repeat(40);

const land = (query: string, host = "whatsapp.example.com") =>
  GET(
    new Request(`http://localhost/api/auth/sso-login?${query}`, {
      headers: { "x-forwarded-host": host },
    })
  );

/** Odoo's answer to the exchange, then to the session check. */
const odooAnswers = (exchange: unknown) =>
  vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({ jsonrpc: "2.0", result: exchange }))
    .mockResolvedValue(
      Response.json({ jsonrpc: "2.0", result: { backend_ids: [1] } })
    );

describe("GET /api/auth/sso-login", () => {
  beforeEach(() => {
    vi.stubEnv("ODOO_JSONRPC_HOST", "odoo.test");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    sessionCache.clear();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("trades the code for a session cookie and opens the thread", async () => {
    const fetchMock = odooAnswers({ session_id: NEW_SESSION });
    const response = await land(`code=${CODE}&thread_id=42`);

    expect(
      JSON.parse(fetchMock.mock.calls[0][1]?.body as string).params
    ).toEqual({ code: CODE });
    expect(response.status).toBe(303);
    // Relative: a forged Host header cannot send the user elsewhere
    expect(response.headers.get("location")).toBe("/?thread_id=42");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`whatsapp_session=${NEW_SESSION}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
  });

  it("refuses a used or expired code", async () => {
    odooAnswers({ error: "invalid_code" });
    const response = await land(`code=${CODE}`);
    expect(response.headers.get("location")).toBe("/?error=sso_failed");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("never accepts a session id in the URL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const response = await land(`session=${NEW_SESSION}`);
    expect(response.headers.get("location")).toBe("/?error=sso_failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
