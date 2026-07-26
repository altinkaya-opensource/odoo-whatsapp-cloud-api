import {
  createContext,
  PropsWithChildren,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAuth } from "../hooks/use-auth";
import { useSSE } from "../hooks/use-sse";
import { useThreadsPoller } from "../hooks/use-threads-poller";
import { useConnection } from "./connection-provider";
import { buildPartnerAvatarUrl } from "../lib/odoo/avatar-url";
import { notifyIncomingMessage, setUnreadBadge } from "../lib/notifications";

export enum Filters {
  ALL = "all",
  UNREAD = "unread",
  FAVORITES = "favorites",
  GROUPS = "groups",
}

export type ReactionType = {
  emoji: string;
  count: number;
};

export type AttachmentType = "image" | "video" | "audio" | "document";

export type Attachment = {
  id: number;
  name: string;
  mimetype: string;
  url: string;
  file_size: number;
  type?: AttachmentType;
};

export type Message = {
  id?: string;
  contactId: string;
  message: string;
  timestamp: number;
  isSentFromUser: boolean;
  read?: boolean;
  sent?: boolean;
  delivered?: boolean;
  reactions?: ReactionType[];
  error?: string;
  userId?: number | null;
  whatsappId?: string | null;
  attachment?: Attachment;
  reactionEmoji?: string | null;
  replyTo?: {
    messageId: string;
    message: string;
    contactId: string;
    senderIsUser: boolean;
  };
};

export type Chat = {
  id: string;
  contactId: string | string[];
  groupName?: string;
  groupAvatar?: string;
  threadName?: string;
  phoneNumber?: string | null;
  backendId?: number | null;
  partnerId?: number | null; // Partner ID for opening in Odoo
  partnerName?: string | null; // Partner display name from Odoo
  partnerAvatar?: string | null; // Partner avatar URL from Odoo
  hasAvatar?: boolean; // NEW: Whether partner has an actual avatar image
  lastMessagePreview?: string;
  lastMessageAt?: number | null;
  unreadCount?: number; // NEW: Unread message count from backend
  read: boolean;
  group: boolean;
  favorite: boolean;
  messages: Message[];
};

export type MessageSearchResult = {
  threadId: number;
  threadName: string;
  phoneNumber: string | null;
  backendId: number | null;
  partnerId: number | null;
  partnerName: string | null;
  messageId: number;
  messageBody: string;
  messageTimestamp: number;
};

export type Chats = {
  complete: Chat[];
  filtered: Chat[];
  isLoading: boolean;
};

export const ChatsContext = createContext<
  | undefined
  | {
      filter: string;
      updateFilter: (filter: string) => void;
      messageSearchResults: MessageSearchResult[];
      isSearchingMessages: boolean;
      hasMoreMessageResults: boolean;
      isLoadingMoreMessages: boolean;
      loadMoreMessageResults: () => void;
      chats: Chats;
      hasMoreThreads: boolean;
      isLoadingMoreThreads: boolean;
      loadMoreThreads: () => void;
      updateThreadPreview: (
        chatId: string,
        preview: string,
        timestamp: number
      ) => void;
      markChatAsRead: (chatId: string) => void;
      totalUnreadCount: number;
      selectedBackendId: number | null;
      setSelectedBackendId: (backendId: number | null) => void;
      searchQuery: string;
      updateSearchQuery: (query: string) => void;
      clearSearch: () => void;
    }
>(undefined);

const THREADS_PAGE_SIZE = 30;
const MESSAGE_SEARCH_PAGE_SIZE = 20;
const CONTACT_SEARCH_PAGE_SIZE = 5;

type ChatsProviderProps = PropsWithChildren<{
  includeThreadId?: string | null;
}>;

