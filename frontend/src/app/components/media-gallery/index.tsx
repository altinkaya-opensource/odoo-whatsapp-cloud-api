"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  ChatCircleTextIcon,
  FileIcon,
  ImageIcon,
  LinkSimpleIcon,
  PlayIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useTranslations } from "@/app/context/translation-provider";
import { useAuth } from "@/app/hooks/use-auth";
import { useRealtime } from "@/app/hooks/use-realtime";
import { useResponsive } from "@/app/hooks/use-responsive";
import { apiFetch } from "@/app/lib/api-client";
import { toMessage, type OdooMessageRecord } from "@/app/lib/whatsapp/records";
import {
  extractLinks,
  groupByMonth,
  isSharedIn,
  SHARED_KINDS,
  SHARED_PAGE_SIZE,
  type SharedKind,
  type SharedLink,
} from "@/app/lib/whatsapp/shared-content";
import type { Attachment, Message } from "@/app/lib/whatsapp/types";
import {
  attachmentDownloadUrl,
  formatFileSize,
  getFileIcon,
} from "../message/attachment";
import MediaViewer from "./media-viewer";

type MediaGalleryProps = {
  threadId: string;
  customerName: string;
  onClose: () => void;
  onShowMessage: (messageId: string) => void;
};

type LinkItem = SharedLink & { key: string; message: Message };

// Start the next page this far before the list or the viewer reaches its end
const PRELOAD_MARGIN_PX = 300;
const PRELOAD_ITEMS = 3;
const EMPTY_ICONS = {
  media: ImageIcon,
  files: FileIcon,
  links: LinkSimpleIcon,
};

const sharedKey = (threadId: string, kind: SharedKind) => [
  "shared",
  threadId,
  kind,
];

const hostnameOf = (url: string) => new URL(url).hostname.replace(/^www\./, "");

/**
 * The photos and videos, files and links of a chat, like WhatsApp's "Media,
 * links and docs". A panel over the conversation; full screen on phones.
 */
