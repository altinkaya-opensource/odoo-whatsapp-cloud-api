"use client";

import { useCallback, useEffect, useState } from "react";
import { ChatTeardropText, X } from "@phosphor-icons/react";
import { useTranslations } from "@/app/context/translation-provider";
import { useAuth } from "@/app/hooks/use-auth";

export type SimpleTemplate = {
  id: number;
  name: string;
  language: string;
  category: string;
  header_text: string;
  body_text: string;
  footer_text: string;
  preview: string;
};

type TemplatePickerProps = {
  threadId: number;
  phoneNumber: string;
  backendId: number | null;
  disabled?: boolean;
  onSent?: () => void;
  triggerVariant?: "icon" | "cta";
};

export default function TemplatePicker({
  threadId,
  phoneNumber,
  backendId,
  disabled,
  onSent,
  triggerVariant = "icon",
}: TemplatePickerProps) {
  const { t } = useTranslations();
  const { sessionId } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [templates, setTemplates] = useState<SimpleTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<number | null>(null);

  const fetchTemplates = useCallback(async () => {
    if (!sessionId) {
      setError(t("template.error"));
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const query =
        typeof backendId === "number" ? `?backendId=${backendId}` : "";
      const response = await fetch(`/api/templates${query}`, {
        method: "GET",
        headers: { "x-session-id": sessionId },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          typeof data?.error === "string" ? data.error : t("template.error");
        throw new Error(message);
      }
      setTemplates(Array.isArray(data?.templates) ? data.templates : []);
    } catch (err) {
      const e = err as Error;
      setError(e.message || t("template.error"));
    } finally {
      setIsLoading(false);
    }
  }, [backendId, sessionId, t]);

  useEffect(() => {
    if (isOpen) {
      fetchTemplates();
    }
  }, [isOpen, fetchTemplates]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen]);

  const handleSend = async (template: SimpleTemplate) => {
    if (!sessionId) {
      setError(t("template.error"));
      return;
    }
    setSendingId(template.id);
    setError(null);
    try {
      const response = await fetch("/api/messages/send-template", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-session-id": sessionId,
        },
        body: JSON.stringify({
          threadId,
          phoneNumber,
          templateId: template.id,
          backendId: backendId ?? undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          typeof data?.error === "string" ? data.error : t("template.error");
        throw new Error(message);
      }
      setIsOpen(false);
      onSent?.();
    } catch (err) {
      const e = err as Error;
      setError(e.message || t("template.error"));
    } finally {
      setSendingId(null);
    }
  };

  return (
    <div className={triggerVariant === "cta" ? "shrink-0" : "relative ms-2"}>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        disabled={disabled}
        title={t("chatInput.sendTemplate")}
        aria-label={t("chatInput.sendTemplate")}
        className={
          triggerVariant === "cta"
            ? "primary-action flex items-center gap-2 px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            : "icon-action mb-1 size-10 disabled:cursor-not-allowed disabled:opacity-40"
        }
      >
        <ChatTeardropText className="size-5 md:size-5" weight="bold" />
        {triggerVariant === "cta" && <span>{t("chatInput.sendTemplate")}</span>}
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 flex items-center justify-center bg-[rgb(var(--bg-overlay)/var(--bg-overlay-opacity))] p-4 backdrop-blur-sm"
          style={{ zIndex: 10000 }}
        >
          <div
            className="surface-card flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="template-picker-title"
          >
            <div className="flex items-center justify-between border-b border-[rgb(var(--border-primary)/var(--border-primary-opacity))] p-4">
              <h3
                id="template-picker-title"
                className="text-[rgb(var(--text-primary))] font-semibold"
              >
                {t("template.title")}
              </h3>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="icon-action size-9"
                aria-label={t("template.cancel")}
              >
                <X className="size-6" weight="bold" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
              {error && (
                <div
                  className="rounded-xl border border-[rgb(var(--status-error)/0.35)] bg-[rgb(var(--status-error)/0.1)] px-4 py-3 text-[rgb(var(--status-error))]"
                  role="alert"
                >
                  {error}
                </div>
              )}

              {isLoading && (
                <p className="text-[rgb(var(--text-secondary))] text-sm text-center py-8">
                  {t("template.loading")}
                </p>
              )}

              {!isLoading && templates.length === 0 && !error && (
                <p className="text-[rgb(var(--text-secondary))] text-sm text-center py-8">
                  {t("template.empty")}
                </p>
              )}

              {!isLoading &&
                templates.map((template) => {
                  const isSending = sendingId === template.id;
                  return (
                    <div
                      key={template.id}
                      className="rounded-xl border border-[rgb(var(--border-primary)/var(--border-primary-opacity))] bg-[rgb(var(--bg-secondary))] p-4"
                    >
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <p className="text-[rgb(var(--text-primary))] font-semibold truncate">
                            {template.name}
                          </p>
                          {template.language && (
                            <span className="rounded-md bg-[rgb(var(--bg-card))] px-2 py-1 text-xs text-[rgb(var(--text-secondary))]">
                              {template.language}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleSend(template)}
                          disabled={sendingId !== null}
                          className="primary-action shrink-0 px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isSending
                            ? t("chatInput.sending")
                            : t("template.send")}
                        </button>
                      </div>
                      <p className="text-[rgb(var(--text-secondary)/var(--text-secondary-opacity))] text-sm whitespace-pre-wrap">
                        {template.preview}
                      </p>
                    </div>
                  );
                })}
            </div>

            <div className="flex items-center justify-end border-t border-[rgb(var(--border-primary)/var(--border-primary-opacity))] p-4">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="secondary-action px-4 py-2 text-sm font-semibold"
              >
                {t("template.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
