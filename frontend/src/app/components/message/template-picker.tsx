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
};

export default function TemplatePicker({
  threadId,
  phoneNumber,
  backendId,
  disabled,
  onSent,
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
    <div className="relative ms-2">
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        disabled={disabled}
        title={t("chatInput.sendTemplate")}
        className="text-[rgb(var(--text-secondary))] hover:text-[rgb(var(--accent-primary))] disabled:opacity-40 disabled:cursor-not-allowed transition-colors p-2 mb-1"
      >
        <ChatTeardropText className="size-5 md:size-5" weight="bold" />
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 bg-[rgb(var(--bg-overlay)/var(--bg-overlay-opacity))] flex items-center justify-center p-4"
          style={{ zIndex: 10000 }}
        >
          <div className="bg-[rgb(var(--bg-primary))] rounded-lg max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-[rgb(var(--border-primary)/var(--border-primary-opacity))]">
              <h3 className="text-[rgb(var(--text-primary))] font-semibold">
                {t("template.title")}
              </h3>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-[rgb(var(--text-secondary))] hover:text-[rgb(var(--text-primary))]"
              >
                <X className="size-6" weight="bold" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
              {error && (
                <div className="bg-[rgb(var(--status-error)/0.2)] border border-[rgb(var(--status-error))] text-[rgb(var(--status-error))] px-4 py-2 rounded">
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
                      className="bg-[rgb(var(--bg-secondary)/var(--bg-secondary-opacity))] rounded-lg p-4 border border-[rgb(var(--border-primary)/var(--border-primary-opacity))]"
                    >
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <p className="text-[rgb(var(--text-primary))] font-semibold truncate">
                            {template.name}
                          </p>
                          {template.language && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-[rgb(var(--bg-input)/var(--bg-input-opacity))] text-[rgb(var(--text-secondary))]">
                              {template.language}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleSend(template)}
                          disabled={sendingId !== null}
                          className="shrink-0 px-4 py-1.5 bg-[rgb(var(--accent-primary))] hover:bg-[rgb(var(--status-success))] text-white rounded-full text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
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

            <div className="flex items-center justify-end gap-3 p-4 border-t border-[rgb(var(--border-primary)/var(--border-primary-opacity))]">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="px-4 py-2 text-[rgb(var(--text-secondary))] hover:text-[rgb(var(--text-primary))] transition"
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
