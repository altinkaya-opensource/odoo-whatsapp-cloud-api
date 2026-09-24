import { describe, expect, it } from "vitest";
import {
  compareByRecency,
  mergeChat,
  mergeMessages,
  odooDateToMs,
  toChat,
  toMessage,
  type OdooMessageRecord,
} from "./records";

const message = (overrides: Partial<OdooMessageRecord>): OdooMessageRecord => ({
  id: 1,
  body: "Merhaba",
  status: "delivered",
  message_id: "wamid.1",
  direction: "incoming",
  timestamp: 100,
  ...overrides,
});

describe("toChat", () => {
  it("reads many2one tuples from every source", () => {
    const chat = toChat(
      {
        id: 7,
        name: "Thread",
        last_message_date: "2026-09-18 13:48:28",
        last_message_preview: "Kargonuz yolda",
        backend_id: [2, "Türkiye"],
        partner_id: [5, "ARKEL"],
        unread_count: 3,
      },
      (partnerId) => `/avatar/${partnerId}`
    );
    expect(chat).toMatchObject({
      id: "7",
      backendId: 2,
      partnerId: 5,
      partnerName: "ARKEL",
      partnerAvatar: "/avatar/5",
      unreadCount: 3,
      read: false,
      lastMessageAt: Date.UTC(2026, 8, 18, 13, 48, 28),
    });
  });
});

describe("mergeChat", () => {
  it("keeps the local unread count when an update has none", () => {
    const existing = toChat(
      {
        id: 7,
        name: "T",
        last_message_date: null,
        last_message_preview: "a",
        unread_count: 4,
      },
      () => null
    );
    const update = toChat(
      {
        id: 7,
        name: "T",
        last_message_date: "2026-09-18 13:48:29",
        last_message_preview: "b",
      },
      () => null
    );
    expect(mergeChat(existing, update)).toMatchObject({
      unreadCount: 4,
      read: false,
      lastMessagePreview: "b",
    });
  });
});

describe("compareByRecency", () => {
  it("breaks same-second ties by id", () => {
    const at = odooDateToMs("2026-09-18 13:48:28");
    const chats = ["3851", "7816", "7239"].map((id) => ({
      ...toChat(
        {
          id: Number(id),
          name: id,
          last_message_date: null,
          last_message_preview: "",
        },
        () => null
      ),
      lastMessageAt: at,
    }));
    expect(chats.sort(compareByRecency).map((chat) => chat.id)).toEqual([
      "7816",
      "7239",
      "3851",
    ]);
  });
});

describe("mergeMessages", () => {
  it("never moves a status backwards", () => {
    const read = toMessage(message({ status: "read" }), "7");
    const stale = toMessage(message({ status: "delivered" }), "7");
    expect(mergeMessages([read], [stale])[0].read).toBe(true);
  });

  it("orders by time and resolves quotes of loaded messages", () => {
    const quoted = toMessage(message({ id: 1, timestamp: 100 }), "7");
    const reply = toMessage(
      message({
        id: 2,
        timestamp: 200,
        direction: "outgoing",
        message_id: "wamid.2",
        replied_message_id: [1, "wamid.1"],
      }),
      "7"
    );
    const merged = mergeMessages([reply], [quoted]);
    expect(merged.map((m) => m.id)).toEqual(["1", "2"]);
    expect(merged[1].replyTo).toMatchObject({
      messageId: "wamid.1",
      senderIsUser: false,
    });
  });

  it("keeps messages being sent after saved ones of the same second", () => {
    const saved = toMessage(message({ id: 9, timestamp: 100 }), "7");
    const sending = { ...saved, id: "local-1", timestamp: 100000 };
    expect(mergeMessages([sending], [saved]).map((m) => m.id)).toEqual([
      "9",
      "local-1",
    ]);
  });
});
