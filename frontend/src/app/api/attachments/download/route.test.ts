import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { sessionCache } from "@/app/lib/session-cache";
import { GET as download } from "./route";
import { GET as avatar } from "../../avatar/[partnerId]/route";

const SESSION_ID = "a".repeat(40);

const odooAnswers = (body: string, contentType: string) =>
  vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      new Response(body, { headers: { "Content-Type": contentType } })
    );

describe("files proxied from Odoo", () => {
  beforeEach(() => {
    vi.stubEnv("ODOO_JSONRPC_HOST", "odoo.test");
    vi.stubEnv("ODOO_JSONRPC_PORT", "8069");
    // A signed-in agent: the session check does not call Odoo
    sessionCache.set(SESSION_ID, [1]);
  });

  afterEach(() => {
    sessionCache.clear();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("serves a customer's file so it cannot run scripts", async () => {
    const fetchMock = odooAnswers("<svg onload=alert(1)>", "image/svg+xml");
    const response = await download(
      new NextRequest(
        `http://localhost/api/attachments/download?url=${encodeURIComponent(
          "https://evil.test/whatsapp/attachment/download/42"
        )}&session_id=${SESSION_ID}`
      )
    );

    // Only the path is kept, against the configured Odoo
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://odoo.test:8069/whatsapp/attachment/download/42"
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "default-src 'none'"
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response.text()).toBe("<svg onload=alert(1)>");
  });

  it("refuses a session Odoo does not know", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        jsonrpc: "2.0",
        error: {
          code: 100,
          message: "Odoo Session Expired",
          data: { name: "odoo.http.SessionExpiredException" },
        },
      })
    );
    const response = await download(
      new NextRequest(
        `http://localhost/api/attachments/download?url=/whatsapp/attachment/download/42&session_id=${"b".repeat(40)}`
      )
    );
    expect(response.status).toBe(401);
    // Only the session check reached Odoo, not the file
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("serves avatars as private PNGs only", async () => {
    odooAnswers("png-bytes", "image/png");
    const params = (partnerId: string) => ({
      params: Promise.resolve({ partnerId }),
    });
    const request = new NextRequest(
      `http://localhost/api/avatar/7?session_id=${SESSION_ID}`
    );

    const response = await avatar(request, params("7"));
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toMatch(/^private/);
    expect((await avatar(request, params("7%2F..%2Fweb"))).status).toBe(404);
  });

  it("does not pass a login page off as an avatar", async () => {
    odooAnswers("<html>login</html>", "text/html");
    const response = await avatar(
      new NextRequest(`http://localhost/api/avatar/7?session_id=${SESSION_ID}`),
      { params: Promise.resolve({ partnerId: "7" }) }
    );
    expect(response.status).toBe(404);
  });
});
