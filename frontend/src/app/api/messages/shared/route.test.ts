import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { sessionCache } from "@/app/lib/session-cache";

const mocks = vi.hoisted(() => {
  const sessionClient = { searchRead: vi.fn() };
  const createSession = vi.fn(() => sessionClient);
  // vitest 4 constructs mocks with Reflect.construct, so `new OdooClient()`
  // needs a real function here, not an arrow.
  const OdooClient = vi.fn(function () {
    return { createSession };
  });
  return { OdooClient, sessionClient };
});

vi.mock("@/app/lib/odoo/jsonrpc", () => ({
  OdooClient: mocks.OdooClient,
}));

import { GET } from "./route";

const SESSION_ID = "b".repeat(40);

const requestFor = (query: string) =>
  new NextRequest(`http://localhost/api/messages/shared?${query}`, {
    headers: { cookie: `whatsapp_session=${SESSION_ID}` },
  });

const searchedDomain = () => mocks.sessionClient.searchRead.mock.calls[0][1];

beforeEach(() => {
  vi.clearAllMocks();
  sessionCache.set(SESSION_ID, [1]);
  process.env.ODOO_JSONRPC_HOST = "odoo.test";
  mocks.sessionClient.searchRead.mockResolvedValue([]);
});

afterEach(() => {
  sessionCache.clear();
});

describe("GET /api/messages/shared", () => {
  it("reads a thread's photos and videos, newest first", async () => {
    const response = await GET(requestFor("threadId=7&kind=media"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ messages: [] });
    const [model, domain, options] =
      mocks.sessionClient.searchRead.mock.calls[0];
    expect(model).toBe("whatsapp.message");
    expect(domain).toEqual([
      ["thread_id", "=", 7],
      "|",
      ["attachment_id.mimetype", "=like", "image/%"],
      ["attachment_id.mimetype", "=like", "video/%"],
    ]);
    expect(options).toMatchObject({ order: "id DESC", limit: 60 });
  });

  it("pages files from before the last one shown", async () => {
    await GET(requestFor("threadId=7&kind=files&beforeId=120"));

    expect(searchedDomain()).toEqual([
      ["thread_id", "=", 7],
      ["attachment_id", "!=", false],
      ["attachment_id.mimetype", "not like", "image/"],
      ["attachment_id.mimetype", "not like", "video/"],
      ["id", "<", 120],
    ]);
  });

  it("finds messages that may carry a link", async () => {
    await GET(requestFor("threadId=7&kind=links"));

    expect(searchedDomain()).toEqual([
      ["thread_id", "=", 7],
      "|",
      ["body", "ilike", "http"],
      ["body", "ilike", "www."],
    ]);
  });

  it.each([
    "kind=media",
    "threadId=abc&kind=media",
    "threadId=7&kind=audio",
    "threadId=7&kind=media&beforeId=-1",
  ])("refuses %s", async (query) => {
    const response = await GET(requestFor(query));

    expect(response.status).toBe(400);
    expect(mocks.sessionClient.searchRead).not.toHaveBeenCalled();
  });

  it("answers 401 without a session", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/messages/shared?threadId=7")
    );

    expect(response.status).toBe(401);
  });
});
