import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { sessionCache } from "@/app/lib/session-cache";
import { ragSuggestionCache } from "@/app/lib/rag-suggestion-cache";

const mocks = vi.hoisted(() => {
  const sessionClient = { searchRead: vi.fn() };
  // vitest 4 constructs mocks with Reflect.construct, so `new OdooClient()`
  // needs a real function here, not an arrow.
  const OdooClient = vi.fn(function () {
    return { createSession: () => sessionClient };
  });
  return { OdooClient, sessionClient };
});

vi.mock("@/app/lib/odoo/jsonrpc", () => ({ OdooClient: mocks.OdooClient }));

import { POST } from "./route";

const SESSION_ID = "a".repeat(40);

const suggest = (body: Record<string, unknown>) =>
  POST(
    new NextRequest("http://localhost/api/ai/rag-suggestions", {
      method: "POST",
      headers: { cookie: `whatsapp_session=${SESSION_ID}` },
      body: JSON.stringify(body),
    })
  );

/** What Odoo holds for thread 7: newest message first, as searched. */
const odooHasThread = (thread: Record<string, unknown> | null) =>
  mocks.sessionClient.searchRead.mockImplementation(async (model: string) =>
    model === "whatsapp.thread"
      ? thread
        ? [thread]
        : []
      : [
          { id: 12, body: "Siparişim nerede?", direction: "incoming" },
          {
            id: 11,
            body: "Merhaba, nasıl yardımcı olabilirim?",
            direction: "outgoing",
          },
        ]
  );

describe("POST /api/ai/rag-suggestions", () => {
  let ragRequests: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("ODOO_JSONRPC_HOST", "odoo.test");
    vi.stubEnv("AI_CHAT_ENABLED", "true");
    vi.stubEnv("RAG_SUPPORTED_CHAT_URL", "http://rag.test/chat");
    sessionCache.set(SESSION_ID, [1]);
    mocks.sessionClient.searchRead.mockReset();
    ragRequests = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ response: "Kargoya verildi." }));
  });

  afterEach(() => {
    sessionCache.clear();
    ragSuggestionCache.clear();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("builds the prompt from Odoo and caches it for the latest message", async () => {
    odooHasThread({ name: "905551112233", partner_id: [5, "Ali Veli"] });

    const first = await suggest({ threadId: 7, messages: [{ message: "x" }] });
    expect(await first.json()).toEqual({
      suggestions: ["Kargoya verildi."],
      cached: false,
    });
    const sent = JSON.parse(ragRequests.mock.calls[0][1].body as string);
    expect(sent.messages).toBe(
      "Support Agent(customer support): Merhaba, nasıl yardımcı olabilirim?\n" +
        "Ali Veli: Siparişim nerede?"
    );

    const second = await suggest({ threadId: 7 });
    expect(await second.json()).toEqual({
      suggestions: ["Kargoya verildi."],
      cached: true,
    });
    expect(ragRequests).toHaveBeenCalledTimes(1);
  });

  it("refuses a thread the user cannot read", async () => {
    odooHasThread(null);
    expect((await suggest({ threadId: 7 })).status).toBe(404);
    expect(ragRequests).not.toHaveBeenCalled();
  });

  it("is only for users with a WhatsApp backend", async () => {
    sessionCache.set(SESSION_ID, []);
    expect((await suggest({ threadId: 7 })).status).toBe(403);
    expect(mocks.sessionClient.searchRead).not.toHaveBeenCalled();
  });
});
