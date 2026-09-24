/**
 * What a chat shares, as its media gallery lists it: photos and videos,
 * files, and the links written in messages.
 */
import type { Attachment, Message } from "./types";

export const SHARED_KINDS = ["media", "files", "links"] as const;
export type SharedKind = (typeof SHARED_KINDS)[number];

/** Messages per page of the gallery */
export const SHARED_PAGE_SIZE = 60;

export type SharedLink = { url: string; label: string | null };

// A markdown link, as templates send them ([Kargo Takip](https://…)), or a
// bare address
const LINK_PATTERN =
  /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;
// Sentence punctuation or WhatsApp formatting right after a bare address
const TRAILING_PUNCTUATION = /[.,;:!?'"*_~>\]}]+$/;
// What Odoo stores as the text of a photo or file sent without a caption,
// in the sender's language (`caption or _("Image")`)
const TYPE_PLACEHOLDERS = new Set([
  "image",
  "video",
  "audio",
  "document",
  "file",
  "görsel",
  "doküman",
]);

export const isSharedKind = (value: unknown): value is SharedKind =>
  SHARED_KINDS.includes(value as SharedKind);

export const isMediaType = (mimetype: string) =>
  mimetype.startsWith("image/") || mimetype.startsWith("video/");

const toHttpUrl = (address: string): string | null => {
  const withScheme = /^www\./i.test(address) ? `https://${address}` : address;
  try {
    const url = new URL(withScheme);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
};

const trimBareAddress = (address: string) => {
  const trimmed = address.replace(TRAILING_PUNCTUATION, "");
  // Keep the bracket of "…/Foo_(bar)", drop the one closing a sentence
  return trimmed.endsWith(")") && !trimmed.includes("(")
    ? trimmed.slice(0, -1).replace(TRAILING_PUNCTUATION, "")
    : trimmed;
};

/** The http(s) links of a message text, each once, in order. */
export const extractLinks = (text: string): SharedLink[] => {
  const links = new Map<string, SharedLink>();
  for (const match of text.matchAll(LINK_PATTERN)) {
    const [, label, markdownUrl, bareAddress] = match;
    const url = toHttpUrl(markdownUrl ?? trimBareAddress(bareAddress));
    if (url && !links.has(url)) {
      links.set(url, { url, label: label?.trim() || null });
    }
  }
  return [...links.values()];
};

/**
 * Whether a message belongs in a gallery tab: the same split the server
 * makes in /api/messages/shared.
 */
export const isSharedIn = (
  kind: SharedKind,
  message: { attachment?: Attachment | null; body?: string | false | null }
): boolean => {
  if (kind === "links") {
    return extractLinks(message.body || "").length > 0;
  }
  if (!message.attachment) {
    return false;
  }
  return isMediaType(message.attachment.mimetype) === (kind === "media");
};

/** What the sender wrote under a photo or file, if anything. */
export const captionOf = (message: Message): string | null => {
  const text = message.message.trim();
  if (
    !text ||
    text === message.attachment?.name ||
    TYPE_PLACEHOLDERS.has(text.toLowerCase())
  ) {
    return null;
  }
  return text;
};

/**
 * Consecutive items of the same month. The gallery pages by id, so a month
 * can come back after a late-saved message: each run is its own group.
 */
export const groupByMonth = <T>(
  items: T[],
  timestampOf: (item: T) => number
): { key: string; timestamp: number; items: T[] }[] => {
  const groups: {
    key: string;
    month: string;
    timestamp: number;
    items: T[];
  }[] = [];
  for (const item of items) {
    const date = new Date(timestampOf(item));
    const month = `${date.getFullYear()}-${date.getMonth()}`;
    const last = groups[groups.length - 1];
    if (last?.month === month) {
      last.items.push(item);
    } else {
      groups.push({
        key: `${month}-${groups.length}`,
        month,
        timestamp: timestampOf(item),
        items: [item],
      });
    }
  }
  return groups;
};
