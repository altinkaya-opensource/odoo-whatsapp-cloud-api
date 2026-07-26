import {
  createContext,
  PropsWithChildren,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Chat, Message } from "./chats-provider";
import { useChats } from "../hooks/use-chats";
import { useContacts } from "../hooks/use-contacts";
import { Contact } from "./contacts-provider";
import { useAuth } from "../hooks/use-auth";
import { useSSE } from "../hooks/use-sse";
import { useMessagePoller } from "../hooks/use-message-poller";
import { useConnection } from "./connection-provider";
import { markMessagesAsSeen, setActiveThread } from "../lib/notifications";

// Message pagination configuration
const MESSAGE_BATCH_SIZE = 100;

export type CurrentChatContacts = {
  [contactId: string]: Contact | undefined;
};

export type CurrentChatContactsGroup = {
  name: string;
  avatar: string;
  contacts: CurrentChatContacts;
};

export type CurrentChatData = {
  chatId: string | null;
  contact: Contact | null;
  messages: Message[];
  group: CurrentChatContactsGroup | null;
  page: number;
  isLoading: boolean;
  isPaginationLoading: boolean;
  hasMoreMessages: boolean;
  threadName: string | null;
  phoneNumber: string | null;
  backendId: number | null;
  partnerId: number | null;
  partnerName: string | null;
  partnerAvatar: string | null;
  hasAvatar: boolean;
  isSending: boolean;
  replyTo: Message | null;
  targetMessageId: number | null;
};

export type CurrentChat = CurrentChatData & {
  loadCurrentChat: (chat: Partial<CurrentChatData>) => void;
  sendMessage: (content: string) => Promise<void>;
  sendAttachment: (file: File, caption?: string) => Promise<void>;
  sendReaction: (message: Message, emoji: string) => Promise<void>;
  startReply: (message: Message) => void;
  cancelReply: () => void;
  loadPreviousMessages: () => Promise<void>;
};

export const CurrentChatContext = createContext<undefined | CurrentChat>(
  undefined
);

type OdooMessageRecord = {
  id: number;
  create_date: string;
  body: string | null | false;
  status: string | null;
  message_id: string | null;
  direction: "incoming" | "outgoing" | string;
  attachment_id: false | [number, string] | null;
  create_uid: [number, string];
  replied_message_id?: false | [number, string] | null;
  timestamp: number;
  reaction_emoji?: string | false | null;
  attachment?: {
    id: number;
    name: string;
    mimetype: string;
    url: string;
    file_size: number;
  };
};

type MessageWithReplyReference = Message & {
  replyMessageId?: string | null;
};

const toReplyMetadata = (
  message: Message
): NonNullable<Message["replyTo"]> | null => {
  if (!message.whatsappId) {
    return null;
  }
  return {
    messageId: message.whatsappId,
    message: message.message,
    contactId: message.contactId,
    senderIsUser: message.isSentFromUser,
  };
};

const extractDigits = (value?: string | null) => {
  if (!value) {
    return null;
  }
  const digits = value.replace(/\D/g, "");
  return digits.length >= 6 ? digits : null;
};