export default function ChatsProvider({
  children,
  includeThreadId,
}: ChatsProviderProps) {
  const [filter, setFilter] = useState<Filters>(Filters.ALL);
  const [selectedBackendId, setSelectedBackendId] = useState<number | null>(
    null
  ); // null = all backends
  const [chats, setChats] = useState<Chats>({
    complete: [],
    filtered: [],
    isLoading: false,
  });
  const [hasMoreThreads, setHasMoreThreads] = useState(true);
  const [isLoadingMoreThreads, setIsLoadingMoreThreads] = useState(false);
  const [nextThreadsOffset, setNextThreadsOffset] = useState(0);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState<string>("");
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const debouncedSearchQueryRef = useRef<string>("");
  const [messageSearchResults, setMessageSearchResults] = useState<
    MessageSearchResult[]
  >([]);
  const [isSearchingMessages, setIsSearchingMessages] = useState(false);
  const [hasMoreMessageResults, setHasMoreMessageResults] = useState(false);
  const [isLoadingMoreMessages, setIsLoadingMoreMessages] = useState(false);
  const [nextMessageSearchOffset, setNextMessageSearchOffset] = useState(0);
  const { sessionId, backendId: authBackendId } = useAuth();
  const { reportApiError, reportConnectionRestored } = useConnection();
  const isFetchingRef = useRef(false);
  const chatsRef = useRef<Chat[]>([]);
  const [serverUnreadCount, setServerUnreadCount] = useState<number | null>(
    null
  );
  const [odooBaseUrl, setOdooBaseUrl] = useState<string | null>(null);

  useEffect(() => {
    debouncedSearchQueryRef.current = debouncedSearchQuery;
  }, [debouncedSearchQuery]);

  // Message handlers read the thread list from a ref so they never depend on
  // the render that produced it.
  useEffect(() => {
    chatsRef.current = chats.complete;
  }, [chats.complete]);

  // Fetch Odoo base URL for avatar generation
  useEffect(() => {
    fetch("/api/config")
      .then((res) => res.json())
      .then((data) => {
        if (data.odooBaseUrl) {
          setOdooBaseUrl(data.odooBaseUrl);
        }
      })
      .catch(() => {
        // Silently fail - avatars just won't display
      });
  }, []);

  // SSE callbacks for real-time thread updates
  const handleThreadsUpdate = useCallback(
    (threads: unknown[]) => {
      // Process new threads from SSE
      const odooThreads = threads as Array<{
        id: number;
        name: string;
        last_message_date: string | null;
        last_message_preview: string | null;
        phone_number: string | null;
        backend_id: number | null;
        partner_id?: [number, string] | number | null | false;
        write_date: string;
        unread_count?: number; // NEW: Unread count from backend
        has_avatar?: boolean; // NEW: Whether partner has an actual avatar image
      }>;

      setChats((prev) => {
        // Create a map of existing chats for efficient lookup
        const existingChatsMap = new Map(
          prev.complete.map((chat) => [chat.id, chat])
        );

        // Process updates from SSE
        odooThreads.forEach((thread) => {
          const threadId = thread.id.toString();
          const existingChat = existingChatsMap.get(threadId);

          if (existingChat) {
            // Update existing chat, preserving important data like messages
            const newTimestamp = thread.last_message_date
              ? new Date(thread.last_message_date + "Z").getTime()
              : existingChat.lastMessageAt;

            // Thread events are fanned out to every user of the backend, so
            // they never carry an unread count; only the per-user thread
            // fetch does. Keep the local count when it is absent.
            const newUnreadCount =
              thread.unread_count ?? existingChat.unreadCount ?? 0;
            const hasUnread = newUnreadCount > 0;

            // Extract partner ID and display name from Odoo tuple
            const partnerId =
              Array.isArray(thread.partner_id) && thread.partner_id.length > 0
                ? thread.partner_id[0]
                : typeof thread.partner_id === "number"
                  ? thread.partner_id
                  : null;
            const partnerName =
              Array.isArray(thread.partner_id) && thread.partner_id.length > 1
                ? thread.partner_id[1]
                : null;

            // Always build partner avatar URL if we have partnerId and odooBaseUrl
            // The component will decide whether to use it based on hasAvatar flag
            const hasAvatar = thread.has_avatar === true;
            const partnerAvatar =
              partnerId && odooBaseUrl
                ? buildPartnerAvatarUrl(odooBaseUrl, partnerId, sessionId)
                : null;

            existingChatsMap.set(threadId, {
              ...existingChat,
              lastMessagePreview:
                thread.last_message_preview || existingChat.lastMessagePreview,
              lastMessageAt: newTimestamp,
              threadName: thread.name || existingChat.threadName,
              partnerId: partnerId ?? existingChat.partnerId,
              partnerName: partnerName ?? existingChat.partnerName,
              // Keep existing avatar URL if new one is null (odooBaseUrl not loaded yet)
              partnerAvatar:
                partnerAvatar !== null
                  ? partnerAvatar
                  : existingChat.partnerAvatar,
              hasAvatar: hasAvatar, // Update avatar availability flag
              unreadCount: newUnreadCount, // Update unread count
              read: !hasUnread, // Mark as read if no unread messages
            });
          } else {
            // Add new chat
            const newTimestamp = thread.last_message_date
              ? new Date(thread.last_message_date + "Z").getTime()
              : Date.now();
            const newUnreadCount = thread.unread_count ?? 0;

            // Extract partner ID and display name from Odoo tuple
            const partnerId =
              Array.isArray(thread.partner_id) && thread.partner_id.length > 0
                ? thread.partner_id[0]
                : typeof thread.partner_id === "number"
                  ? thread.partner_id
                  : null;
            const partnerName =
              Array.isArray(thread.partner_id) && thread.partner_id.length > 1
                ? thread.partner_id[1]
                : null;

            // Always build partner avatar URL if we have partnerId and odooBaseUrl
            // The component will decide whether to use it based on hasAvatar flag
            const hasAvatar = thread.has_avatar === true;
            const partnerAvatar =
              partnerId && odooBaseUrl
                ? buildPartnerAvatarUrl(odooBaseUrl, partnerId, sessionId)
                : null;

            existingChatsMap.set(threadId, {
              id: threadId,
              contactId: thread.phone_number || "",
              threadName: thread.name || undefined,
              phoneNumber: thread.phone_number || null,
              backendId: thread.backend_id || null,
              partnerId,
              partnerName,
              partnerAvatar,
              hasAvatar, // Include avatar availability flag
              lastMessagePreview: thread.last_message_preview || "",
              lastMessageAt: newTimestamp,
              unreadCount: newUnreadCount, // Set unread count
              groupName: undefined,
              groupAvatar: undefined,
              read: newUnreadCount === 0, // Mark as read if no unread messages
              favorite: false,
              group: false,
              messages: [],
            });
          }
        });

        // Sort by last message timestamp (only when not searching)
        const updatedComplete = Array.from(existingChatsMap.values());
        if (!debouncedSearchQueryRef.current.trim()) {
          updatedComplete.sort(
            (a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0)
          );
        }

        // Apply filter to get filtered list
        let filteredList = updatedComplete;
        if (filter === Filters.UNREAD) {
          filteredList = updatedComplete.filter((chat) => !chat.read);
        } else if (filter === Filters.FAVORITES) {
          filteredList = updatedComplete.filter((chat) => chat.favorite);
        } else if (filter === Filters.GROUPS) {
          filteredList = updatedComplete.filter((chat) => chat.group);
        }

        return {
          ...prev,
          complete: updatedComplete,
          filtered: filteredList,
          isLoading: false,
        };
      });
    },
    [filter, odooBaseUrl, sessionId]
  );

  // Handle message arrivals to update thread list (unread count, preview, timestamp)
  // This provides immediate optimistic updates, with polling as ground truth sync
  const handleMessageArrival = useCallback(
    (messages: unknown[], threadId: string) => {
      const odooMessages = messages as Array<{
        id: number;
        body: string | null;
        direction: string;
        timestamp: number;
      }>;

      if (odooMessages.length === 0) return;

      const chat = chatsRef.current.find((entry) => entry.id === threadId);
      if (!chat) {
        return;
      }

      const threadName =
        chat.partnerName ||
        chat.threadName ||
        chat.phoneNumber ||
        `Thread ${threadId}`;

      // Notify outside of the state updater: this is the only place that
      // alerts the user about a message, and it must run exactly once per
      // message even if React re-invokes the updater.
      let unreadIncrement = 0;
      odooMessages.forEach((message) => {
        if (message.direction !== "incoming") {
          return;
        }

        const { isNew, interrupted } = notifyIncomingMessage({
          threadId,
          messageId: message.id,
          title: threadName,
          body: message.body || "New message",
        });

        // A message that arrives in the thread the user is reading is marked
        // read straight away, so counting it would only make the badge flash.
        if (isNew && interrupted) {
          unreadIncrement += 1;
        }
      });

      const latestMessage = odooMessages[odooMessages.length - 1];

      setChats((prev) => {
        const existingChatsMap = new Map(
          prev.complete.map((entry) => [entry.id, entry])
        );
        const current = existingChatsMap.get(threadId);

        if (!current) {
          return prev;
        }

        const newUnreadCount = (current.unreadCount || 0) + unreadIncrement;

        existingChatsMap.set(threadId, {
          ...current,
          lastMessagePreview: latestMessage.body || current.lastMessagePreview,
          lastMessageAt: latestMessage.timestamp * 1000,
          unreadCount: newUnreadCount,
          read: newUnreadCount === 0, // Thread is "read" only when unread count is 0
        });

        // Rebuild array and sort by lastMessageAt (only when not searching)
        const updatedChats = Array.from(existingChatsMap.values());
        if (!debouncedSearchQueryRef.current.trim()) {
          updatedChats.sort(
            (a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0)
          );
        }

        return {
          ...prev,
          complete: updatedChats,
        };
      });
    },
    []
  );

  // Initialize SSE connection for threads
  const { isConnected: sseConnected } = useSSE(
    {
      onThreadsUpdate: handleThreadsUpdate,
      onMessagesUpdate: handleMessageArrival, // Optimistic unread count updates
      // STRATEGY: Optimistic updates + polling sync
      // - message.created webhooks → immediate optimistic unread count increment
      // - thread.updated webhooks + polling → backend ground truth (via Math.max)
      // - Polling every 10 min corrects any drift between frontend and backend
      onError: (error) => {
        reportApiError(error);
      },
      onReconnect: () => {
        reportConnectionRestored();
      },
    },
    {
      enabled: !!sessionId,
      threadId: null, // Subscribe to GLOBAL messages and thread updates
    }
  );

  // Initialize periodic thread list polling as a fallback mechanism
  // This ensures unopened threads receive updates even if SSE fails
  useThreadsPoller(
    {
      onThreadsFound: (threads) => {
        // Reuse the same handler as SSE - it already handles thread merging
        handleThreadsUpdate(threads);
      },
      onError: (error) => {
        // Don't report polling errors as aggressively as SSE errors
        // Polling is a fallback mechanism, not the primary delivery method
        console.warn(`[ChatsProvider] Thread polling error:`, error.message);
      },
      onPollComplete: () => {
        // Report successful poll as connection restored
        reportConnectionRestored();
      },
    },
    {
      enabled: !!sessionId,
      interval: 600000, // 10 minutes
    }
  );

  const applyFilter = useCallback(
    (completeChats: Chat[]) => {
      return completeChats.filter((chat) => {
        // First check backend filter
        if (selectedBackendId !== null) {
          if (chat.backendId !== selectedBackendId) {
            return false;
          }
        }

        // Then apply status filters
        if (filter === Filters.UNREAD && chat.read === false) {
          return true;
        }
        if (filter === Filters.FAVORITES && chat.favorite === true) {
          return true;
        }
        if (filter === Filters.GROUPS && chat.group === true) {
          return true;
        }
        if (filter === Filters.ALL) {
          return true;
        }
        return false;
      });
    },
    [filter, selectedBackendId]
  );

  const updateFilter = (filter: string) => {
    setFilter(filter as Filters);
  };

  // Search query handler with debouncing
  const updateSearchQuery = useCallback((query: string) => {
    setSearchQuery(query);

    // Clear existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Debounce the actual search (300ms delay)
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearchQuery(query);
      // Reset pagination when search changes
      setNextThreadsOffset(0);
      setHasMoreThreads(true);
    }, 300);
  }, []);

  // Clear search function
  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setDebouncedSearchQuery("");
    setMessageSearchResults([]);
    setHasMoreMessageResults(false);
    setIsLoadingMoreMessages(false);
    setNextMessageSearchOffset(0);
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    setNextThreadsOffset(0);
    setHasMoreThreads(true);
  }, []);

  const loadMoreMessageResults = useCallback(() => {
    if (
      !sessionId ||
      isLoadingMoreMessages ||
      !hasMoreMessageResults ||
      !debouncedSearchQuery.trim()
    ) {
      return;
    }

    setIsLoadingMoreMessages(true);
    const url = `/api/messages/search?search=${encodeURIComponent(debouncedSearchQuery.trim())}&limit=${MESSAGE_SEARCH_PAGE_SIZE}&offset=${nextMessageSearchOffset}`;

    fetch(url, {
      headers: { "x-session-id": sessionId },
    })
      .then((res) => res.json())
      .then((data) => {
        const results = Array.isArray(data?.messages) ? data.messages : [];
        const mapped = results.map((r: Record<string, unknown>) => ({
          threadId: r.thread_id as number,
          threadName: r.thread_name as string,
          phoneNumber: (r.phone_number as string) ?? null,
          backendId: (r.backend_id as number) ?? null,
          partnerId: (r.partner_id as number) ?? null,
          partnerName: (r.partner_name as string) ?? null,
          messageId: r.message_id as number,
          messageBody: r.message_body as string,
          messageTimestamp: r.message_timestamp as number,
        }));
        setMessageSearchResults((prev) => [...prev, ...mapped]);
        setNextMessageSearchOffset((prev) => prev + MESSAGE_SEARCH_PAGE_SIZE);
        setHasMoreMessageResults(results.length >= MESSAGE_SEARCH_PAGE_SIZE);
      })
      .catch(() => {
        setHasMoreMessageResults(false);
      })
      .finally(() => {
        setIsLoadingMoreMessages(false);
      });
  }, [
    sessionId,
    isLoadingMoreMessages,
    hasMoreMessageResults,
    debouncedSearchQuery,
    nextMessageSearchOffset,
  ]);

  const updateThreadPreview = useCallback(
    (chatId: string, preview: string, timestamp: number) => {
      setChats((prev) => {
        const updatedComplete = prev.complete.map((chat) => {
          if (chat.id === chatId) {
            return {
              ...chat,
              lastMessagePreview: preview,
              lastMessageAt: timestamp,
            };
          }
          return chat;
        });

        // Sort by lastMessageAt to put the updated thread at the top
        // Sort by lastMessageAt to put the updated thread at the top (only when not searching)
        const sortedComplete = debouncedSearchQueryRef.current.trim()
          ? updatedComplete
          : updatedComplete.sort(
              (a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0)
            );

        // Apply current filters to the updated complete list
        const filteredChats = applyFilter(sortedComplete);

        return {
          ...prev,
          complete: sortedComplete,
          filtered: filteredChats,
        };
      });
    },
    [applyFilter]
  );

  const markChatAsRead = useCallback(
    (chatId: string) => {
      setChats((prev) => {
        const updatedComplete = prev.complete.map((chat) => {
          if (chat.id === chatId) {
            // Also reset unread count when marking as read
            return { ...chat, read: true, unreadCount: 0 };
          }
          return chat;
        });

        const filteredChats = applyFilter(updatedComplete);

        return {
          ...prev,
          complete: updatedComplete,
          filtered: filteredChats,
        };
      });
    },
    [applyFilter]
  );

  type ThreadRecord = {
    id: number;
    name: string;
    last_message_date: string | null;
    last_message_preview: string | null;
    phone_number?: string | null;
    backend_id?: [number, string] | number | null | false;
    partner_id?: [number, string] | number | null | false;
    unread_count?: number; // NEW: Unread count from backend
    has_avatar?: boolean; // NEW: Whether partner has an actual avatar image
  };

  const transformThreads = useCallback(
    (threads: ThreadRecord[]): Chat[] => {
      return threads.map((thread) => {
        const chatId = String(thread.id);
        const preview = thread.last_message_preview ?? "";
        const timestamp = thread.last_message_date
          ? new Date(thread.last_message_date + "Z").getTime()
          : null;
        const backendId =
          Array.isArray(thread.backend_id) && thread.backend_id.length > 0
            ? thread.backend_id[0]
            : typeof thread.backend_id === "number"
              ? thread.backend_id
              : (authBackendId ?? null);

        // Extract partner ID and display name from Odoo tuple
        const partnerId =
          Array.isArray(thread.partner_id) && thread.partner_id.length > 0
            ? thread.partner_id[0]
            : typeof thread.partner_id === "number"
              ? thread.partner_id
              : null;
        const partnerName =
          Array.isArray(thread.partner_id) && thread.partner_id.length > 1
            ? thread.partner_id[1]
            : null;

        // Always build partner avatar URL if we have partnerId and odooBaseUrl
        // The component will decide whether to use it based on hasAvatar flag
        const hasAvatar = thread.has_avatar === true;
        const partnerAvatar =
          partnerId && odooBaseUrl
            ? buildPartnerAvatarUrl(odooBaseUrl, partnerId, sessionId)
            : null;

        const phoneNumber = thread.phone_number;
        const unreadCount = thread.unread_count || 0;

        const messages: Message[] = preview
          ? [
              {
                id: `thread-${thread.id}-preview`,
                contactId: chatId,
                message: preview,
                timestamp: timestamp ?? Date.now(),
                isSentFromUser: false,
                whatsappId: null,
              },
            ]
          : [];

        return {
          id: chatId,
          contactId: chatId,
          threadName: thread.name,
          phoneNumber,
          backendId,
          partnerId,
          partnerName,
          partnerAvatar,
          hasAvatar, // Include avatar availability flag
          lastMessagePreview: preview,
          lastMessageAt: timestamp,
          unreadCount, // Include unread count
          read: unreadCount === 0, // Mark as read if no unread messages
          group: false,
          favorite: false,
          messages,
        };
      });
    },
    [authBackendId, odooBaseUrl, sessionId]
  );

  const fetchThreads = useCallback(
    async ({
      showLoading = false,
      append = false,
      offset = 0,
    }: {
      showLoading?: boolean;
      append?: boolean;
      offset?: number;
    } = {}) => {
      if (!sessionId) {
        return;
      }

      if (isFetchingRef.current) {
        return;
      }

      isFetchingRef.current = true;
      if (showLoading) {
        setChats((prev) => ({ ...prev, isLoading: true }));
      }
      if (append) {
        setIsLoadingMoreThreads(true);
      }

      try {
        // Build URL with optional includeThreadId and search parameters
        const pageSize =
          debouncedSearchQuery.trim().length > 0
            ? CONTACT_SEARCH_PAGE_SIZE
            : THREADS_PAGE_SIZE;
        let url = `/api/threads?limit=${pageSize}&offset=${offset}`;
        if (includeThreadId && offset === 0) {
          url += `&includeThreadId=${encodeURIComponent(includeThreadId)}`;
        }
        if (debouncedSearchQuery.trim().length > 0) {
          url += `&search=${encodeURIComponent(debouncedSearchQuery.trim())}`;
        }

        const response = await fetch(url, {
          headers: {
            "x-session-id": sessionId,
          },
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => null);
          const message =
            errorBody?.error ?? `Failed to fetch threads (${response.status})`;
          throw new Error(message);
        }

        const data = await response.json();
        const threads: ThreadRecord[] = Array.isArray(data?.threads)
          ? data.threads
          : [];
        const mappedChats = transformThreads(threads);
        const hasMore = threads.length >= pageSize;

        setHasMoreThreads(hasMore);
        setNextThreadsOffset(offset + pageSize);

        setChats((prev) => {
          if (!append) {
            const filteredChats = applyFilter(mappedChats);
            return {
              ...prev,
              complete: mappedChats,
              filtered: filteredChats,
              isLoading: false,
            };
          }

          const merged = new Map(prev.complete.map((chat) => [chat.id, chat]));
          mappedChats.forEach((chat) => {
            if (!merged.has(chat.id)) {
              merged.set(chat.id, chat);
            }
          });

          const mergedList = Array.from(merged.values()).sort(
            (a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0)
          );

          return {
            ...prev,
            complete: mergedList,
            filtered: applyFilter(mergedList),
            isLoading: false,
          };
        });
      } catch {
        setChats((prev) => ({
          ...prev,
          isLoading: false,
        }));
      } finally {
        isFetchingRef.current = false;
        setIsLoadingMoreThreads(false);
      }
    },
    [
      sessionId,
      transformThreads,
      applyFilter,
      includeThreadId,
      debouncedSearchQuery,
    ]
  );

  const loadMoreThreads = useCallback(() => {
    if (!sessionId || isLoadingMoreThreads || !hasMoreThreads) {
      return;
    }

    fetchThreads({ append: true, offset: nextThreadsOffset });
  }, [
    fetchThreads,
    hasMoreThreads,
    isLoadingMoreThreads,
    nextThreadsOffset,
    sessionId,
  ]);

  useEffect(() => {
    if (!sessionId) {
      isFetchingRef.current = false;
      setHasMoreThreads(false);
      setIsLoadingMoreThreads(false);
      setNextThreadsOffset(0);
      setChats((prev) => ({
        ...prev,
        complete: [],
        filtered: [],
        isLoading: false,
      }));
      return;
    }

    // Initial fetch only - SSE will handle updates
    setHasMoreThreads(true);
    setIsLoadingMoreThreads(false);
    setNextThreadsOffset(0);
    fetchThreads({ showLoading: true, offset: 0 });

    return () => {
      isFetchingRef.current = false;
    };
  }, [sessionId, fetchThreads, sseConnected]);

  useEffect(() => {
    setChats((prev) => {
      const filtered = applyFilter(prev.complete);
      return {
        ...prev,
        filtered,
      };
    });
  }, [filter, applyFilter, chats.complete]);

  // Refetch when search query changes
  useEffect(() => {
    if (!sessionId) return;

    // Skip on initial mount (empty string)
    // The initial fetch effect will handle the first load
    if (debouncedSearchQuery === "" && chats.complete.length === 0) {
      return;
    }

    // Clear message results when search is empty
    if (debouncedSearchQuery.trim().length === 0) {
      setMessageSearchResults([]);
      setIsSearchingMessages(false);
      fetchThreads({ showLoading: true, offset: 0 });
      return;
    }

    // Fetch both contact matches and message matches in parallel
    setIsSearchingMessages(true);
    const messageSearchUrl = `/api/messages/search?search=${encodeURIComponent(debouncedSearchQuery.trim())}&limit=20&offset=0`;

    Promise.all([
      fetchThreads({ showLoading: true, offset: 0 }),
      fetch(messageSearchUrl, {
        headers: { "x-session-id": sessionId },
      })
        .then((res) => res.json())
        .then((data) => {
          const results = Array.isArray(data?.messages) ? data.messages : [];
          setMessageSearchResults(
            results.map((r: Record<string, unknown>) => ({
              threadId: r.thread_id as number,
              threadName: r.thread_name as string,
              phoneNumber: (r.phone_number as string) ?? null,
              backendId: (r.backend_id as number) ?? null,
              partnerId: (r.partner_id as number) ?? null,
              partnerName: (r.partner_name as string) ?? null,
              messageId: r.message_id as number,
              messageBody: r.message_body as string,
              messageTimestamp: r.message_timestamp as number,
            }))
          );
          setNextMessageSearchOffset(MESSAGE_SEARCH_PAGE_SIZE);
          setHasMoreMessageResults(results.length >= MESSAGE_SEARCH_PAGE_SIZE);
        })
        .catch(() => {
          setMessageSearchResults([]);
        }),
    ]).finally(() => {
      setIsSearchingMessages(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearchQuery, sessionId]);

  // Unread total across every thread, not just the loaded page. The local sum
  // only tells us when something changed; the server holds the real number.
  const loadedUnreadCount = chats.complete.reduce(
    (total, chat) => total + (chat.unreadCount ?? 0),
    0
  );

  useEffect(() => {
    if (!sessionId) {
      setServerUnreadCount(null);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      fetch("/api/threads/unread-count", {
        headers: { "x-session-id": sessionId },
        signal: controller.signal,
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (typeof data?.unreadCount === "number") {
            setServerUnreadCount(data.unreadCount);
          }
        })
        .catch(() => {
          // Keep the last known total; the local sum is the fallback.
        });
    }, 400);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [sessionId, loadedUnreadCount]);

  const totalUnreadCount = serverUnreadCount ?? loadedUnreadCount;

  // Mirror the unread total onto the app icon (installed PWA / dock).
  useEffect(() => {
    setUnreadBadge(totalUnreadCount);
  }, [totalUnreadCount]);

  return (
    <ChatsContext.Provider
      value={{
        chats,
        filter,
        updateFilter,
        hasMoreThreads,
        isLoadingMoreThreads,
        loadMoreThreads,
        updateThreadPreview,
        markChatAsRead,
        totalUnreadCount,
        selectedBackendId,
        setSelectedBackendId,
        searchQuery,
        updateSearchQuery,
        clearSearch,
        messageSearchResults,
        isSearchingMessages,
        hasMoreMessageResults,
        isLoadingMoreMessages,
        loadMoreMessageResults,
      }}
    >
      {children}
    </ChatsContext.Provider>
  );
}
