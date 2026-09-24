/**
 * The messages of each thread live in the query cache, one entry per view:
 * the latest messages, or the messages around a search result.
 */
import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { mergeMessages } from "./records";
import type { Message } from "./types";

export type MessagesPage = { messages: Message[]; hasMore: boolean };
export type MessagesData = InfiniteData<MessagesPage, number | null>;

export const messagesKey = (threadId: string, aroundId?: number | null) =>
  aroundId ? ["messages", threadId, { aroundId }] : ["messages", threadId];

/**
 * Add or update messages of a thread in every cached view of it.
 *
 * An update lands in the page that holds the message, a new message in the
 * newest page.
 */
export const upsertCachedMessages = (
  queryClient: QueryClient,
  threadId: string,
  messages: Message[]
) => {
  if (messages.length === 0) {
    return;
  }
  queryClient.setQueriesData<MessagesData>(
    { queryKey: ["messages", threadId] },
    (data) => {
      if (!data || data.pages.length === 0) {
        return data;
      }
      const pages = [...data.pages];
      const newMessages: Message[] = [];
      for (const message of messages) {
        const index = pages.findIndex((page) =>
          page.messages.some((existing) => existing.id === message.id)
        );
        if (index === -1) {
          newMessages.push(message);
        } else {
          pages[index] = {
            ...pages[index],
            messages: mergeMessages(pages[index].messages, [message]),
          };
        }
      }
      if (newMessages.length > 0) {
        pages[0] = {
          ...pages[0],
          messages: mergeMessages(pages[0].messages, newMessages),
        };
      }
      return { ...data, pages };
    }
  );
};

/** Drop a message from every cached view of its thread. */
export const removeCachedMessage = (
  queryClient: QueryClient,
  threadId: string,
  messageId: string
) => {
  queryClient.setQueriesData<MessagesData>(
    { queryKey: ["messages", threadId] },
    (data) =>
      data && {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          messages: page.messages.filter((message) => message.id !== messageId),
        })),
      }
  );
};