export default function MediaGallery({
  threadId,
  customerName,
  onClose,
  onShowMessage,
}: MediaGalleryProps) {
  const { t, locale } = useTranslations();
  const { backendUserId, backendUsersById } = useAuth();
  const { isMobile } = useResponsive();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<SharedKind>("media");
  const [viewerMessageId, setViewerMessageId] = useState<string | null>(null);
  const [isEndVisible, setIsEndVisible] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const query = useInfiniteQuery({
    queryKey: sharedKey(threadId, kind),
    initialPageParam: null as number | null,
    // Each open shows the cached list at once and refreshes it
    staleTime: 0,
    // Failures are shown in the panel
    meta: { quiet: true },
    queryFn: async ({ pageParam, signal }): Promise<Message[]> => {
      const params = new URLSearchParams({ threadId, kind });
      if (pageParam !== null) {
        params.set("beforeId", String(pageParam));
      }
      const { messages = [] } = await apiFetch<{
        messages?: OdooMessageRecord[];
      }>(`/api/messages/shared?${params}`, { signal });
      return messages.map((record) => toMessage(record, threadId));
    },
    getNextPageParam: (lastPage) =>
      lastPage.length >= SHARED_PAGE_SIZE
        ? Number(lastPage[lastPage.length - 1].id)
        : undefined,
  });
  const {
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = query;

  const messages = useMemo(() => query.data?.pages.flat() ?? [], [query.data]);
  const links = useMemo<LinkItem[]>(
    () =>
      kind === "links"
        ? messages.flatMap((message) =>
            extractLinks(message.message).map((link, index) => ({
              ...link,
              key: `${message.id}-${index}`,
              message,
            }))
          )
        : [],
    [kind, messages]
  );
  const viewerIndex = viewerMessageId
    ? messages.findIndex((message) => message.id === viewerMessageId)
    : -1;

  // A message that arrives or gets its attachment while the panel is open
  useRealtime({
    onMessage: (_event, eventThreadId, record) => {
      const isListed = messages.some(
        (message) => message.id === String(record.id)
      );
      if (eventThreadId === threadId && !isListed && isSharedIn(kind, record)) {
        void queryClient.invalidateQueries({
          queryKey: sharedKey(threadId, kind),
        });
      }
    },
  });

  useEffect(() => {
    const end = endRef.current;
    if (!end) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setIsEndVisible(entry.isIntersecting),
      { root: scrollRef.current, rootMargin: `${PRELOAD_MARGIN_PX}px` }
    );
    observer.observe(end);
    return () => observer.disconnect();
  }, []);

  // Also after a page that brought little: the end can still be in view
  const wantsMore =
    isEndVisible ||
    (viewerIndex >= 0 && viewerIndex >= messages.length - PRELOAD_ITEMS);
  useEffect(() => {
    if (
      wantsMore &&
      hasNextPage &&
      !isFetchingNextPage &&
      !isFetchNextPageError
    ) {
      void fetchNextPage();
    }
  }, [
    wantsMore,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (viewerMessageId) {
        setViewerMessageId(null);
      } else {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [viewerMessageId, onClose]);

  const intlLocale = locale === "tr" ? "tr-TR" : "en-US";
  const monthFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(intlLocale, { month: "long", year: "numeric" }),
    [intlLocale]
  );
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium" }),
    [intlLocale]
  );

  const senderName = useCallback(
    (message: Message) => {
      if (!message.isSentFromUser) {
        return customerName;
      }
      const isOwn = !message.userId || message.userId === backendUserId;
      return (
        (!isOwn && backendUsersById[message.userId as number]?.name) ||
        t("common.you")
      );
    },
    [customerName, backendUserId, backendUsersById, t]
  );

  const handleSelectKind = (nextKind: SharedKind) => {
    setKind(nextKind);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  const handleShowMessage = (messageId: string) => {
    setViewerMessageId(null);
    onShowMessage(messageId);
  };

  const handleViewerIndexChange = useCallback(
    (index: number) => setViewerMessageId(messages[index]?.id ?? null),
    [messages]
  );

  const renderMonth = (timestamp: number) => (
    <h3 className="sticky top-0 z-10 bg-[rgb(var(--bg-card)/0.95)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-[rgb(var(--text-secondary))] backdrop-blur-sm">
      {monthFormat.format(timestamp)}
    </h3>
  );

  const renderShowInChat = (message: Message) => (
    <button
      type="button"
      onClick={() => message.id && handleShowMessage(message.id)}
      className="icon-action size-11 shrink-0"
      title={t("gallery.showInChat")}
      aria-label={t("gallery.showInChat")}
    >
      <ChatCircleTextIcon className="size-5" weight="bold" />
    </button>
  );

  const renderMedia = () =>
    groupByMonth(messages, (message) => message.timestamp).map((group) => (
      <section key={group.key}>
        {renderMonth(group.timestamp)}
        <div className="grid grid-cols-3 gap-1 px-3 pb-2">
          {group.items.map((message) => (
            <MediaTile
              key={message.id}
              attachment={message.attachment as Attachment}
              onOpen={() => setViewerMessageId(message.id ?? null)}
            />
          ))}
        </div>
      </section>
    ));

  const renderFiles = () =>
    groupByMonth(messages, (message) => message.timestamp).map((group) => (
      <section key={group.key}>
        {renderMonth(group.timestamp)}
        <ul className="px-2 pb-2">
          {group.items.map((message) => {
            const attachment = message.attachment as Attachment;
            return (
              <li
                key={message.id}
                className="flex items-center gap-1 rounded-xl transition-colors hover:bg-[rgb(var(--bg-secondary))]"
              >
                <a
                  href={attachmentDownloadUrl(attachment)}
                  download={attachment.name}
                  className="flex min-w-0 flex-1 items-center gap-3 px-2 py-2.5"
                  title={t("attachment.downloadFile")}
                >
                  <span className="shrink-0">
                    {getFileIcon(attachment.mimetype)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-[rgb(var(--text-primary))]">
                      {attachment.name}
                    </span>
                    <span className="block truncate text-xs text-[rgb(var(--text-secondary))]">
                      {[
                        formatFileSize(attachment.file_size),
                        dateFormat.format(message.timestamp),
                        senderName(message),
                      ].join(" · ")}
                    </span>
                  </span>
                </a>
                {renderShowInChat(message)}
              </li>
            );
          })}
        </ul>
      </section>
    ));

  const renderLinks = () =>
    groupByMonth(links, (link) => link.message.timestamp).map((group) => (
      <section key={group.key}>
        {renderMonth(group.timestamp)}
        <ul className="px-2 pb-2">
          {group.items.map((link) => (
            <li
              key={link.key}
              className="flex items-center gap-1 rounded-xl transition-colors hover:bg-[rgb(var(--bg-secondary))]"
            >
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-w-0 flex-1 items-center gap-3 px-2 py-2.5"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[rgb(var(--accent-primary)/0.12)] text-[rgb(var(--accent-primary))]">
                  <LinkSimpleIcon className="size-5" weight="bold" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-[rgb(var(--text-primary))]">
                    {link.label ?? hostnameOf(link.url)}
                  </span>
                  <span className="block truncate text-xs text-[rgb(var(--accent-primary))]">
                    {link.url}
                  </span>
                  <span className="block truncate text-xs text-[rgb(var(--text-secondary))]">
                    {`${dateFormat.format(link.message.timestamp)} · ${senderName(link.message)}`}
                  </span>
                </span>
              </a>
              {renderShowInChat(link.message)}
            </li>
          ))}
        </ul>
      </section>
    ));

  const renderLoading = () =>
    kind === "media" ? (
      <div className="grid grid-cols-3 gap-1 px-3 pt-2" aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => (
          <div
            key={index}
            className="aspect-square animate-pulse rounded-lg bg-[rgb(var(--bg-secondary))]"
          />
        ))}
      </div>
    ) : (
      <div className="flex flex-col gap-2 px-4 pt-2" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            className="h-14 animate-pulse rounded-xl bg-[rgb(var(--bg-secondary))]"
          />
        ))}
      </div>
    );

  const renderMessage = (text: string, action?: () => void) => (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <p className="max-w-[28ch] text-sm leading-6 text-[rgb(var(--text-secondary))]">
        {text}
      </p>
      {action && (
        <button
          type="button"
          onClick={action}
          className="secondary-action px-4 py-2.5 text-sm font-semibold"
        >
          {t("gallery.retry")}
        </button>
      )}
    </div>
  );

  const renderContent = () => {
    if (query.isPending) {
      return (
        <>
          <span className="sr-only">{t("chat.loading")}</span>
          {renderLoading()}
        </>
      );
    }
    if (query.isError) {
      return renderMessage(t("gallery.loadError"), () => void query.refetch());
    }
    const isEmpty = kind === "links" ? links.length === 0 : !messages.length;
    if (isEmpty && !hasNextPage) {
      const EmptyIcon = EMPTY_ICONS[kind];
      return (
        <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-[rgb(var(--accent-primary)/0.12)] text-[rgb(var(--accent-primary))]">
            <EmptyIcon className="size-6" weight="bold" />
          </span>
          <p className="max-w-[28ch] text-sm leading-6 text-[rgb(var(--text-secondary))]">
            {t(`gallery.empty.${kind}`)}
          </p>
        </div>
      );
    }
    return kind === "media"
      ? renderMedia()
      : kind === "files"
        ? renderFiles()
        : renderLinks();
  };

  return (
    <aside
      className="absolute inset-0 z-30 flex flex-col bg-[rgb(var(--bg-card))] md:left-auto md:w-[400px] md:max-w-full md:border-l md:border-[rgb(var(--border-primary)/var(--border-primary-opacity))] md:shadow-[-16px_0_34px_rgb(var(--bg-overlay)/0.12)]"
      aria-labelledby="media-gallery-title"
    >
      <header className="flex items-center gap-2 px-3 py-3">
        <button
          type="button"
          onClick={onClose}
          className="icon-action size-10 shrink-0"
          aria-label={t("gallery.close")}
          title={t("gallery.close")}
        >
          {isMobile ? (
            <ArrowLeftIcon className="size-5" weight="bold" />
          ) : (
            <XIcon className="size-5" weight="bold" />
          )}
        </button>
        <h2
          id="media-gallery-title"
          className="truncate text-sm font-semibold text-[rgb(var(--text-primary))]"
        >
          {t("gallery.title")}
        </h2>
      </header>

      <div
        role="tablist"
        aria-label={t("gallery.title")}
        className="mx-3 mb-3 flex items-center gap-1 rounded-xl border border-[rgb(var(--border-primary)/var(--border-primary-opacity))] bg-[rgb(var(--bg-secondary))] p-1"
      >
        {SHARED_KINDS.map((tabKind) => (
          <button
            key={tabKind}
            type="button"
            role="tab"
            id={`media-gallery-tab-${tabKind}`}
            aria-selected={tabKind === kind}
            aria-controls="media-gallery-panel"
            onClick={() => handleSelectKind(tabKind)}
            className={`min-h-10 flex-1 rounded-lg px-3 text-sm font-semibold transition-colors ${
              tabKind === kind
                ? "bg-[rgb(var(--bg-card))] text-[rgb(var(--accent-primary))] shadow-sm"
                : "text-[rgb(var(--text-secondary))] hover:text-[rgb(var(--text-primary))]"
            }`}
          >
            {t(`gallery.tabs.${tabKind}`)}
          </button>
        ))}
      </div>

      <div
        ref={scrollRef}
        id="media-gallery-panel"
        role="tabpanel"
        aria-labelledby={`media-gallery-tab-${kind}`}
        className="custom-scrollbar safe-area-bottom min-h-0 flex-1 overflow-y-auto border-t border-[rgb(var(--border-primary)/var(--border-primary-opacity))]"
      >
        {renderContent()}
        {isFetchingNextPage && (
          <p className="py-3 text-center text-xs text-[rgb(var(--text-secondary))]">
            {t("chat.loading")}
          </p>
        )}
        {isFetchNextPageError &&
          renderMessage(t("gallery.loadError"), () => void fetchNextPage())}
        <div ref={endRef} className="h-px" />
      </div>

      {kind === "media" && viewerIndex >= 0 && (
        <MediaViewer
          items={messages}
          index={viewerIndex}
          senderName={senderName}
          onIndexChange={handleViewerIndexChange}
          onClose={() => setViewerMessageId(null)}
          onShowMessage={handleShowMessage}
        />
      )}
    </aside>
  );
}

