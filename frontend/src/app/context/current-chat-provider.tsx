import {
  createContext,
  PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Chat, Message } from "./chats-provider";
import { useChats } from "../hooks/use-chats";
import { useContacts } from "../hooks/use-contacts";
import { Contact } from "./contacts-provider";
import { useAuth } from "../hooks/use-auth";
import { useRealtime } from "../hooks/use-realtime";
import { useConnection } from "./connection-provider";
import { apiFetch } from "../lib/api-client";
import { markMessagesAsSeen, setActiveThread } from "../lib/notifications";
import {
  messagesKey,
  removeCachedMessage,
  upsertCachedMessages,
  type MessagesPage,
} from "../lib/whatsapp/message-cache";
import {
  mergeMessages,
  toMessage,
  toReplyMetadata,
  type OdooMessageRecord,
} from "../lib/whatsapp/records";

// Message pagination configuration
const MESSAGE_BATCH_SIZE = 100;
// Realtime events carry changes; this only repairs what a lost event missed
const POLL_INTERVAL_MS = 10 * 60 * 1000;
const DELIVERED_STATUSES = new Set(["delivered", "read"]);

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

// Everything but the messages, which live in the query cache
type ChatState = Omit<
  CurrentChatData,
  "messages" | "isLoading" | "isPaginationLoading" | "hasMoreMessages"
>;

type SendResult = {
  message_id?: number;
  whatsapp_id?: string;
  status?: string;
};

const extractDigits = (value?: string | null) => {
  if (!value) {
    return null;
  }
  const digits = value.replace(/\D/g, "");
  return digits.length >= 6 ? digits : null;
};

const oldestMessageId = (messages: Message[]) => {
  const ids = messages
    .map((message) => Number(message.id))
    .filter(Number.isFinite);
  return ids.length > 0 ? Math.min(...ids) : undefined;
};

