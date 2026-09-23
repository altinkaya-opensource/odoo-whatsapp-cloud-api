import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eventBroadcaster } from "@/app/lib/events/broadcaster";

import { POST } from "./route";

const SECRET = "test-webhook-secret";
const BACKEND_ID = 1;
const THREAD_ID = 7;

const signedRequest = (body: object) => {
  const raw = JSON.stringify(body);
  const signature = crypto
    .createHmac("sha256", SECRET)
    .update(raw)
    .digest("hex");
  return new NextRequest("http://localhost/api/webhooks/whatsapp", {
    method: "POST",
    body: raw,
    headers: { "x-odoo-signature": signature },
  });
};

const messageEvent = (eventType: string) => ({
  event_type: eventType,
  data: { id: 42, backend_id: [BACKEND_ID, "Main"], reaction_emoji: "👍" },
  thread_id: THREAD_ID,
  timestamp: 1,
});

describe("POST /api/webhooks/whatsapp", () => {
  const globalListener = vi.fn();
  const threadListener = vi.fn();
  const unsubscribers: Array<() => void> = [];

  beforeEach(() => {
    vi.stubEnv("ODOO_WEBHOOK_SECRET", SECRET);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const metadata = { allowedBackendIds: [BACKEND_ID], sessionId: "s" };
    unsubscribers.push(
      eventBroadcaster.subscribe("messages", globalListener, metadata),
      eventBroadcaster.subscribe(
        `messages:${THREAD_ID}`,
        threadListener,
        metadata
      )
    );
  });

  afterEach(() => {
    unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("sends message.updated to the open thread only", async () => {
    const response = await POST(signedRequest(messageEvent("message.updated")));

    expect(response.status).toBe(200);
    expect(globalListener).not.toHaveBeenCalled();
    expect(threadListener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "messages",
        data: expect.objectContaining({
          threadId: String(THREAD_ID),
          messages: [expect.objectContaining({ reaction_emoji: "👍" })],
        }),
      })
    );
  });

  it("sends message.created to both channels", async () => {
    const response = await POST(signedRequest(messageEvent("message.created")));

    expect(response.status).toBe(200);
    expect(globalListener).toHaveBeenCalledOnce();
    expect(threadListener).toHaveBeenCalledOnce();
  });
});
