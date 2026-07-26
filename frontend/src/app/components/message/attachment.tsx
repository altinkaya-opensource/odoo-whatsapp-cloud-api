"use client";

import { Attachment, AttachmentType } from "@/app/context/chats-provider";
import {
  DownloadSimple,
  File,
  FileAudio,
  FileDoc,
  FilePdf,
  FileVideo,
  Image as ImageIcon,
} from "@phosphor-icons/react";
import { useAuth } from "@/app/hooks/use-auth";
import { useTranslations } from "@/app/context/translation-provider";
import { useEffect, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";

type AttachmentDisplayProps = {
  attachment: Attachment;
  messageId?: string;
};

const getAttachmentType = (mimetype: string): AttachmentType => {
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("video/")) return "video";
  if (mimetype.startsWith("audio/")) return "audio";
  return "document";
};

const getFileIcon = (mimetype: string) => {
  if (mimetype === "application/pdf") {
    return (
      <FilePdf
        className="size-8 text-[rgb(var(--status-error))]"
        weight="fill"
      />
    );
  }
  if (mimetype.startsWith("audio/")) {
    return (
      <FileAudio
        className="size-8 text-[rgb(var(--status-info))]"
        weight="fill"
      />
    );
  }
  if (mimetype.startsWith("video/")) {
    return (
      <FileVideo
        className="size-8 text-[rgb(var(--status-info))]"
        weight="fill"
      />
    );
  }
  if (mimetype.includes("word") || mimetype.includes("document")) {
    return (
      <FileDoc
        className="size-8 text-[rgb(var(--status-info))]"
        weight="fill"
      />
    );
  }
  if (mimetype.startsWith("image/")) {
    return (
      <ImageIcon
        className="size-8 text-[rgb(var(--status-success))]"
        weight="fill"
      />
    );
  }
  return (
    <File className="size-8 text-[rgb(var(--text-secondary))]" weight="fill" />
  );
};

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const sizes = ["B", "KB", "MB", "GB"];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${parseFloat((bytes / 1024 ** index).toFixed(1))} ${sizes[index]}`;
};

export default function AttachmentDisplay({
  attachment,
}: AttachmentDisplayProps) {
  const { sessionId } = useAuth();
  const { t } = useTranslations();
  const [isImageLoaded, setIsImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const attachmentType =
    attachment.type ?? getAttachmentType(attachment.mimetype);
  const downloadUrl = `/api/attachments/download?url=${encodeURIComponent(attachment.url)}&session_id=${sessionId}`;

  useEffect(() => {
    setPortalRoot(document.body);
  }, []);

  useEffect(() => {
    if (!isLightboxOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsLightboxOpen(false);
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isLightboxOpen]);

  const handleDownload = async (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    try {
      const response = await fetch(downloadUrl, {
        method: "GET",
        headers: { "x-session-id": sessionId || "" },
      });

      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = attachment.name;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      window.setTimeout(() => {
        window.URL.revokeObjectURL(url);
        document.body.removeChild(link);
      }, 100);
    } catch (error) {
      console.error("Attachment download failed:", error);
      alert(t("attachment.downloadError", { name: attachment.name }));
    }
  };

  if (attachmentType === "image") {
    return (
      <>
        <div className="group relative max-w-sm overflow-hidden rounded-2xl">
          {!isImageLoaded && !imageError && (
            <div className="flex h-48 w-full items-center justify-center rounded-2xl bg-[rgb(var(--bg-secondary))] animate-pulse">
              <ImageIcon className="size-12 text-[rgb(var(--text-secondary)/var(--text-tertiary-opacity))]" />
            </div>
          )}
          {imageError && (
            <div className="flex h-48 w-full flex-col items-center justify-center gap-2 rounded-2xl bg-[rgb(var(--bg-secondary))]">
              <ImageIcon className="size-12 text-[rgb(var(--text-secondary)/var(--text-tertiary-opacity))]" />
              <p className="text-xs text-[rgb(var(--text-secondary))]">
                {t("attachment.imageLoadError")}
              </p>
              <button
                onClick={handleDownload}
                className="flex items-center gap-1 text-xs font-semibold text-[rgb(var(--accent-primary))] hover:text-[rgb(var(--accent-active))]"
                type="button"
              >
                <DownloadSimple className="size-4" />
                {t("attachment.download")}
              </button>
            </div>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={downloadUrl}
            alt={attachment.name}
            className={`max-h-96 rounded-2xl object-contain ${!isImageLoaded ? "hidden" : "block"}`}
            onLoad={() => setIsImageLoaded(true)}
            onError={() => setImageError(true)}
          />
          {isImageLoaded && (
            <>
              <button
                type="button"
                onClick={() => setIsLightboxOpen(true)}
                className="absolute inset-0 z-10 cursor-zoom-in"
                aria-label={attachment.name}
              />
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-[rgb(var(--bg-primary)/0)] transition-colors group-hover:bg-[rgb(var(--bg-primary)/0.2)]">
                <button
                  onClick={handleDownload}
                  className="pointer-events-auto z-20 rounded-xl bg-[rgb(var(--bg-card)/0.9)] p-2 text-[rgb(var(--text-primary))] opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  type="button"
                  title={t("attachment.download")}
                  aria-label={t("attachment.download")}
                >
                  <DownloadSimple className="size-5" weight="bold" />
                </button>
              </div>
            </>
          )}
        </div>

        {isLightboxOpen &&
          portalRoot &&
          createPortal(
            <div
              className="fixed inset-0 flex items-center justify-center bg-[rgb(var(--bg-overlay)/0.92)] p-4 backdrop-blur-sm"
              style={{ zIndex: 9999 }}
              onClick={() => setIsLightboxOpen(false)}
            >
              <div
                className="relative flex size-full items-center justify-center"
                role="dialog"
                aria-modal="true"
                aria-label={attachment.name}
                onClick={(event) => event.stopPropagation()}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={downloadUrl}
                  alt={attachment.name}
                  className="max-h-full max-w-full object-contain"
                />
                <button
                  onClick={() => setIsLightboxOpen(false)}
                  className="secondary-action absolute right-4 top-4 px-4 py-2 text-sm font-semibold"
                  type="button"
                >
                  {t("attachment.closePreview")}
                </button>
                <button
                  onClick={handleDownload}
                  className="primary-action absolute bottom-4 right-4 flex items-center gap-2 px-4 py-2 text-sm font-semibold"
                  type="button"
                >
                  <DownloadSimple className="size-5" weight="bold" />
                  {t("attachment.download")}
                </button>
              </div>
            </div>,
            portalRoot
          )}
      </>
    );
  }

  if (attachmentType === "video") {
    return (
      <div className="relative max-w-sm overflow-hidden rounded-2xl">
        <video
          controls
          className="max-h-96 w-full rounded-2xl bg-[rgb(var(--bg-primary))]"
          preload="metadata"
        >
          <source src={downloadUrl} type={attachment.mimetype} />
          {t("attachment.videoUnsupported")}
        </video>
        <button
          onClick={handleDownload}
          className="icon-action absolute right-2 top-2 z-10 size-9 bg-[rgb(var(--bg-card)/0.9)] shadow-sm"
          title={t("attachment.downloadVideo")}
          aria-label={t("attachment.downloadVideo")}
          type="button"
        >
          <DownloadSimple className="size-4" weight="bold" />
        </button>
      </div>
    );
  }

  if (attachmentType === "audio") {
    return (
      <div className="max-w-sm rounded-xl border border-[rgb(var(--border-primary)/var(--border-primary-opacity))] bg-[rgb(var(--bg-secondary))] p-4">
        <div className="mb-3 flex items-center gap-3">
          <FileAudio
            className="size-8 text-[rgb(var(--status-info))]"
            weight="fill"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-[rgb(var(--text-primary))]">
              {attachment.name}
            </p>
            <p className="text-xs text-[rgb(var(--text-secondary))]">
              {formatFileSize(attachment.file_size)}
            </p>
          </div>
        </div>
        <audio controls className="w-full">
          <source src={downloadUrl} type={attachment.mimetype} />
          {t("attachment.audioUnsupported")}
        </audio>
      </div>
    );
  }

  return (
    <div className="max-w-sm rounded-xl border border-[rgb(var(--border-primary)/var(--border-primary-opacity))] bg-[rgb(var(--bg-secondary))] p-4 transition-colors hover:bg-[rgb(var(--bg-tertiary))]">
      <div className="flex items-center gap-3">
        {getFileIcon(attachment.mimetype)}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-[rgb(var(--text-primary))]">
            {attachment.name}
          </p>
          <p className="text-xs text-[rgb(var(--text-secondary))]">
            {formatFileSize(attachment.file_size)}
          </p>
        </div>
        <button
          onClick={handleDownload}
          className="icon-action size-9 text-[rgb(var(--accent-primary))]"
          title={t("attachment.downloadFile")}
          aria-label={t("attachment.downloadFile")}
          type="button"
        >
          <DownloadSimple className="size-5" weight="bold" />
        </button>
      </div>
    </div>
  );
}
