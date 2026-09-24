import {
  createContext,
  PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  InfiniteData,
  keepPreviousData,
  QueryClient,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useAuth } from "../hooks/use-auth";
import { useRealtime } from "../hooks/use-realtime";
import { apiFetch } from "../lib/api-client";
import { buildPartnerAvatarUrl } from "../lib/odoo/avatar-url";
import {
  isActiveThread,
  notifyIncomingMessage,
  setUnreadBadge,
} from "../lib/notifications";
import { upsertCachedMessages } from "../lib/whatsapp/message-cache";
import {
  compareByRecency,
  mergeChat,
  toChat,
  toMessage,
  type OdooMessageRecord,
  type OdooThreadRecord,
} from "../lib/whatsapp/records";
import type { Chat, MessageSearchResult } from "../lib/whatsapp/types";

export type {
  Attachment,
  AttachmentType,
  Chat,
  Message,
  MessageSearchResult,
} from "../lib/whatsapp/types";

export enum Filters {
  ALL = "all",
  UNREAD = "unread",
}

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
const SEARCH_DEBOUNCE_MS = 300;
// Realtime events carry changes; this only repairs what a lost event missed
const POLL_INTERVAL_MS = 10 * 60 * 1000;

type ThreadPage = { chats: Chat[]; hasMore: boolean };
type ThreadsData = InfiniteData<ThreadPage, number>;
type ThreadsKey = [
  "threads",
  { backendId: number | null; unread: boolean; search: string },
];

/** Apply a thread change to every cached chat list. */
const upsertCachedChat = (queryClient: QueryClient, update: Chat) => {
  const lists = queryClient.getQueriesData<ThreadsData>({
    queryKey: ["threads"],
  });
  for (const [queryKey, data] of lists) {
    if (!data) {
      continue;
    }
    const isKnown = data.pages.some((page) =>
      page.chats.some((chat) => chat.id === update.id)
    );
    // A search keeps its own results; other lists pick up new threads
    const { search } = (queryKey as ThreadsKey)[1];
    if (!isKnown && search) {
      continue;
    }
    queryClient.setQueryData<ThreadsData>(queryKey, {
      ...data,
      pages: data.pages.map((page, index) => {
        if (isKnown) {
          return {
            ...page,
            chats: page.chats.map((chat) =>
              chat.id === update.id ? mergeChat(chat, update) : chat
            ),
          };
        }
        return index === 0
          ? { ...page, chats: [mergeChat(undefined, update), ...page.chats] }
          : page;
      }),
    });
  }
};

/** Change a chat that is already listed, wherever it is cached. */
const patchCachedChat = (
  queryClient: QueryClient,
  chatId: string,
  patch: (chat: Chat) => Chat
) => {
  queryClient.setQueriesData<ThreadsData>({ queryKey: ["threads"] }, (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            chats: page.chats.map((chat) =>
              chat.id === chatId ? patch(chat) : chat
            ),
          })),
        }
      : data
  );
};