export default function CurrentChatProvider({ children }: PropsWithChildren) {
  const [currentChat, setCurrentChat] = useState<CurrentChatData>({
    chatId: null,
    contact: null,
    messages: [],
    group: null,
    page: 0,
    isLoading: false,
    isPaginationLoading: false,
    hasMoreMessages: true,
    threadName: null,
    phoneNumber: null,
    backendId: null,
    partnerId: null,
    partnerName: null,
    partnerAvatar: null,
    hasAvatar: false,
    isSending: false,
    replyTo: null,
    targetMessageId: null,
  });
  const latestMessageTimestampRef = useRef<number | null>(null);
  const latestMessageIdRef = useRef<number | null>(null);
  const oldestMessageIdRef = useRef<number | null>(null);
  const targetMessageIdRef = useRef<number | null>(null);

  const {
    chats: { complete },
    updateThreadPreview,
    markChatAsRead,
  } = useChats();
  const { contacts } = useContacts();
  const { sessionId, backendId: authBackendId, backendUserId } = useAuth();
  const { reportApiError, reportConnectionRestored } = useConnection();

  const chatId = currentChat.chatId;
  const pendingPreviewUpdateRef = useRef<{
    threadId: string;
    message: string;
    timestamp: number;
  } | null>(null);
  const pendingMarkAsReadRef = useRef<string | null>(null);

  // SSE message handler for real-time message updates
  const handleMessagesUpdate = useCallback(
    (messages: unknown[], threadId: string) => {
      if (threadId !== chatId) {
        return; // Ignore messages for other chats
      }

      const odooMessages = (messages as OdooMessageRecord[]).reverse(); // Backend returns newest first, reverse for chat display

      const rawMessages: MessageWithReplyReference[] = odooMessages.map(
        (record) => {
          const timestamp = record.timestamp * 1000; // Convert seconds to milliseconds
          const direction = record.direction ?? "incoming";
          const status = (record.status ?? "").toLowerCase();
          const messageText = record.body || "";

          const deliveredStatuses = ["delivered", "read"];
          const sentStatuses = ["sent", ...deliveredStatuses];
          const userIdValue =
            Array.isArray(record.create_uid) && record.create_uid.length > 0
              ? record.create_uid[0]
              : null;
          const whatsappId =
            typeof record.message_id === "string" ? record.message_id : null;
          const replyTuple = Array.isArray(record.replied_message_id)
            ? record.replied_message_id
            : null;
          const replyMessageId = replyTuple?.[0] ? String(replyTuple[0]) : null;
          const reactionEmoji =
            typeof record.reaction_emoji === "string"
              ? record.reaction_emoji
              : null;

          return {
            id: record.id.toString(),
            contactId: threadId,
            message: messageText,
            timestamp,
            isSentFromUser: direction === "outgoing",
            sent: sentStatuses.includes(status),
            delivered: deliveredStatuses.includes(status),
            read: status === "read",
            userId: userIdValue ?? null,
            whatsappId,
            replyMessageId,
            attachment: record.attachment,
            reactionEmoji,
          };
        }
      );

      // Process messages similar to fetchMessages
      setCurrentChat((prev) => {
        if (prev.chatId !== threadId) {
          return prev;
        }

        const repliesById = new Map<string, NonNullable<Message["replyTo"]>>();

        // Build reply metadata map from existing messages
        prev.messages.forEach((message) => {
          if (message.id) {
            const meta = toReplyMetadata(message);
            if (meta) {
              repliesById.set(message.id, meta);
            }
          }
        });

        // Also add reply metadata from raw messages (for newly arrived messages)
        rawMessages.forEach((rawMessage) => {
          if (rawMessage.id && rawMessage.whatsappId) {
            repliesById.set(rawMessage.id, {
              messageId: rawMessage.whatsappId,
              message: rawMessage.message,
              contactId: rawMessage.contactId,
              senderIsUser: rawMessage.isSentFromUser,
            });
          }
        });

        const mappedMessages: Message[] = rawMessages.map((message) => {
          const { replyMessageId, ...rest } = message;
          const baseMessage = rest as Message;

          if (!replyMessageId) {
            return baseMessage;
          }

          const replyMetadata = repliesById.get(replyMessageId);
          if (!replyMetadata) {
            return baseMessage;
          }

          return {
            ...baseMessage,
            replyTo: replyMetadata,
          };
        });

        // Handle message updates: merge new messages with existing ones
        const existingMessagesMap = new Map(
          prev.messages.map((m) => [m.id, m])
        );
        const updatedMessagesMap = new Map(existingMessagesMap);

        let hasNewMessages = false;
        let hasNewIncomingMessages = false;

        mappedMessages.forEach((newMessage, index) => {
          if (newMessage.id && existingMessagesMap.has(newMessage.id)) {
            // Update existing message (e.g., status changes)
            updatedMessagesMap.set(newMessage.id, {
              ...existingMessagesMap.get(newMessage.id)!,
              ...newMessage,
              // Preserve optimistic properties if this is an update to an optimistic message
              sent:
                newMessage.sent || existingMessagesMap.get(newMessage.id)!.sent,
              delivered:
                newMessage.delivered ||
                existingMessagesMap.get(newMessage.id)!.delivered,
            } as Message);
          } else if (newMessage.id && !existingMessagesMap.has(newMessage.id)) {
            // Add new message - keep the replyMessageId from rawMessages for later resolution
            const rawMessageWithReplyId = rawMessages[index];
            updatedMessagesMap.set(newMessage.id, {
              ...newMessage,
              // Store replyMessageId as a custom property for resolution later
              replyMessageId: rawMessageWithReplyId.replyMessageId,
            } as MessageWithReplyReference);
            hasNewMessages = true;
            // Check if it's an incoming message (not from user)
            if (!newMessage.isSentFromUser) {
              hasNewIncomingMessages = true;
            }
          }
        });

        if (!hasNewMessages) {
          return prev;
        }

        const sortedMessages = Array.from(updatedMessagesMap.values()).sort(
          (a, b) => a.timestamp - b.timestamp
        ); // Still need sorting when merging SSE messages

        // Rebuild reply metadata map with ALL messages (including newly merged ones)
        const finalRepliesById = new Map<
          string,
          NonNullable<Message["replyTo"]>
        >();
        sortedMessages.forEach((message) => {
          if (message.id && message.whatsappId) {
            const meta = toReplyMetadata(message);
            if (meta) {
              finalRepliesById.set(message.id, meta);
            }
          }
        });

        // Re-map messages to ensure reply metadata is properly resolved
        const updatedMessages = sortedMessages.map((message) => {
          // If message already has replyTo, keep it
          if (message.replyTo) {
            return message;
          }

          // Otherwise, try to resolve it from the replyMessageId if it exists
          const rawMessage = message as MessageWithReplyReference;
          if (rawMessage.replyMessageId) {
            const replyMetadata = finalRepliesById.get(
              rawMessage.replyMessageId
            );
            if (replyMetadata) {
              return {
                ...message,
                replyTo: replyMetadata,
              };
            }
          }

          return message;
        });

        // Store the preview update to be executed in useEffect
        if (updatedMessages.length > 0) {
          const latestMessage = updatedMessages[updatedMessages.length - 1];
          pendingPreviewUpdateRef.current = {
            threadId,
            message: latestMessage.message,
            timestamp: latestMessage.timestamp,
          };
        }

        // If we received new incoming messages in the active chat, mark as read
        if (hasNewIncomingMessages) {
          pendingMarkAsReadRef.current = threadId;
        }

        return {
          ...prev,
          messages: updatedMessages,
        };
      });
    },
    [chatId]
  );

  // Initialize SSE for current chat messages
  useSSE(
    {
      onMessagesUpdate: handleMessagesUpdate,
      onError: (error) => {
        reportApiError(error);
      },
      onReconnect: () => {
        reportConnectionRestored();
      },
    },
    {
      threadId: chatId,
      enabled: !!sessionId && !!chatId,
    }
  );

  // Initialize periodic message polling as a fallback/validation mechanism
  // This ensures messages are not lost if webhooks fail silently
  useMessagePoller(
    {
      onMessagesFound: (messages, threadId) => {
        // Reuse the same handler as SSE - it already handles message merging
        handleMessagesUpdate(messages, threadId);
      },
      onError: (error) => {
        // Don't report polling errors as aggressively as SSE errors
        // Polling is a fallback mechanism, not the primary delivery method
        console.warn(
          `[CurrentChatProvider] Polling error for thread ${chatId}:`,
          error.message
        );
      },
      onPollComplete: () => {
        // Report successful poll as connection restored
        reportConnectionRestored();
      },
    },
    {
      threadId: chatId,
      enabled: !!sessionId && !!chatId,
      interval: 600000, // 10 minutes
      lastMessageId: latestMessageIdRef.current,
    }
  );

  // Handle pending preview updates outside of render
  useEffect(() => {
    if (pendingPreviewUpdateRef.current) {
      const { threadId, message, timestamp } = pendingPreviewUpdateRef.current;
      updateThreadPreview(threadId, message, timestamp);
      pendingPreviewUpdateRef.current = null;
    }
  }, [currentChat.messages, updateThreadPreview]);

  // Handle pending mark-as-read actions outside of render
  useEffect(() => {
    if (pendingMarkAsReadRef.current && sessionId) {
      const threadId = pendingMarkAsReadRef.current;
      pendingMarkAsReadRef.current = null;

      // Update local state immediately
      markChatAsRead(threadId);

      // Call backend API to mark as read
      fetch("/api/threads/mark-read", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-session-id": sessionId,
        },
        body: JSON.stringify({ threadId }),
      }).catch(() => {
        // Failed to mark thread as read
      });
    }
  }, [currentChat.messages, sessionId, markChatAsRead]);

  const fetchMessages = useCallback(
    async ({
      replace = false,
      lastId,
      signal,
      direction = "forward",
      isPagination = false,
      aroundId,
    }: {
      replace?: boolean;
      lastId?: number | null;
      signal?: AbortSignal;
      direction?: "forward" | "backward";
      isPagination?: boolean;
      aroundId?: number | null;
    } = {}) => {
      if (!chatId || !sessionId) {
        return;
      }

      const searchParams = new URLSearchParams({
        threadId: chatId,
        limit: String(MESSAGE_BATCH_SIZE),
      });

      if (typeof aroundId === "number") {
        searchParams.set("aroundId", String(aroundId));
      } else {
        // Determine which ID to use
        const effectiveLastId =
          typeof lastId === "number"
            ? lastId
            : replace
              ? null
              : direction === "backward"
                ? oldestMessageIdRef.current
                : latestMessageIdRef.current;

        if (
          !replace &&
          (effectiveLastId === null || typeof effectiveLastId === "undefined")
        ) {
          return;
        }

        if (typeof effectiveLastId === "number") {
          searchParams.set("lastId", String(effectiveLastId));
        }

        if (direction === "backward") {
          searchParams.set("direction", "backward");
        }
      }

      if (replace) {
        setCurrentChat((prev) =>
          prev.chatId === chatId ? { ...prev, isLoading: true } : prev
        );
      } else if (isPagination) {
        setCurrentChat((prev) =>
          prev.chatId === chatId ? { ...prev, isPaginationLoading: true } : prev
        );
      }

      try {
        const response = await fetch(
          `/api/messages?${searchParams.toString()}`,
          {
            headers: {
              "x-session-id": sessionId,
            },
            signal,
          }
        );

        if (!response.ok) {
          const errorBody = await response.json().catch(() => null);
          const message =
            errorBody?.error ?? `Failed to fetch messages (${response.status})`;
          reportApiError({ status: response.status, message });
          throw new Error(message);
        }

        const data = await response.json();
        reportConnectionRestored(); // Connection is good
        const records: OdooMessageRecord[] = Array.isArray(data?.messages)
          ? data.messages.reverse() // Backend returns newest first, reverse for chat display
          : [];

        const rawMessages: MessageWithReplyReference[] = records.map(
          (record) => {
            const timestamp = record.timestamp * 1000; // Convert seconds to milliseconds
            const direction = record.direction ?? "incoming";
            const status = (record.status ?? "").toLowerCase();
            const messageText = record.body || "";

            const deliveredStatuses = ["delivered", "read"];
            const sentStatuses = ["sent", ...deliveredStatuses];
            const userIdValue =
              Array.isArray(record.create_uid) && record.create_uid.length > 0
                ? record.create_uid[0]
                : null;
            const whatsappId =
              typeof record.message_id === "string" ? record.message_id : null;
            const replyTuple = Array.isArray(record.replied_message_id)
              ? record.replied_message_id
              : null;
            const replyMessageId = replyTuple?.[0]
              ? String(replyTuple[0])
              : null;
            const reactionEmoji =
              typeof record.reaction_emoji === "string"
                ? record.reaction_emoji
                : null;

            return {
              id: record.id.toString(),
              contactId: chatId,
              message: messageText,
              timestamp,
              isSentFromUser: direction === "outgoing",
              sent: sentStatuses.includes(status),
              delivered: deliveredStatuses.includes(status),
              read: status === "read",
              userId: userIdValue ?? null,
              whatsappId,
              replyMessageId,
              attachment: record.attachment,
              reactionEmoji,
            };
          }
        );

        let nextLatestTimestamp: number | null | undefined;
        let nextLatestMessageId: number | null | undefined;

        setCurrentChat((prev) => {
          if (prev.chatId !== chatId) {
            return prev;
          }

          const repliesById = new Map<
            string,
            NonNullable<Message["replyTo"]>
          >();

          prev.messages.forEach((message) => {
            if (message.id) {
              const meta = toReplyMetadata(message);
              if (meta) {
                repliesById.set(message.id, meta);
              }
            }
          });

          rawMessages.forEach((message) => {
            if (message.id) {
              const meta = toReplyMetadata(message);
              if (meta) {
                repliesById.set(message.id, meta);
              }
            }
          });

          const mappedMessages: Message[] = rawMessages.map((message) => {
            const { replyMessageId, ...rest } = message;
            const baseMessage = rest as Message;

            if (!replyMessageId) {
              return baseMessage;
            }

            const replyMetadata = repliesById.get(replyMessageId);
            if (!replyMetadata) {
              return baseMessage;
            }

            return {
              ...baseMessage,
              replyTo: replyMetadata,
            };
          });

          const isInitialLoad = replace || prev.messages.length === 0;
          const existingIds = new Set(
            prev.messages
              .map((message) => message.id)
              .filter((id): id is string => Boolean(id))
          );

          const incomingMessages = isInitialLoad
            ? mappedMessages
            : mappedMessages.filter(
                (message) => !message.id || !existingIds.has(message.id)
              );

          if (!isInitialLoad && incomingMessages.length === 0) {
            nextLatestTimestamp = latestMessageTimestampRef.current ?? null;
            nextLatestMessageId = latestMessageIdRef.current ?? null;

            return {
              ...prev,
              isLoading: false,
              isPaginationLoading: false,
              hasMoreMessages:
                direction === "backward" ? false : prev.hasMoreMessages,
            };
          }

          // Merge messages - prepend for backward pagination, append for forward
          const mergedMessages = (
            isInitialLoad
              ? incomingMessages
              : direction === "backward"
                ? [...incomingMessages, ...prev.messages]
                : [...prev.messages, ...incomingMessages]
          ).sort((a, b) => a.timestamp - b.timestamp);

          nextLatestTimestamp =
            mergedMessages.length > 0
              ? mergedMessages[mergedMessages.length - 1].timestamp
              : null;

          const mergedNumericIds = mergedMessages
            .map((message) => Number.parseInt(message.id ?? "", 10))
            .filter((id) => !Number.isNaN(id));
          nextLatestMessageId =
            mergedNumericIds.length > 0 ? Math.max(...mergedNumericIds) : null;

          // Check if we have fewer messages than requested (means no more messages to load)
          const hasMoreMessages = (() => {
            if (isInitialLoad) {
              // On initial load, if we got a full batch, assume there might be more
              // If we got less than the batch size, we know there are no older messages
              return incomingMessages.length >= MESSAGE_BATCH_SIZE;
            } else if (direction === "backward") {
              // For backward pagination, check if we got a full batch
              return incomingMessages.length >= MESSAGE_BATCH_SIZE;
            } else {
              // For forward pagination, keep previous state
              return prev.hasMoreMessages;
            }
          })();

          return {
            ...prev,
            messages: mergedMessages,
            isLoading: false,
            isPaginationLoading: false,
            hasMoreMessages,
          };
        });

        if (typeof nextLatestTimestamp !== "undefined") {
          latestMessageTimestampRef.current = nextLatestTimestamp;
        }
        if (typeof nextLatestMessageId !== "undefined") {
          latestMessageIdRef.current =
            nextLatestMessageId === null ? null : nextLatestMessageId;
        }

        // Update oldestMessageId for backward pagination
        setCurrentChat((prev) => {
          const allNumericIds = prev.messages
            .map((message) => Number.parseInt(message.id ?? "", 10))
            .filter((id) => !Number.isNaN(id));
          const newOldestMessageId =
            allNumericIds.length > 0 ? Math.min(...allNumericIds) : null;
          oldestMessageIdRef.current = newOldestMessageId;
          return prev;
        });
      } catch (error) {
        if (
          (signal && signal.aborted) ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        reportApiError(error);
        if (replace) {
          setCurrentChat((prev) =>
            prev.chatId === chatId
              ? {
                  ...prev,
                  messages: [],
                  isLoading: false,
                  isPaginationLoading: false,
                  replyTo: null,
                }
              : prev
          );
          latestMessageTimestampRef.current = null;
          latestMessageIdRef.current = null;
          oldestMessageIdRef.current = null;
        } else {
          setCurrentChat((prev) =>
            prev.chatId === chatId
              ? { ...prev, isLoading: false, isPaginationLoading: false }
              : prev
          );
        }
      }
    },
    [chatId, sessionId, reportApiError, reportConnectionRestored]
  );

  useEffect(() => {
    if (!chatId || !sessionId) {
      setCurrentChat((prev) => ({
        ...prev,
        messages: [],
        isLoading: false,
        isPaginationLoading: false,
        hasMoreMessages: true,
        isSending: false,
        phoneNumber: null,
        backendId: null,
        partnerId: null,
        hasAvatar: false,
        replyTo: null,
      }));
      latestMessageTimestampRef.current = null;
      latestMessageIdRef.current = null;
      oldestMessageIdRef.current = null;
      return;
    }

    const abortController = new AbortController();
    const aroundId = targetMessageIdRef.current;
    targetMessageIdRef.current = null;
    fetchMessages({ replace: true, signal: abortController.signal, aroundId });

    return () => {
      abortController.abort();
    };
  }, [chatId, sessionId, fetchMessages]);

  // Polling disabled - using SSE instead

  useEffect(() => {
    const chat = complete.find((chat: Chat) => chat.id === currentChat.chatId);
    if (chat) {
      if (typeof chat.contactId == "string") {
        const contactId = chat.contactId;
        const contact = contacts.find(
          (contact: Contact) => contact.id === contactId
        );
        setCurrentChat((prev) => ({
          ...prev,
          contact: contact ?? null,
          group: null,
          threadName: chat.threadName ?? prev.threadName,
          phoneNumber:
            chat.phoneNumber ??
            prev.phoneNumber ??
            extractDigits(chat.threadName) ??
            extractDigits(contact?.displayName),
          backendId:
            typeof chat.backendId === "number"
              ? chat.backendId
              : prev.backendId,
          partnerId:
            typeof chat.partnerId === "number"
              ? chat.partnerId
              : prev.partnerId,
          partnerName:
            typeof chat.partnerName === "string"
              ? chat.partnerName
              : prev.partnerName,
          hasAvatar: chat.hasAvatar === true,
        }));
      } else {
        const groupContacts: CurrentChatContacts = {};
        chat.contactId.forEach((groupContact: string) => {
          groupContacts[groupContact] = contacts.find(
            (contact: Contact) => contact.id === groupContact
          );
        });
        setCurrentChat((prev) => ({
          ...prev,
          contact: null,
          group: {
            name: chat.groupName ?? "",
            avatar: chat.groupAvatar ?? "",
            contacts: groupContacts,
          },
          threadName: chat.groupName ?? chat.threadName ?? prev.threadName,
          phoneNumber:
            chat.phoneNumber ??
            prev.phoneNumber ??
            extractDigits(chat.threadName),
          backendId:
            typeof chat.backendId === "number"
              ? chat.backendId
              : prev.backendId,
          partnerId:
            typeof chat.partnerId === "number"
              ? chat.partnerId
              : prev.partnerId,
          partnerName:
            typeof chat.partnerName === "string"
              ? chat.partnerName
              : prev.partnerName,
          hasAvatar: chat.hasAvatar === true,
        }));
      }
    }
  }, [complete, contacts, currentChat.chatId]);

  const loadCurrentChat = (chat: Partial<CurrentChatData>) => {
    const isSameChat =
      chat.chatId != null && chat.chatId === currentChat.chatId;

    setCurrentChat((prev) => ({
      ...prev,
      ...chat,
      isSending: false,
      isPaginationLoading: false,
      hasMoreMessages: true,
      replyTo: null,
    }));
    targetMessageIdRef.current =
      typeof chat.targetMessageId === "number" ? chat.targetMessageId : null;
    latestMessageTimestampRef.current = null;

    latestMessageIdRef.current = null;
    oldestMessageIdRef.current = null;
    // Mark thread as read when opening it
    if (chat.chatId && sessionId) {
      fetch("/api/threads/mark-read", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-session-id": sessionId,
        },
        body: JSON.stringify({ threadId: chat.chatId }),
      }).catch(() => {
        // Silently fail - not critical if mark as read fails
      });
    }
    // If navigating to a target message in the same thread,
    // fetch directly since the useEffect won't re-fire (chatId unchanged)
    if (isSameChat && typeof chat.targetMessageId === "number") {
      fetchMessages({ replace: true, aroundId: chat.targetMessageId });
    }
  };

  const loadPreviousMessages = useCallback(async () => {
    if (!chatId || !sessionId) {
      return;
    }

    if (currentChat.isPaginationLoading || !currentChat.hasMoreMessages) {
      return;
    }

    await fetchMessages({
      direction: "backward",
      isPagination: true,
    });
  }, [
    chatId,
    sessionId,
    currentChat.isPaginationLoading,
    currentChat.hasMoreMessages,
    fetchMessages,
  ]);

  const sendMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (trimmed.length === 0) {
        return;
      }
      if (!sessionId) {
        throw new Error("You are not authenticated");
      }
      const activeChatId = currentChat.chatId;
      if (!activeChatId) {
        throw new Error("No conversation selected");
      }
      const numericThreadId = Number(activeChatId);
      if (Number.isNaN(numericThreadId)) {
        throw new Error("Invalid conversation identifier");
      }

      const fallbackPhone =
        currentChat.phoneNumber ??
        extractDigits(currentChat.threadName) ??
        extractDigits(currentChat.contact?.displayName);

      if (!fallbackPhone) {
        throw new Error("Unable to determine the recipient phone number");
      }

      const backendId = currentChat.backendId ?? authBackendId ?? undefined;
      const optimisticId = `local-${Date.now()}`;
      const timestamp = Math.floor(Date.now()); // Use millisecond precision timestamp
      const replyTarget = currentChat.replyTo;
      const replyMetadata =
        replyTarget && replyTarget.contactId === activeChatId
          ? toReplyMetadata(replyTarget)
          : null;

      setCurrentChat((prev) => {
        if (prev.chatId !== activeChatId) {
          return prev;
        }
        return {
          ...prev,
          phoneNumber: prev.phoneNumber ?? fallbackPhone,
          messages: [
            ...prev.messages,
            {
              id: optimisticId,
              contactId: activeChatId,
              message: trimmed,
              timestamp,
              isSentFromUser: true,
              sent: false,
              delivered: false,
              read: false,
              userId: backendUserId ?? null,
              whatsappId: null,
              replyTo: replyMetadata ?? undefined,
            },
          ],
          isSending: true,
          replyTo: null,
        };
      });

      latestMessageTimestampRef.current =
        latestMessageTimestampRef.current === null
          ? timestamp
          : Math.max(latestMessageTimestampRef.current, timestamp);

      try {
        const response = await fetch("/api/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-session-id": sessionId,
          },
          body: JSON.stringify({
            threadId: numericThreadId,
            phoneNumber: fallbackPhone,
            message: trimmed,
            backendId,
            replyToMessageId: replyMetadata?.messageId ?? undefined,
          }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const message =
            typeof data?.error === "string"
              ? data.error
              : "Failed to send the message";
          reportApiError({ status: response.status, message });
          throw new Error(message);
        }

        const result = data?.result ?? {};
        reportConnectionRestored(); // Connection is good
        const messageId =
          typeof result?.message_id === "number"
            ? result.message_id
            : undefined;
        const whatsappId =
          typeof result?.whatsapp_message_id === "string"
            ? result.whatsapp_message_id
            : undefined;
        const status =
          typeof result?.status === "string"
            ? result.status.toLowerCase()
            : undefined;
        const deliveredStatuses = ["delivered", "read"];
        const readStatuses = ["read"];

        setCurrentChat((prev) => {
          if (prev.chatId !== activeChatId) {
            return prev;
          }
          return {
            ...prev,
            messages: prev.messages.map((message) => {
              if (message.id !== optimisticId) {
                return message;
              }
              return {
                ...message,
                id: messageId ? messageId.toString() : message.id,
                whatsappId: whatsappId ?? message.whatsappId,
                sent: true,
                delivered: status ? deliveredStatuses.includes(status) : true,
                read: status ? readStatuses.includes(status) : false,
                error: undefined,
                // Keep the optimistic timestamp for consistent ordering
                timestamp: message.timestamp,
                // Preserve replyTo metadata
                replyTo: message.replyTo,
              };
            }),
            isSending: false,
            phoneNumber: prev.phoneNumber ?? fallbackPhone,
          };
        });

        if (typeof messageId === "number") {
          latestMessageIdRef.current =
            latestMessageIdRef.current === null
              ? messageId
              : Math.max(latestMessageIdRef.current, messageId);
        } else {
          void fetchMessages({ replace: true }).catch(() => undefined);
        }

        // Update thread preview with the sent message
        updateThreadPreview(activeChatId, trimmed, timestamp);
      } catch (error) {
        const err = error as Error;
        reportApiError(error);
        setCurrentChat((prev) => {
          if (prev.chatId !== activeChatId) {
            return prev;
          }
          return {
            ...prev,
            messages: prev.messages.map((message) => {
              if (message.id !== optimisticId) {
                return message;
              }
              return {
                ...message,
                sent: false,
                delivered: false,
                read: false,
                error: err.message || "Failed to send the message",
              };
            }),
            isSending: false,
          };
        });
        throw err;
      }
    },
    [
      sessionId,
      currentChat,
      backendUserId,
      authBackendId,
      fetchMessages,
      updateThreadPreview,
      reportApiError,
      reportConnectionRestored,
    ]
  );

  const sendAttachment = useCallback(
    async (file: File, caption?: string) => {
      if (!sessionId) {
        throw new Error("You are not authenticated");
      }
      const activeChatId = currentChat.chatId;
      if (!activeChatId) {
        throw new Error("No conversation selected");
      }
      const numericThreadId = Number(activeChatId);
      if (Number.isNaN(numericThreadId)) {
        throw new Error("Invalid conversation identifier");
      }

      const fallbackPhone =
        currentChat.phoneNumber ??
        extractDigits(currentChat.threadName) ??
        extractDigits(currentChat.contact?.displayName);

      if (!fallbackPhone) {
        throw new Error("Unable to determine the recipient phone number");
      }

      const backendId = currentChat.backendId ?? authBackendId ?? undefined;
      if (!backendId) {
        throw new Error("Unable to determine backend ID");
      }

      const optimisticId = `local-${Date.now()}`;
      const timestamp = Math.floor(Date.now());

      // Create optimistic attachment preview
      const optimisticAttachment = {
        id: 0,
        name: file.name,
        mimetype: file.type,
        url: URL.createObjectURL(file),
        file_size: file.size,
      };

      setCurrentChat((prev) => {
        if (prev.chatId !== activeChatId) {
          return prev;
        }
        return {
          ...prev,
          phoneNumber: prev.phoneNumber ?? fallbackPhone,
          messages: [
            ...prev.messages,
            {
              id: optimisticId,
              contactId: activeChatId,
              message: caption || "",
              timestamp,
              isSentFromUser: true,
              sent: false,
              delivered: false,
              read: false,
              userId: backendUserId ?? null,
              whatsappId: null,
              attachment: optimisticAttachment,
            },
          ],
          isSending: true,
        };
      });

      latestMessageTimestampRef.current =
        latestMessageTimestampRef.current === null
          ? timestamp
          : Math.max(latestMessageTimestampRef.current, timestamp);

      try {
        // Step 1: Upload attachment to Odoo
        const formData = new FormData();
        formData.append("file", file);

        const uploadResponse = await fetch("/api/attachments/upload", {
          method: "POST",
          headers: {
            "x-session-id": sessionId,
          },
          body: formData,
        });

        if (!uploadResponse.ok) {
          const errorData = await uploadResponse.json().catch(() => ({}));
          throw new Error(errorData.error || "Failed to upload attachment");
        }

        const uploadData = await uploadResponse.json();
        const attachmentId = uploadData.attachmentId;

        if (!attachmentId) {
          throw new Error("No attachment ID returned from upload");
        }

        // Step 2: Send message with attachment using send_image_message
        // Determine the method based on file type
        const isImage = file.type.startsWith("image/");
        const isVideo = file.type.startsWith("video/");
        const isAudio = file.type.startsWith("audio/");
        const isDocument = !isImage && !isVideo && !isAudio;
        const method = isImage
          ? "send_image_message"
          : isVideo
            ? "send_video_message"
            : isAudio
              ? "send_audio_message"
              : "send_document_message";

        const response = await fetch("/api/messages/send-attachment", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-session-id": sessionId,
          },
          body: JSON.stringify({
            threadId: numericThreadId,
            phoneNumber: fallbackPhone,
            backendId,
            attachmentId,
            caption: caption || undefined,
            method,
            filename: isDocument ? file.name : undefined,
          }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const message =
            typeof data?.error === "string"
              ? data.error
              : "Failed to send the attachment";
          reportApiError({ status: response.status, message });
          throw new Error(message);
        }

        const result = data?.result ?? {};
        reportConnectionRestored();
        const messageId =
          typeof result?.message_id === "number"
            ? result.message_id
            : undefined;

        // Clean up the optimistic object URL
        setCurrentChat((prev) => {
          const optimisticMessage = prev.messages.find(
            (m) => m.id === optimisticId
          );
          if (optimisticMessage?.attachment?.url) {
            URL.revokeObjectURL(optimisticMessage.attachment.url);
          }
          return prev;
        });

        // Always refetch messages to get the real attachment URL from backend
        if (typeof messageId === "number") {
          latestMessageIdRef.current =
            latestMessageIdRef.current === null
              ? messageId
              : Math.max(latestMessageIdRef.current, messageId);

          // Fetch messages to get the complete attachment data
          await fetchMessages({ replace: true });
        } else {
          void fetchMessages({ replace: true }).catch(() => undefined);
        }

        setCurrentChat((prev) => {
          if (prev.chatId !== activeChatId) {
            return prev;
          }
          return {
            ...prev,
            isSending: false,
          };
        });

        // Update thread preview with the caption or attachment indicator
        const previewText = caption || `📎 ${file.name}`;
        updateThreadPreview(activeChatId, previewText, timestamp);
      } catch (error) {
        const err = error as Error;
        reportApiError(error);
        setCurrentChat((prev) => {
          if (prev.chatId !== activeChatId) {
            return prev;
          }
          return {
            ...prev,
            messages: prev.messages.map((message) => {
              if (message.id !== optimisticId) {
                return message;
              }
              // Clean up object URL on error
              if (message.attachment?.url) {
                URL.revokeObjectURL(message.attachment.url);
              }
              return {
                ...message,
                sent: false,
                delivered: false,
                read: false,
                error: err.message || "Failed to send the attachment",
              };
            }),
            isSending: false,
          };
        });
        throw err;
      }
    },
    [
      sessionId,
      currentChat,
      backendUserId,
      authBackendId,
      fetchMessages,
      updateThreadPreview,
      reportApiError,
      reportConnectionRestored,
    ]
  );

  const sendReaction = useCallback(
    async (message: Message, emoji: string) => {
      if (!sessionId) {
        throw new Error("You are not authenticated");
      }
      if (!message.whatsappId) {
        throw new Error("Cannot react to this message (missing WhatsApp ID)");
      }

      const fallbackPhone =
        currentChat.phoneNumber ??
        extractDigits(currentChat.threadName) ??
        extractDigits(currentChat.contact?.displayName);

      if (!fallbackPhone) {
        throw new Error("Unable to determine the recipient phone number");
      }

      const backendId = currentChat.backendId ?? authBackendId ?? undefined;

      try {
        const response = await fetch("/api/messages/send-reaction", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-session-id": sessionId,
          },
          body: JSON.stringify({
            phoneNumber: fallbackPhone,
            emoji,
            whatsappMessageId: message.whatsappId,
            backendId,
          }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const errorMessage =
            typeof data?.error === "string"
              ? data.error
              : "Failed to send reaction";
          reportApiError({ status: response.status, message: errorMessage });
          throw new Error(errorMessage);
        }

        reportConnectionRestored();

        // Optimistically update the message with the reaction
        setCurrentChat((prev) => ({
          ...prev,
          messages: prev.messages.map((m) =>
            m.id === message.id ? { ...m, reactionEmoji: emoji } : m
          ),
        }));
      } catch (error) {
        const err = error as Error;
        reportApiError(error);
        throw err;
      }
    },
    [
      sessionId,
      currentChat,
      authBackendId,
      reportApiError,
      reportConnectionRestored,
    ]
  );

  const startReply = useCallback((message: Message) => {
    if (!message.whatsappId) {
      return;
    }
    setCurrentChat((prev) => {
      if (prev.chatId !== message.contactId) {
        return prev;
      }
      return {
        ...prev,
        replyTo: message,
      };
    });
  }, []);

  const cancelReply = useCallback(() => {
    setCurrentChat((prev) => ({
      ...prev,
      replyTo: null,
    }));
  }, []);

  // Track which thread is on screen so notifications stay quiet for it, and
  // treat everything already rendered as seen. Alerting is owned by
  // ChatsProvider, which sees messages from every thread.
  useEffect(() => {
    setActiveThread(currentChat.chatId);
    return () => setActiveThread(null);
  }, [currentChat.chatId]);

  useEffect(() => {
    if (!currentChat.chatId) {
      return;
    }
    markMessagesAsSeen(
      currentChat.chatId,
      currentChat.messages
        .filter((message) => !message.isSentFromUser && message.id)
        .map((message) => message.id as string)
    );
  }, [currentChat.chatId, currentChat.messages]);

  return (
    <CurrentChatContext.Provider
      value={{
        ...currentChat,
        loadCurrentChat,
        sendMessage,
        sendAttachment,
        sendReaction,
        startReply,
        cancelReply,
        loadPreviousMessages,
      }}
    >
      {children}
    </CurrentChatContext.Provider>
  );
}
