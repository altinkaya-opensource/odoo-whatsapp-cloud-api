"use client";

import { useEffect, useMemo, useRef, type TouchEvent } from "react";
import { createPortal } from "react-dom";
import {
  CaretLeftIcon,
  CaretRightIcon,
  ChatCircleTextIcon,
  DownloadSimpleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useTranslations } from "@/app/context/translation-provider";
import { captionOf } from "@/app/lib/whatsapp/shared-content";
import type { Message } from "@/app/lib/whatsapp/types";
import { attachmentDownloadUrl } from "../message/attachment";

type MediaViewerProps = {
  /** Photos and videos, newest first */
  items: Message[];
  index: number;
  senderName: (message: Message) => string;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onShowMessage: (messageId: string) => void;
};

// A horizontal swipe longer than this moves to the next photo on phones
const SWIPE_DISTANCE_PX = 50;

/**
 * One photo or video of the gallery, full screen. Left goes back in time
 * and right forward, as in the chat. Escape is handled by the gallery.
 */
export default function MediaViewer({
  items,
  index,
  senderName,
  onIndexChange,
  onClose,
  onShowMessage,
}: MediaViewerProps) {
  const { t, locale } = useTranslations();
  const touchStartXRef = useRef<number | null>(null);
  const message = items[index];
  const attachment = message.attachment;
  const hasOlder = index < items.length - 1;
  const hasNewer = index > 0;
  const dateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // A focused video seeks with the arrows
      if (event.target instanceof HTMLMediaElement) {
        return;
      }
      if (event.key === "ArrowLeft" && hasOlder) {
        onIndexChange(index + 1);
      } else if (event.key === "ArrowRight" && hasNewer) {
        onIndexChange(index - 1);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [index, hasOlder, hasNewer, onIndexChange]);

  if (!attachment) {
    return null;
  }

  const url = attachmentDownloadUrl(attachment);
  const isVideo = attachment.mimetype.startsWith("video/");
  const caption = captionOf(message);

  const handleTouchStart = (event: TouchEvent) => {
    touchStartXRef.current = event.touches[0]?.clientX ?? null;
  };

  const handleTouchEnd = (event: TouchEvent) => {
    const startX = touchStartXRef.current;
    const endX = event.changedTouches[0]?.clientX;
    touchStartXRef.current = null;
    if (startX === null || endX === undefined) {
      return;
    }
    const distance = endX - startX;
    if (distance > SWIPE_DISTANCE_PX && hasOlder) {
      onIndexChange(index + 1);
    } else if (distance < -SWIPE_DISTANCE_PX && hasNewer) {
      onIndexChange(index - 1);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 flex flex-col bg-[rgb(var(--bg-overlay)/0.92)] backdrop-blur-sm"
      style={{ zIndex: 9999 }}
      role="dialog"
      aria-modal="true"
      aria-label={attachment.name}
    >
      <header className="flex items-center gap-2 p-3 md:p-4">
        <div className="mr-auto min-w-0 rounded-xl bg-[rgb(var(--bg-card)/0.9)] px-3 py-1.5 shadow-sm">
          <p className="truncate text-sm font-semibold text-[rgb(var(--text-primary))]">
            {senderName(message)}
          </p>
          <p className="text-xs text-[rgb(var(--text-secondary))]">
            {dateFormat.format(message.timestamp)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => message.id && onShowMessage(message.id)}
          className="secondary-action flex size-11 shrink-0 items-center justify-center"
          title={t("gallery.showInChat")}
          aria-label={t("gallery.showInChat")}
        >
          <ChatCircleTextIcon className="size-5" weight="bold" />
        </button>
        <a
          href={url}
          download={attachment.name}
          className="secondary-action flex size-11 shrink-0 items-center justify-center"
          title={t("attachment.download")}
          aria-label={t("attachment.download")}
        >
          <DownloadSimpleIcon className="size-5" weight="bold" />
        </a>
        <button
          type="button"
          onClick={onClose}
          className="secondary-action flex size-11 shrink-0 items-center justify-center"
          title={t("attachment.closePreview")}
          aria-label={t("attachment.closePreview")}
          autoFocus
        >
          <XIcon className="size-5" weight="bold" />
        </button>
      </header>

      {/* The blank space around the photo closes the viewer */}
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-3 pb-4 md:px-20 md:pb-8"
        onClick={onClose}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {isVideo ? (
          <video
            key={message.id}
            src={url}
            controls
            autoPlay
            playsInline
            className="max-h-full max-w-full rounded-lg"
            onClick={(event) => event.stopPropagation()}
          >
            {t("attachment.videoUnsupported")}
          </video>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={message.id}
            src={url}
            alt={attachment.name}
            className="max-h-full max-w-full rounded-lg object-contain"
            onClick={(event) => event.stopPropagation()}
          />
        )}
        {hasOlder && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onIndexChange(index + 1);
            }}
            className="secondary-action absolute left-3 top-1/2 hidden size-11 -translate-y-1/2 items-center justify-center md:flex"
            title={t("gallery.previous")}
            aria-label={t("gallery.previous")}
          >
            <CaretLeftIcon className="size-5" weight="bold" />
          </button>
        )}
        {hasNewer && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onIndexChange(index - 1);
            }}
            className="secondary-action absolute right-3 top-1/2 hidden size-11 -translate-y-1/2 items-center justify-center md:flex"
            title={t("gallery.next")}
            aria-label={t("gallery.next")}
          >
            <CaretRightIcon className="size-5" weight="bold" />
          </button>
        )}
      </div>

      {caption && (
        <p className="mx-auto mb-4 max-h-24 max-w-2xl overflow-y-auto whitespace-pre-line rounded-xl bg-[rgb(var(--bg-card)/0.9)] px-4 py-2 text-sm text-[rgb(var(--text-primary))] shadow-sm md:mb-6">
          {caption}
        </p>
      )}
    </div>,
    document.body
  );
}
