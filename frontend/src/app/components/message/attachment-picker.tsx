"use client";

import { useState, useRef, ChangeEvent, useCallback, useEffect } from "react";
import { Paperclip, X, File } from "@phosphor-icons/react";
import { useTranslations } from "@/app/context/translation-provider";

type AttachmentPickerProps = {
  onAttachmentSelect: (file: File, caption: string) => void;
  disabled?: boolean;
  externalFile?: File | null;
  onExternalFileProcessed?: () => void;
};

const MAX_FILE_SIZE = 16 * 1024 * 1024; // 16MB limit (WhatsApp limit)

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

export default function AttachmentPicker({
  onAttachmentSelect,
  disabled,
  externalFile,
  onExternalFileProcessed,
}: AttachmentPickerProps) {
  const { t } = useTranslations();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelection = useCallback(
    (file: File) => {
      setError(null);

      // Validate file size
      if (file.size > MAX_FILE_SIZE) {
        setError(
          t("attachment.fileSizeError", {
            size: formatFileSize(MAX_FILE_SIZE),
          })
        );
        return;
      }

      setSelectedFile(file);

      // Create preview for images
      setPreviewUrl((currentPreviewUrl) => {
        if (currentPreviewUrl) {
          URL.revokeObjectURL(currentPreviewUrl);
        }
        return file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : null;
      });
    },
    [t]
  );

  // Handle external file from drag and drop
  useEffect(() => {
    if (externalFile) {
      handleFileSelection(externalFile);
      onExternalFileProcessed?.();
    }
  }, [externalFile, handleFileSelection, onExternalFileProcessed]);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];

    if (!file) {
      return;
    }

    handleFileSelection(file);
  };

  const handleCancel = useCallback(() => {
    setSelectedFile(null);
    setCaption("");
    setError(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [previewUrl]);

  const handleSend = () => {
    if (!selectedFile) {
      return;
    }

    onAttachmentSelect(selectedFile, caption);
    handleCancel();
  };

  const handleButtonClick = () => {
    fileInputRef.current?.click();
  };

  useEffect(() => {
    if (!selectedFile) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleCancel();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [handleCancel, selectedFile]);

  return (
    <div className="relative ms-2">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileChange}
        accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
        disabled={disabled}
      />

      {!selectedFile && error && (
        <p
          className="absolute bottom-full left-0 z-20 mb-2 min-w-52 rounded-lg border border-[rgb(var(--status-error)/0.35)] bg-[rgb(var(--bg-card))] px-3 py-2 text-xs text-[rgb(var(--status-error))] shadow-lg"
          role="alert"
        >
          {error}
        </p>
      )}

      {/* Attachment button */}
      {!selectedFile && (
        <button
          type="button"
          onClick={handleButtonClick}
          disabled={disabled}
          className="icon-action mb-1 size-10 disabled:cursor-not-allowed disabled:opacity-50"
          title={t("attachment.attach")}
          aria-label={t("attachment.attach")}
        >
          <Paperclip className="size-5 md:size-5" weight="bold" />
        </button>
      )}

      {/* Preview modal */}
      {selectedFile && (
        <div
          className="fixed inset-0 flex items-center justify-center bg-[rgb(var(--bg-overlay)/var(--bg-overlay-opacity))] p-4 backdrop-blur-sm"
          style={{ zIndex: 10000 }}
        >
          <div
            className="surface-card flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="attachment-picker-title"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[rgb(var(--border-primary)/var(--border-primary-opacity))] p-4">
              <h3
                id="attachment-picker-title"
                className="font-semibold text-[rgb(var(--text-primary))]"
              >
                {t("attachment.title")}
              </h3>
              <button
                type="button"
                onClick={handleCancel}
                className="icon-action size-9"
                aria-label={t("attachment.cancel")}
              >
                <X className="size-6" weight="bold" />
              </button>
            </div>

            {/* Preview area */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
              {error && (
                <div
                  className="mb-4 rounded-xl border border-[rgb(var(--status-error)/0.35)] bg-[rgb(var(--status-error)/0.1)] px-4 py-3 text-[rgb(var(--status-error))]"
                  role="alert"
                >
                  {error}
                </div>
              )}

              {previewUrl ? (
                <div className="flex justify-center mb-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewUrl}
                    alt={selectedFile.name}
                    className="max-h-96 rounded-xl object-contain"
                  />
                </div>
              ) : (
                <div className="mb-4 flex items-center gap-3 rounded-xl bg-[rgb(var(--bg-secondary))] p-4">
                  <File
                    className="size-12 text-[rgb(var(--text-secondary))]"
                    weight="fill"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[rgb(var(--text-primary))] text-sm truncate">
                      {selectedFile.name}
                    </p>
                    <p className="text-[rgb(var(--text-secondary)/var(--text-secondary-opacity))] text-xs">
                      {formatFileSize(selectedFile.size)}
                    </p>
                  </div>
                </div>
              )}

              {/* Caption input */}
              <div>
                <label className="mb-2 block text-sm font-semibold text-[rgb(var(--text-primary))]">
                  {t("attachment.caption")}
                </label>
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder={t("attachment.captionPlaceholder")}
                  className="control-field w-full resize-none p-3 placeholder-[rgb(var(--text-secondary)/var(--text-quaternary-opacity))]"
                  rows={3}
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 border-t border-[rgb(var(--border-primary)/var(--border-primary-opacity))] p-4">
              <button
                type="button"
                onClick={handleCancel}
                className="secondary-action px-4 py-2 text-sm font-semibold"
              >
                {t("attachment.cancel")}
              </button>
              <button
                type="button"
                onClick={handleSend}
                className="primary-action px-5 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!!error}
              >
                {t("attachment.send")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