const toSearchResult = (
  record: Record<string, unknown>
): MessageSearchResult => ({
  threadId: record.thread_id as number,
  threadName: record.thread_name as string,
  phoneNumber: (record.phone_number as string) ?? null,
  backendId: (record.backend_id as number) ?? null,
  partnerId: (record.partner_id as number) ?? null,
  partnerName: (record.partner_name as string) ?? null,
  messageId: record.message_id as number,
  messageBody: record.message_body as string,
  messageTimestamp: record.message_timestamp as number,
});

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
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState<string>("");
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const search = debouncedSearchQuery.trim();

  const avatarUrl = useCallback(
    (partnerId: number) => buildPartnerAvatarUrl(partnerId),
    []
  );

  const threadsKey: ThreadsKey = [
    "threads",
    {
      backendId: selectedBackendId,
      unread: filter === Filters.UNREAD,
      search,
    },
  ];
  const threadsQuery = useInfiniteQuery({
    queryKey: threadsKey,
    enabled: isAuthenticated,
    initialPageParam: 0,
    placeholderData: keepPreviousData,
    refetchInterval: POLL_INTERVAL_MS,
    queryFn: async ({ pageParam, signal }): Promise<ThreadPage> => {
      const pageSize = search ? CONTACT_SEARCH_PAGE_SIZE : THREADS_PAGE_SIZE;
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String(pageParam),
      });
      if (includeThreadId && pageParam === 0) {
        params.set("includeThreadId", includeThreadId);
      }
      if (search) {
        params.set("search", search);
      }
      // Odoo filters, so a page is a full page of matching threads
      if (selectedBackendId !== null) {
        params.set("backendId", String(selectedBackendId));
      }
      if (filter === Filters.UNREAD) {
        params.set("unread", "1");
      }
      const { threads = [] } = await apiFetch<{
        threads?: OdooThreadRecord[];
      }>(`/api/threads?${params}`, { signal });
      return {
        chats: threads.map((record) => toChat(record, avatarUrl)),
        hasMore: threads.length >= pageSize,
      };
    },
    getNextPageParam: (lastPage, pages) =>
      lastPage.hasMore
        ? pages.length * (search ? CONTACT_SEARCH_PAGE_SIZE : THREADS_PAGE_SIZE)
        : undefined,
  });

  const complete = useMemo(() => {
    const byId = new Map<string, Chat>();
    for (const page of threadsQuery.data?.pages ?? []) {
      for (const chat of page.chats) {
        if (!byId.has(chat.id)) {
          byId.set(chat.id, chat);
        }
      }
    }
    const list = [...byId.values()];
    // Search results keep Odoo's relevance order
    return search ? list : list.sort(compareByRecency);
  }, [threadsQuery.data, search]);

  const filtered = useMemo(
    () =>
      complete.filter((chat) => {
        if (
          selectedBackendId !== null &&
          chat.backendId !== selectedBackendId
        ) {
          return false;
        }
        // Odoo already filtered unread threads; this drops those read since
        return filter !== Filters.UNREAD || !chat.read;
      }),
    [complete, filter, selectedBackendId]
  );

  // Message handlers read the list from a ref so they never re-subscribe
  const completeRef = useRef<Chat[]>([]);
  useEffect(() => {
    completeRef.current = complete;
  }, [complete]);

  const messageSearchQuery = useInfiniteQuery({
    queryKey: ["message-search", search],
    enabled: isAuthenticated && search.length > 0,
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({
        search,
        limit: String(MESSAGE_SEARCH_PAGE_SIZE),
        offset: String(pageParam),
      });
      const { messages = [] } = await apiFetch<{
        messages?: Record<string, unknown>[];
      }>(`/api/messages/search?${params}`, { signal });
      return {
        results: messages.map(toSearchResult),
        hasMore: messages.length >= MESSAGE_SEARCH_PAGE_SIZE,
      };
    },
    getNextPageParam: (lastPage, pages) =>
      lastPage.hasMore ? pages.length * MESSAGE_SEARCH_PAGE_SIZE : undefined,
  });
  const messageSearchResults = useMemo(
    () =>
      search
        ? (messageSearchQuery.data?.pages ?? []).flatMap((page) => page.results)
        : [],
    [messageSearchQuery.data, search]
  );

  // Unread total across every thread, not just the loaded pages
  const unreadQuery = useQuery({
    queryKey: ["unread-count"],
    enabled: isAuthenticated,
    refetchInterval: POLL_INTERVAL_MS,
    queryFn: ({ signal }) =>
      apiFetch<{ unreadCount: number }>("/api/threads/unread-count", {
        signal,
      }).then((data) => data.unreadCount),
  });
  const loadedUnreadCount = complete.reduce(
    (total, chat) => total + (chat.unreadCount ?? 0),
    0
  );
  const totalUnreadCount = unreadQuery.data ?? loadedUnreadCount;

  // The local sum only tells that something changed; Odoo has the number
  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    const timeout = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ["unread-count"] });
    }, 400);
    return () => clearTimeout(timeout);
  }, [isAuthenticated, loadedUnreadCount, queryClient]);

  // Mirror the unread total onto the app icon (installed PWA / dock).
  useEffect(() => {
    setUnreadBadge(totalUnreadCount);
  }, [totalUnreadCount]);

  // New messages: alert, bump the unread count, move the thread up
  const handleMessageArrival = useCallback(
    (records: OdooMessageRecord[], threadId: string) => {
      if (records.length === 0) {
        return;
      }
      const chat = completeRef.current.find((entry) => entry.id === threadId);
      const threadName =
        chat?.partnerName || chat?.threadName || chat?.phoneNumber || null;

      // The only place that alerts about a message: once per message
      let unreadIncrement = 0;
      for (const record of records) {
        if (record.direction !== "incoming") {
          continue;
        }
        const { isNew, interrupted } = notifyIncomingMessage({
          threadId,
          messageId: record.id,
          title: threadName ?? "WhatsApp",
          body: record.body || "New message",
        });
        // The open thread is marked read at once, even in a hidden tab
        if (isNew && interrupted && !isActiveThread(threadId)) {
          unreadIncrement += 1;
        }
      }

      const latest = records[records.length - 1];
      patchCachedChat(queryClient, threadId, (current) => {
        const unreadCount = (current.unreadCount || 0) + unreadIncrement;
        return {
          ...current,
          lastMessagePreview: latest.body || current.lastMessagePreview,
          lastMessageAt: latest.timestamp * 1000,
          unreadCount,
          read: unreadCount === 0,
        };
      });
    },
    [queryClient]
  );

  useRealtime({
    onThread: (record) =>
      upsertCachedChat(queryClient, toChat(record, avatarUrl)),
    onMessage: (event, threadId, record) => {
      // Cached chats stay current even when they are not open
      upsertCachedMessages(queryClient, threadId, [
        toMessage(record, threadId),
      ]);
      if (event === "created") {
        handleMessageArrival([record], threadId);
      }
    },
  });

  const updateFilter = (value: string) => {
    setFilter(value as Filters);
  };

  const updateSearchQuery = useCallback((query: string) => {
    setSearchQuery(query);
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearchQuery(query);
    }, SEARCH_DEBOUNCE_MS);
  }, []);

  const clearSearch = useCallback(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    setSearchQuery("");
    setDebouncedSearchQuery("");
  }, []);

  const updateThreadPreview = useCallback(
    (chatId: string, preview: string, timestamp: number) => {
      patchCachedChat(queryClient, chatId, (chat) => ({
        ...chat,
        lastMessagePreview: preview,
        lastMessageAt: timestamp,
      }));
    },
    [queryClient]
  );

  const markChatAsRead = useCallback(
    (chatId: string) => {
      patchCachedChat(queryClient, chatId, (chat) => ({
        ...chat,
        read: true,
        unreadCount: 0,
      }));
    },
    [queryClient]
  );

  const {
    hasNextPage: hasMoreThreads = false,
    isFetchingNextPage: isLoadingMoreThreads,
    fetchNextPage: fetchNextThreads,
  } = threadsQuery;
  const loadMoreThreads = useCallback(() => {
    if (hasMoreThreads && !isLoadingMoreThreads) {
      void fetchNextThreads();
    }
  }, [hasMoreThreads, isLoadingMoreThreads, fetchNextThreads]);

  const {
    hasNextPage: hasMoreMessageResults = false,
    isFetchingNextPage: isLoadingMoreMessages,
    fetchNextPage: fetchNextMessageResults,
  } = messageSearchQuery;
  const loadMoreMessageResults = useCallback(() => {
    if (hasMoreMessageResults && !isLoadingMoreMessages) {
      void fetchNextMessageResults();
    }
  }, [hasMoreMessageResults, isLoadingMoreMessages, fetchNextMessageResults]);

  const chats = useMemo(
    () => ({ complete, filtered, isLoading: threadsQuery.isPending }),
    [complete, filtered, threadsQuery.isPending]
  );

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
        isSearchingMessages: messageSearchQuery.isLoading,
        hasMoreMessageResults,
        isLoadingMoreMessages,
        loadMoreMessageResults,
      }}
    >
      {children}
    </ChatsContext.Provider>
  );
}