export default function CurrentChatProvider({ children }: PropsWithChildren) {
  const [currentChat, setCurrentChat] = useState<ChatState>({
    chatId: null,
    contact: null,
    group: null,
    page: 0,
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
  const {
    chats: { complete },
    updateThreadPreview,
    markChatAsRead,
  } = useChats();
  const { contacts } = useContacts();
  const { sessionId, backendId: authBackendId, backendUserId } = useAuth();
  const { reportApiError, reportConnectionRestored } = useConnection();
  const queryClient = useQueryClient();
  const { chatId, targetMessageId } = currentChat;

  // One cache entry per thread: reopening a chat shows it at once and
  // refreshes it in the background.
  const messagesQuery = useInfiniteQuery({
    queryKey: messagesKey(chatId ?? "", targetMessageId),
    enabled: !!sessionId && !!chatId,
    initialPageParam: null as number | null,
    refetchInterval: POLL_INTERVAL_MS,
    queryFn: async ({ pageParam, signal }): Promise<MessagesPage> => {
      const threadId = chatId as string;
      const params = new URLSearchParams({
        threadId,
        limit: String(MESSAGE_BATCH_SIZE),
      });
      if (pageParam !== null) {
        params.set("lastId", String(pageParam));
        params.set("direction", "backward");
      } else if (targetMessageId) {
        params.set("aroundId", String(targetMessageId));
      }
      const { messages = [] } = await apiFetch<{
        messages?: OdooMessageRecord[];
      }>(`/api/messages?${params}`, { sessionId, signal });
      return {
        messages: mergeMessages(
          [],
          messages.map((record) => toMessage(record, threadId))
        ),
        hasMore: messages.length >= MESSAGE_BATCH_SIZE,
      };
    },
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? oldestMessageId(lastPage.messages) : undefined,
  });

  const messages = useMemo(
    () =>
      mergeMessages(
        [],
        (messagesQuery.data?.pages ?? []).flatMap((page) => page.messages)
      ),
    [messagesQuery.data]
  );

  const knownMessageIdsRef = useRef<Set<string | undefined>>(new Set());
  useEffect(() => {
    knownMessageIdsRef.current = new Set(messages.map((message) => message.id));
  }, [messages]);

  const markThreadRead = useCallback(
    (threadId: string) => {
      markChatAsRead(threadId);
      apiFetch("/api/threads/mark-read", {
        sessionId,
        method: "POST",
        body: { threadId },
      })
        .then(() =>
          queryClient.invalidateQueries({ queryKey: ["unread-count"] })
        )
        .catch(() => {
          // Not critical: the thread is marked read on the next open
        });
    },
    [sessionId, markChatAsRead, queryClient]
  );

  // ChatsProvider puts realtime messages in the cache; a customer message
  // arriving in the open chat is read by the user.
  useRealtime({
    onMessage: (event, threadId, record) => {
      if (
        event === "created" &&
        threadId === chatId &&
        record.direction === "incoming" &&
        !knownMessageIdsRef.current.has(String(record.id))
      ) {
        markThreadRead(threadId);
      }
    },
  });

  // The header follows the chat list (partner, name, backend) as it changes
  const listedChat = useMemo(
    () => complete.find((entry: Chat) => entry.id === chatId),
    [complete, chatId]
  );
  const header = useMemo(() => {
    if (!listedChat || typeof listedChat.contactId !== "string") {
      return currentChat;
    }
    const contactId = listedChat.contactId;
    const contact = contacts.find((entry: Contact) => entry.id === contactId);
    return {
      ...currentChat,
      contact: contact ?? null,
      group: null,
      threadName: listedChat.threadName ?? currentChat.threadName,
      phoneNumber:
        listedChat.phoneNumber ??
        currentChat.phoneNumber ??
        extractDigits(listedChat.threadName) ??
        extractDigits(contact?.displayName),
      backendId: listedChat.backendId ?? currentChat.backendId,
      partnerId: listedChat.partnerId ?? currentChat.partnerId,
      partnerName: listedChat.partnerName ?? currentChat.partnerName,
      hasAvatar: listedChat.hasAvatar === true,
    };
  }, [listedChat, contacts, currentChat]);

  const loadCurrentChat = useCallback(
    (chat: Partial<CurrentChatData>) => {
      setCurrentChat((prev) => ({
        ...prev,
        ...chat,
        // A search jump sets a target; any other open must clear it, or the
        // chat opens where the old target was instead of at the bottom.
        targetMessageId: chat.targetMessageId ?? null,
        isSending: false,
        replyTo: null,
      }));
      if (chat.chatId && sessionId) {
        markThreadRead(chat.chatId);
      }
    },
    [sessionId, markThreadRead]
  );

  const {
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage: fetchOlderMessages,
  } = messagesQuery;
  const loadPreviousMessages = useCallback(async () => {
    if (hasNextPage && !isFetchingNextPage) {
      await fetchOlderMessages();
    }
  }, [hasNextPage, isFetchingNextPage, fetchOlderMessages]);

  /** Where a message of the open chat goes, or an error to show. */
  const getRecipient = useCallback(() => {
    if (!sessionId) {
      throw new Error("You are not authenticated");
    }
    const threadId = header.chatId;
    if (!threadId) {
      throw new Error("No conversation selected");
    }
    const numericThreadId = Number(threadId);
    if (Number.isNaN(numericThreadId)) {
      throw new Error("Invalid conversation identifier");
    }
    const phoneNumber =
      header.phoneNumber ??
      extractDigits(header.threadName) ??
      extractDigits(header.contact?.displayName);
    if (!phoneNumber) {
      throw new Error("Unable to determine the recipient phone number");
    }
    const backendId = header.backendId ?? authBackendId ?? undefined;
    return { threadId, numericThreadId, phoneNumber, backendId };
  }, [sessionId, header, authBackendId]);

  const setSending = useCallback((threadId: string, isSending: boolean) => {
    setCurrentChat((prev) =>
      prev.chatId === threadId ? { ...prev, isSending } : prev
    );
  }, []);

  /** Swap a message being sent for its saved copy. */
  const confirmSent = useCallback(
    (threadId: string, pending: Message, result: SendResult) => {
      removeCachedMessage(queryClient, threadId, pending.id as string);
      const status = result.status?.toLowerCase() ?? "";
      upsertCachedMessages(queryClient, threadId, [
        {
          ...pending,
          id: String(result.message_id),
          whatsappId: result.whatsapp_id ?? null,
          sent: true,
          delivered: DELIVERED_STATUSES.has(status),
          read: status === "read",
          error: undefined,
        },
      ]);
    },
    [queryClient]
  );

  const sendMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (trimmed.length === 0) {
        return;
      }
      const { threadId, numericThreadId, phoneNumber, backendId } =
        getRecipient();
      const replyTarget = currentChat.replyTo;
      const replyTo =
        replyTarget && replyTarget.contactId === threadId
          ? toReplyMetadata(replyTarget)
          : null;
      const pending: Message = {
        id: `local-${Date.now()}`,
        contactId: threadId,
        message: trimmed,
        timestamp: Date.now(),
        isSentFromUser: true,
        sent: false,
        delivered: false,
        read: false,
        userId: backendUserId ?? null,
        whatsappId: null,
        replyTo: replyTo ?? undefined,
      };
      upsertCachedMessages(queryClient, threadId, [pending]);
      setCurrentChat((prev) =>
        prev.chatId === threadId
          ? { ...prev, isSending: true, replyTo: null }
          : prev
      );

      try {
        const { result = {} } = await apiFetch<{ result?: SendResult }>(
          "/api/messages",
          {
            sessionId,
            method: "POST",
            body: {
              threadId: numericThreadId,
              phoneNumber,
              message: trimmed,
              backendId,
              replyToMessageId: replyTo?.messageId,
            },
          }
        );
        reportConnectionRestored();
        if (typeof result.message_id === "number") {
          confirmSent(threadId, pending, result);
        } else {
          removeCachedMessage(queryClient, threadId, pending.id as string);
          void queryClient.invalidateQueries({
            queryKey: ["messages", threadId],
          });
        }
        updateThreadPreview(threadId, trimmed, pending.timestamp);
      } catch (error) {
        reportApiError(error);
        upsertCachedMessages(queryClient, threadId, [
          {
            ...pending,
            error: (error as Error).message || "Failed to send the message",
          },
        ]);
        throw error;
      } finally {
        setSending(threadId, false);
      }
    },
    [
      getRecipient,
      currentChat.replyTo,
      backendUserId,
      queryClient,
      sessionId,
      confirmSent,
      setSending,
      updateThreadPreview,
      reportApiError,
      reportConnectionRestored,
    ]
  );

  const sendAttachment = useCallback(
    async (file: File, caption?: string) => {
      const { threadId, numericThreadId, phoneNumber, backendId } =
        getRecipient();
      if (!backendId) {
        throw new Error("Unable to determine backend ID");
      }
      const previewUrl = URL.createObjectURL(file);
      const pending: Message = {
        id: `local-${Date.now()}`,
        contactId: threadId,
        message: caption || "",
        timestamp: Date.now(),
        isSentFromUser: true,
        sent: false,
        delivered: false,
        read: false,
        userId: backendUserId ?? null,
        whatsappId: null,
        attachment: {
          id: 0,
          name: file.name,
          mimetype: file.type,
          url: previewUrl,
          file_size: file.size,
        },
      };
      upsertCachedMessages(queryClient, threadId, [pending]);
      setSending(threadId, true);

      try {
        const formData = new FormData();
        formData.append("file", file);
        const { attachmentId } = await apiFetch<{ attachmentId?: number }>(
          "/api/attachments/upload",
          { sessionId, method: "POST", body: formData }
        );
        if (!attachmentId) {
          throw new Error("No attachment ID returned from upload");
        }

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

        await apiFetch<{ result?: SendResult }>(
          "/api/messages/send-attachment",
          {
            sessionId,
            method: "POST",
            body: {
              threadId: numericThreadId,
              phoneNumber,
              backendId,
              attachmentId,
              caption: caption || undefined,
              method,
              filename: isDocument ? file.name : undefined,
            },
          }
        );
        reportConnectionRestored();
        // The saved message carries Odoo's attachment URL: load it
        removeCachedMessage(queryClient, threadId, pending.id as string);
        URL.revokeObjectURL(previewUrl);
        await queryClient.invalidateQueries({
          queryKey: ["messages", threadId],
        });
        updateThreadPreview(
          threadId,
          caption || `📎 ${file.name}`,
          pending.timestamp
        );
      } catch (error) {
        reportApiError(error);
        URL.revokeObjectURL(previewUrl);
        upsertCachedMessages(queryClient, threadId, [
          {
            ...pending,
            attachment: undefined,
            error: (error as Error).message || "Failed to send the attachment",
          },
        ]);
        throw error;
      } finally {
        setSending(threadId, false);
      }
    },
    [
      getRecipient,
      backendUserId,
      queryClient,
      sessionId,
      setSending,
      updateThreadPreview,
      reportApiError,
      reportConnectionRestored,
    ]
  );

  const sendReaction = useCallback(
    async (message: Message, emoji: string) => {
      if (!message.whatsappId) {
        throw new Error("Cannot react to this message (missing WhatsApp ID)");
      }
      const { threadId, phoneNumber, backendId } = getRecipient();
      try {
        await apiFetch("/api/messages/send-reaction", {
          sessionId,
          method: "POST",
          body: {
            phoneNumber,
            emoji,
            whatsappMessageId: message.whatsappId,
            backendId,
          },
        });
        reportConnectionRestored();
        upsertCachedMessages(queryClient, threadId, [
          { ...message, reactionEmoji: emoji },
        ]);
      } catch (error) {
        reportApiError(error);
        throw error;
      }
    },
    [
      getRecipient,
      sessionId,
      queryClient,
      reportApiError,
      reportConnectionRestored,
    ]
  );

  const startReply = useCallback((message: Message) => {
    if (!message.whatsappId) {
      return;
    }
    setCurrentChat((prev) =>
      prev.chatId === message.contactId ? { ...prev, replyTo: message } : prev
    );
  }, []);

  const cancelReply = useCallback(() => {
    setCurrentChat((prev) => ({ ...prev, replyTo: null }));
  }, []);

  // Track which thread is on screen so notifications stay quiet for it, and
  // treat everything already rendered as seen. Alerting is owned by
  // ChatsProvider, which sees messages from every thread.
  useEffect(() => {
    setActiveThread(chatId);
    return () => setActiveThread(null);
  }, [chatId]);

  useEffect(() => {
    if (!chatId) {
      return;
    }
    markMessagesAsSeen(
      chatId,
      messages
        .filter((message) => !message.isSentFromUser && message.id)
        .map((message) => message.id as string)
    );
  }, [chatId, messages]);

  const value = useMemo<CurrentChat>(
    () => ({
      ...header,
      messages,
      isLoading: !!chatId && messagesQuery.isPending,
      isPaginationLoading: isFetchingNextPage,
      hasMoreMessages: hasNextPage ?? false,
      loadCurrentChat,
      sendMessage,
      sendAttachment,
      sendReaction,
      startReply,
      cancelReply,
      loadPreviousMessages,
    }),
    [
      header,
      messages,
      chatId,
      messagesQuery.isPending,
      isFetchingNextPage,
      hasNextPage,
      loadCurrentChat,
      sendMessage,
      sendAttachment,
      sendReaction,
      startReply,
      cancelReply,
      loadPreviousMessages,
    ]
  );

  return (
    <CurrentChatContext.Provider value={value}>
      {children}
    </CurrentChatContext.Provider>
  );
}