type MediaTileProps = {
  attachment: Attachment;
  onOpen: () => void;
};

const MediaTile = ({ attachment, onOpen }: MediaTileProps) => {
  const [hasError, setHasError] = useState(false);
  const url = attachmentDownloadUrl(attachment);
  const isVideo = attachment.mimetype.startsWith("video/");

  const renderPreview = () => {
    if (hasError) {
      return (
        <ImageIcon className="size-8 text-[rgb(var(--text-secondary)/var(--text-tertiary-opacity))]" />
      );
    }
    if (isVideo) {
      return (
        <video
          // The first frame, which Safari shows only with a start time
          src={`${url}#t=0.1`}
          preload="metadata"
          muted
          playsInline
          className="pointer-events-none size-full object-cover"
          onError={() => setHasError(true)}
        />
      );
    }
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        className="size-full object-cover transition-transform duration-200 group-hover:scale-105"
        onError={() => setHasError(true)}
      />
    );
  };

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-[rgb(var(--bg-secondary))] outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent-primary))]"
      aria-label={attachment.name}
      title={attachment.name}
    >
      {renderPreview()}
      {isVideo && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-9 items-center justify-center rounded-full bg-[rgb(var(--bg-card)/0.85)] text-[rgb(var(--text-primary))] shadow-sm">
            <PlayIcon className="size-4" weight="fill" />
          </span>
        </span>
      )}
    </button>
  );
};
