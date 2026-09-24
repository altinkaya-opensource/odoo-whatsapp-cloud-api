import type { OdooSessionClient } from "../odoo/jsonrpc";

/** How many recent messages the AI helpers see. */
export const CONTEXT_MESSAGES = 10;

/** The most text a user may send to an AI helper in one request. */
export const MAX_INPUT_CHARS = 4000;

export type ConversationMessage = {
  id: number;
  text: string;
  isSentFromUser: boolean;
};

export type Conversation = {
  contactName: string;
  messages: ConversationMessage[];
};

type ThreadRecord = {
  name: string | false;
  partner_id: [number, string] | false;
};

type MessageRecord = {
  id: number;
  body: string | false;
  direction: string;
};

/**
 * The end of a thread, read from Odoo with the user's rights.
 *
 * The AI routes build their prompts from this rather than from what the
 * browser sends, so a user can only use threads they may read, and a
 * suggestion cached for a thread comes from that thread. Returns null when
 * the thread does not exist or is not theirs.
 */
export const loadConversation = async (
  session: OdooSessionClient,
  threadId: number
): Promise<Conversation | null> => {
  const [threads, records] = await Promise.all([
    session.searchRead<ThreadRecord[]>(
      "whatsapp.thread",
      [["id", "=", threadId]],
      { limit: 1, select: ["name", "partner_id"] }
    ),
    session.searchRead<MessageRecord[]>(
      "whatsapp.message",
      [
        ["thread_id", "=", threadId],
        ["body", "!=", false],
      ],
      {
        limit: CONTEXT_MESSAGES,
        order: "id desc",
        select: ["body", "direction"],
      }
    ),
  ]);
  const [thread] = threads;
  if (!thread) {
    return null;
  }
  return {
    contactName:
      (thread.partner_id && thread.partner_id[1]) || thread.name || "Customer",
    messages: records.reverse().map((record) => ({
      id: record.id,
      text: record.body || "",
      isSentFromUser: record.direction === "outgoing",
    })),
  };
};

/** The conversation as "Sender: text" lines for a prompt. */
export const formatConversation = (
  messages: ConversationMessage[],
  { user, contact }: { user: string; contact: string }
): string =>
  messages
    .map((message) =>
      message.isSentFromUser
        ? `${user}: ${message.text}`
        : `${contact}: ${message.text}`
    )
    .join("\n");
