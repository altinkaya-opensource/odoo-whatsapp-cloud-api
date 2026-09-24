/**
 * Odoo records as the chat list and the chat view use them.
 *
 * One place maps a thread or message record, whether it comes from a fetch,
 * a realtime event or a poll, so every path shows the same thing.
 */
import type { Attachment, Chat, Message } from "./types";

export type Many2one = [number, string] | number | false | null | undefined;

export type OdooThreadRecord = {
  id: number;
  name: string;
  last_message_date: string | null;
  last_message_preview: string | null;
  phone_number?: string | null;
  backend_id?: Many2one;
  partner_id?: Many2one;
  /** Per user: fetched threads have it, realtime updates do not */
  unread_count?: number;
  has_avatar?: boolean;
  write_date?: string | null;
};

export type OdooMessageRecord = {
  id: number;
  create_date?: string | null;
  body: string | null | false;
  status: string | null;
  message_id: string | null | false;
  direction: "incoming" | "outgoing" | string;
  attachment_id?: Many2one;
  create_uid?: Many2one;
  replied_message_id?: [number, string] | false | null;
  timestamp: number;
  reaction_emoji?: string | false | null;
  attachment?: Attachment | null;
};

export const many2oneId = (value: Many2one): number | null =>
  Array.isArray(value) ? value[0] : typeof value === "number" ? value : null;

export const many2oneName = (value: Many2one): string | null =>
  Array.isArray(value) && value.length > 1 ? value[1] : null;

/** Odoo sends UTC datetimes as "YYYY-MM-DD HH:MM:SS" (Safari needs the T). */
export const odooDateToMs = (value?: string | null): number | null =>
  value ? new Date(`${value.replace(" ", "T")}Z`).getTime() : null;

export const toChat = (
  record: OdooThreadRecord,
  avatarUrl: (partnerId: number) => string | null
): Chat => {
  const id = String(record.id);
  const partnerId = many2oneId(record.partner_id);
  return {
    id,
    contactId: id,
    threadName: record.name || undefined,
    phoneNumber: record.phone_number ?? null,
    backendId: many2oneId(record.backend_id),
    partnerId,
    partnerName: many2oneName(record.partner_id),
    partnerAvatar: partnerId ? avatarUrl(partnerId) : null,
    hasAvatar: record.has_avatar === true,
    lastMessagePreview: record.last_message_preview ?? "",
    lastMessageAt: odooDateToMs(record.last_message_date),
    unreadCount: record.unread_count,
    read: (record.unread_count ?? 0) === 0,
    group: false,
    favorite: false,
    messages: [],
  };
};

/** Apply an update to a chat, keeping what the update does not carry. */
export const mergeChat = (existing: Chat | undefined, update: Chat): Chat => {
  const unreadCount = update.unreadCount ?? existing?.unreadCount ?? 0;
  if (!existing) {
    return { ...update, unreadCount, read: unreadCount === 0 };
  }
  return {
    ...existing,
    ...update,
    threadName: update.threadName ?? existing.threadName,
    backendId: update.backendId ?? existing.backendId,
    partnerId: update.partnerId ?? existing.partnerId,
    partnerName: update.partnerName ?? existing.partnerName,
    partnerAvatar: update.partnerAvatar ?? existing.partnerAvatar,
    lastMessagePreview:
      update.lastMessagePreview || existing.lastMessagePreview,
    lastMessageAt: update.lastMessageAt ?? existing.lastMessageAt,
    unreadCount,
    read: unreadCount === 0,
    messages: existing.messages,
  };
};

// Newest first, then the higher id. The list only gets last_message_date to
// the second, and bulk sends (cargo notifications) put several threads in
// the same second; without the id they swapped places on every re-sort.
export const compareByRecency = (a: Chat, b: Chat) =>
  (b.lastMessageAt || 0) - (a.lastMessageAt || 0) ||
  Number(b.id) - Number(a.id);

const SENT_STATUSES = new Set(["sent", "delivered", "read"]);
const DELIVERED_STATUSES = new Set(["delivered", "read"]);

export const toMessage = (
  record: OdooMessageRecord,
  threadId: string
): Message => {
  const status = (record.status ?? "").toLowerCase();
  const repliedId = Array.isArray(record.replied_message_id)
    ? record.replied_message_id[0]
    : null;
  return {
    id: String(record.id),
    contactId: threadId,
    message: record.body || "",
    timestamp: record.timestamp * 1000,
    isSentFromUser: record.direction === "outgoing",
    sent: SENT_STATUSES.has(status),
    delivered: DELIVERED_STATUSES.has(status),
    read: status === "read",
    userId: many2oneId(record.create_uid),
    whatsappId:
      typeof record.message_id === "string" ? record.message_id : null,
    replyMessageId: repliedId ? String(repliedId) : null,
    attachment: record.attachment ?? undefined,
    reactionEmoji:
      typeof record.reaction_emoji === "string" ? record.reaction_emoji : null,
  };
};

export const toReplyMetadata = (
  message: Message
): NonNullable<Message["replyTo"]> | null =>
  message.whatsappId
    ? {
        messageId: message.whatsappId,
        message: message.message,
        contactId: message.contactId,
        senderIsUser: message.isSentFromUser,
      }
    : null;

// Messages still being sent have local ids and sort after saved ones
const numericId = (message: Message) => {
  const id = Number(message.id);
  return Number.isFinite(id) ? id : Number.MAX_SAFE_INTEGER;
};

const compareMessages = (a: Message, b: Message) =>
  a.timestamp - b.timestamp || numericId(a) - numericId(b);

/** Fill replyTo from replyMessageId for quotes of loaded messages. */
const withReplies = (messages: Message[]): Message[] => {
  const byId = new Map(messages.map((message) => [message.id, message]));
  return messages.map((message) => {
    if (message.replyTo || !message.replyMessageId) {
      return message;
    }
    const quoted = byId.get(message.replyMessageId);
    const replyTo = quoted ? toReplyMetadata(quoted) : null;
    return replyTo ? { ...message, replyTo } : message;
  });
};

/**
 * Merge messages by id, in chronological order.
 *
 * Newer data wins, except that a status never goes back: realtime events,
 * fetches and polls can arrive in any order.
 */
export const mergeMessages = (
  current: Message[],
  incoming: Message[]
): Message[] => {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    const existing = byId.get(message.id);
    byId.set(
      message.id,
      existing
        ? {
            ...existing,
            ...message,
            sent: message.sent || existing.sent,
            delivered: message.delivered || existing.delivered,
            read: message.read || existing.read,
            attachment: message.attachment ?? existing.attachment,
            replyTo: message.replyTo ?? existing.replyTo,
          }
        : message
    );
  }
  return withReplies([...byId.values()].sort(compareMessages));
};
