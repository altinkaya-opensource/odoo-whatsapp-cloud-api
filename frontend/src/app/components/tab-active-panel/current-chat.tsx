import dayjs from "dayjs";
import {
  FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Message } from "@/app/context/chats-provider";
import { useCurrentChat } from "@/app/hooks/use-current-chat";
import ContactHeader from "./contact-header";
import MessageRow from "./message-row";
import AttachmentPicker from "../message/attachment-picker";
import TemplatePicker from "../message/template-picker";
import DragDropZone from "../message/drag-drop-zone";
import SuggestionChips from "../message/suggestion-chips";
import { useTranslations } from "@/app/context/translation-provider";
import { useContacts } from "@/app/hooks/use-contacts";
import { useAuth } from "@/app/hooks/use-auth";
import { useAppConfig } from "@/app/hooks/use-app-config";
import {
  ChatCircleDotsIcon,
  XCircleIcon,
  Sparkle,
  TranslateIcon,
} from "@phosphor-icons/react";

// Placeholder bubbles while a chat that is not cached yet loads
const LOADING_BUBBLE_WIDTHS = ["55%", "40%", "65%", "35%"];

export default function CurrentChat() {
  const {
    chatId,
    messages,
    isLoading,
    isPaginationLoading,
    hasMoreMessages,
    sendMessage,
    sendAttachment,
    sendReaction,
    isSending,
    replyTo,
    cancelReply,
    startReply,
    loadPreviousMessages,
    targetMessageId,
    phoneNumber,
    backendId,
    partnerName,
    threadName,
    group,
  } = useCurrentChat();
  const [messageText, setMessageText] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [droppedFile, setDroppedFile] = useState<File | null>(null);
  const [isAiImproving, setIsAiImproving] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isTypingAnimation, setIsTypingAnimation] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);
  const lastProcessedIncomingIdRef = useRef<string | null>(null);
  const suggestionsAbortControllerRef = useRef<AbortController | null>(null);
  // Message translation state
  const [translations, setTranslations] = useState<
    Map<string, { original: string; translated: string }>
  >(new Map());
  const translationsRef = useRef(translations);
  useEffect(() => {
    translationsRef.current = translations;
  }, [translations]);
  const [translatingMessageId, setTranslatingMessageId] = useState<
    string | null
  >(null);
  const { t, locale } = useTranslations();
  const { suggestionsEnabled } = useAppConfig();
  const { contacts } = useContacts();
  const { sessionId } = useAuth();

  useEffect(() => {
    // Abort any ongoing suggestion requests when switching threads
    if (suggestionsAbortControllerRef.current) {
      suggestionsAbortControllerRef.current.abort();
      suggestionsAbortControllerRef.current = null;
    }
    setMessageText("");
    setSendError(null);
    setSuggestions([]);
    setIsSuggestionsLoading(false);
    lastProcessedIncomingIdRef.current = null;
    // Clear message translations when switching threads
    setTranslations(new Map());
    setTranslatingMessageId(null);
  }, [chatId]);

  // Check if the 24-hour customer service window has expired
  const isServiceWindowExpired = useMemo(() => {
    if (isLoading || messages.length === 0) return false;
    const lastIncoming = [...messages].reverse().find((m) => !m.isSentFromUser);
    if (!lastIncoming) return false;
    const twentyFourHours = 24 * 60 * 60 * 1000;
    return Date.now() - lastIncoming.timestamp > twentyFourHours;
  }, [messages, isLoading]);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // The list is a column-reverse scroller: scrollTop 0 is the bottom and the
  // browser keeps it there while messages, images or the composer change
  // size. A newly opened chat starts at the bottom, before it is painted.
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (container && !targetMessageId) {
      container.scrollTop = 0;
    }
  }, [chatId, targetMessageId]);

  // Load older messages near the top (scrollTop is negative going up)
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    let isThrottled = false;
    const handleScroll = () => {
      if (isThrottled) return;
      const distanceFromTop =
        container.scrollHeight - container.clientHeight + container.scrollTop;
      if (
        distanceFromTop <= 100 &&
        hasMoreMessages &&
        !isPaginationLoading &&
        !isLoading
      ) {
        isThrottled = true;
        loadPreviousMessages().finally(() => {
          setTimeout(() => {
            isThrottled = false;
          }, 500);
        });
      }
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, [hasMoreMessages, isPaginationLoading, isLoading, loadPreviousMessages]);

  // Scroll to target message from search results
  useEffect(() => {
    if (!targetMessageId || isLoading || messages.length === 0) return;

    const targetId = String(targetMessageId);
    const el = document.getElementById(`msg-${targetId}`);
    if (!el) return;

    requestAnimationFrame(() => {
      el.scrollIntoView({ block: "center", behavior: "instant" });

      // Flash highlight
      el.style.transition = "background-color 0.5s ease-in-out";
      el.style.backgroundColor = "rgba(255, 213, 79, 0.3)";
      el.style.borderRadius = "12px";
      setTimeout(() => {
        el.style.backgroundColor = "transparent";
        setTimeout(() => {
          el.style.transition = "";
          el.style.backgroundColor = "";
          el.style.borderRadius = "";
        }, 500);
      }, 1500);
    });
  }, [targetMessageId, isLoading, messages.length]);

  // Auto-resize textarea based on content
  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  };

  // Adjust height when messageText changes
  useEffect(() => {
    adjustTextareaHeight();
  }, [messageText]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = messageText.trim();
    if (trimmed.length === 0) {
      return;
    }

    try {
      const sending = sendMessage(trimmed);
      // Show the message being sent even if the user had scrolled up
      scrollContainerRef.current?.scrollTo({ top: 0 });
      await sending;
      setMessageText("");
      setSendError(null);
      // Refocus the textarea after sending
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 0);
    } catch (error) {
      const err = error as Error;
      setSendError(err.message || t("chatInput.sendError"));
    }
  };

  const handleAttachmentSelect = async (file: File, caption: string) => {
    setSendError(null);
    try {
      await sendAttachment(file, caption);
    } catch (error) {
      const err = error as Error;
      setSendError(err.message || t("chatInput.attachmentError"));
    }
  };

  const handleFilesDrop = (files: File[]) => {
    // For now, handle only the first file
    // Could be extended to handle multiple files
    if (files.length > 0 && !isSending) {
      setDroppedFile(files[0]);
    }
  };

  const handleDroppedFileProcessed = () => {
    setDroppedFile(null);
  };

  const handleAiImprove = async () => {
    setIsAiImproving(true);
    setIsTypingAnimation(true);
    setSendError(null);
    setMessageText("");

    try {
      const response = await fetch("/api/ai/improve-text", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-session-id": sessionId ?? "",
        },
        body: JSON.stringify({
          messages: messages.slice(-10), // Last 10 messages
          currentText: messageText.trim(),
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to improve text");
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Response body is not readable");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let accumulatedText = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Append new chunk to buffer
          buffer += decoder.decode(value, { stream: true });

          // Process complete lines from buffer
          while (true) {
            const lineEnd = buffer.indexOf("\n");
            if (lineEnd === -1) break;

            const line = buffer.slice(0, lineEnd).trim();
            buffer = buffer.slice(lineEnd + 1);

            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") break;

              try {
                const parsed = JSON.parse(data);
                const content = parsed.content;
                if (content) {
                  accumulatedText += content;
                  setMessageText(accumulatedText);
                }
              } catch {
                // Ignore invalid JSON
              }
            }
          }
        }
      } finally {
        reader.cancel();
      }
    } catch (error) {
      const err = error as Error;
      setSendError(err.message || t("chatInput.aiImproveError"));
    } finally {
      setIsAiImproving(false);
      setIsTypingAnimation(false);
    }
  };

  const handleTranslate = async () => {
    if (!messageText.trim()) {
      return;
    }

    setIsTranslating(true);
    setIsTypingAnimation(true);
    setSendError(null);
    const originalText = messageText;
    setMessageText("");

    try {
      const response = await fetch("/api/ai/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-session-id": sessionId ?? "",
        },
        body: JSON.stringify({
          messages: messages.slice(-10), // Last 10 messages
          currentText: originalText,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to translate text");
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Response body is not readable");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let accumulatedText = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Append new chunk to buffer
          buffer += decoder.decode(value, { stream: true });

          // Process complete lines from buffer
          while (true) {
            const lineEnd = buffer.indexOf("\n");
            if (lineEnd === -1) break;

            const line = buffer.slice(0, lineEnd).trim();
            buffer = buffer.slice(lineEnd + 1);

            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") break;

              try {
                const parsed = JSON.parse(data);
                const content = parsed.content;
                if (content) {
                  accumulatedText += content;
                  setMessageText(accumulatedText);
                }
              } catch {
                // Ignore invalid JSON
              }
            }
          }
        }
      } finally {
        reader.cancel();
      }
    } catch (error) {
      const err = error as Error;
      setSendError(err.message || t("chatInput.translateError"));
      setMessageText(originalText); // Restore original text on error
    } finally {
      setIsTranslating(false);
      setIsTypingAnimation(false);
    }
  };

  // Handle message translation (translate individual messages in chat)
  const handleTranslateMessage = useCallback(
    async (message: Message) => {
      if (!message.id || !message.message) return;

      // If already translated, toggle back to original (revert)
      if (translationsRef.current.has(message.id)) {
        setTranslations((prev) => {
          const newMap = new Map(prev);
          newMap.delete(message.id!);
          return newMap;
        });
        return;
      }

      setTranslatingMessageId(message.id);

      try {
        const response = await fetch("/api/ai/translate-message", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-session-id": sessionId ?? "",
          },
          body: JSON.stringify({
            text: message.message,
            targetLanguage: locale,
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to translate message");
        }

        const data = await response.json();

        setTranslations((prev) =>
          new Map(prev).set(message.id!, {
            original: message.message,
            translated: data.translatedText,
          })
        );
      } catch (error) {
        console.error("Message translation error:", error);
        // Optionally show error toast here
      } finally {
        setTranslatingMessageId(null);
      }
    },
    [locale, sessionId]
  );

  // Generate suggestions with server-side caching
  const generateSuggestions = useCallback(
    async (forceRefresh = false) => {
      if (!suggestionsEnabled || messages.length === 0 || !chatId) {
        return;
      }

      // Find the latest incoming message ID for cache key
      const latestIncoming = [...messages]
        .reverse()
        .find((m) => !m.isSentFromUser);

      const lastMessageId = latestIncoming?.id;
      if (!lastMessageId) {
        return;
      }

      // Abort any previous ongoing request
      if (suggestionsAbortControllerRef.current) {
        suggestionsAbortControllerRef.current.abort();
      }

      // Create new AbortController for this request
      const abortController = new AbortController();
      suggestionsAbortControllerRef.current = abortController;

      setIsSuggestionsLoading(true);

      // If not forcing refresh, try to get from cache first
      if (!forceRefresh) {
        try {
          const cacheResponse = await fetch(
            `/api/ai/rag-suggestions?threadId=${chatId}&lastMessageId=${lastMessageId}`,
            {
              signal: abortController.signal,
              headers: { "x-session-id": sessionId ?? "" },
            }
          );

          if (cacheResponse.ok) {
            const cacheData = await cacheResponse.json();
            if (cacheData.cached && cacheData.suggestions?.length > 0) {
              setSuggestions(cacheData.suggestions);
              setIsSuggestionsLoading(false);
              return; // Cache hit, done!
            }
          }
        } catch (error) {
          // If aborted, stop processing
          if (error instanceof Error && error.name === "AbortError") {
            return;
          }
          // Cache check failed, proceed with generation
        }
      }

      // Cache miss or force refresh - generate new suggestions
      setSuggestions([]);

      const currentContact = contacts.find((c) => c.id === chatId);
      const contactName = currentContact?.displayName || "Customer";

      try {
        const response = await fetch("/api/ai/rag-suggestions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-session-id": sessionId ?? "",
          },
          body: JSON.stringify({
            threadId: chatId,
            lastMessageId,
            messages: messages.slice(-10),
            contactName,
            userName: "Support Agent",
            forceRefresh,
          }),
          signal: abortController.signal,
        });

        if (response.ok) {
          const data = await response.json();
          setSuggestions(data.suggestions || []);
        }
      } catch (error) {
        // If aborted, don't update state (thread switched)
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        setSuggestions([]);
      } finally {
        // Only update loading state if this request wasn't aborted
        if (!abortController.signal.aborted) {
          setIsSuggestionsLoading(false);
        }
      }
    },
    [messages, contacts, chatId, sessionId, suggestionsEnabled]
  );

  // Handle suggestion selection - populate textarea
  const handleSuggestionSelect = (suggestion: string) => {
    setMessageText(suggestion);
    textareaRef.current?.focus();
  };

  // Handle refresh button - force regenerate suggestions
  const handleRefreshSuggestions = useCallback(() => {
    generateSuggestions(true); // Force refresh
  }, [generateSuggestions]);

  // Detect new incoming messages and generate suggestions
  useEffect(() => {
    if (messages.length === 0) {
      return;
    }

    // Get the last message in the conversation
    const lastMessage = messages[messages.length - 1];

    // Skip if the last message is from us (agent), not the customer
    // No need to generate suggestions if we already sent a reply
    if (lastMessage.isSentFromUser) {
      setSuggestions([]); // Clear suggestions when user sent the last message
      return;
    }

    // Find the latest incoming message (from customer, not from user)
    const latestIncoming = [...messages]
      .reverse()
      .find((m) => !m.isSentFromUser);

    if (!latestIncoming?.id) {
      return;
    }

    // Only generate suggestions if this is a new incoming message
    if (latestIncoming.id !== lastProcessedIncomingIdRef.current) {
      lastProcessedIncomingIdRef.current = latestIncoming.id;
      generateSuggestions(false); // Use cache if available
    }
  }, [messages, generateSuggestions]);

  const customerName =
    partnerName ?? threadName ?? phoneNumber ?? t("context.unknownContact");

  const annotatedMessages = useMemo(() => {
    const items: Array<
      | { type: "label"; day: dayjs.Dayjs; key: string }
      | { type: "message"; message: Message; index: number }
    > = [];
    let lastLabelKey: string | null = null;

    messages.forEach((message, index) => {
      const day = dayjs(message.timestamp).startOf("day");
      const labelKey = day.toISOString();
      if (labelKey !== lastLabelKey) {
        items.push({ type: "label", day, key: labelKey });
        lastLabelKey = labelKey;
      }
      items.push({ type: "message", message, index });
    });

    return items;
  }, [messages]);

  const formatDayLabel = (day: dayjs.Dayjs) => {
    if (day.isSame(dayjs(), "day")) {
      return t("chat.dayToday");
    }
    if (day.isSame(dayjs().subtract(1, "day"), "day")) {
      return t("chat.dayYesterday");
    }
    return day.format("MMMM D, YYYY");
  };

  if (!chatId) {
    return (
      <section className="conversation-canvas flex h-full w-full items-center justify-center p-6 text-[rgb(var(--text-primary))]">
        <div className="surface-card flex max-w-sm flex-col items-center rounded-2xl p-8 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-[rgb(var(--accent-primary)/0.12)] text-[rgb(var(--accent-primary))]">
            <ChatCircleDotsIcon className="size-6" weight="fill" />
          </span>
          <p className="mt-4 text-sm leading-6 text-[rgb(var(--text-secondary))]">
            {t("app.selectChatPrompt")}
          </p>
        </div>
      </section>
    );
  }

  const getMessageSpacing = (
    index: number,
    reactionsCount?: number
  ): string => {
    if (index === messages.length - 1) {
      return "mb-0";
    } else if (reactionsCount && reactionsCount > 0) {
      return "mb-4";
    } else if (
      messages[index].isSentFromUser === messages[index + 1]?.isSentFromUser &&
      messages[index].contactId === messages[index + 1]?.contactId
    ) {
      return "mb-0.5";
    }
    return "mb-4";
  };

  return (
    <section className="flex h-full w-full flex-col">
      <ContactHeader />
      <DragDropZone
        onFilesDrop={handleFilesDrop}
        disabled={isSending || !chatId}
      >
        <div className="conversation-canvas relative flex min-h-0 w-full flex-1 flex-col">
          <div
            ref={scrollContainerRef}
            className="custom-scrollbar relative flex w-full min-h-0 flex-1 flex-col-reverse overflow-y-auto"
          >
            <div className="flex flex-col gap-2 px-3 py-4 md:px-5">
              {isPaginationLoading && (
                <div className="w-full flex justify-center items-center py-3">
                  <div className="flex items-center gap-2 text-[rgb(var(--text-secondary)/var(--text-secondary-opacity))]">
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-[rgb(var(--accent-primary))] border-t-transparent"></div>
                    <span className="text-xs">
                      {t("chat.loadingOlderMessages")}
                    </span>
                  </div>
                </div>
              )}
              {isLoading && (
                <div className="flex flex-col gap-3" aria-busy="true">
                  <span className="sr-only">{t("chat.loading")}</span>
                  {LOADING_BUBBLE_WIDTHS.map((width, index) => (
                    <div
                      key={index}
                      className={`h-10 animate-pulse rounded-2xl bg-[rgb(var(--bg-secondary))] ${
                        index % 2 ? "self-end" : "self-start"
                      }`}
                      style={{ width }}
                    />
                  ))}
                </div>
              )}
              {annotatedMessages.map((item) => {
                if (item.type === "label") {
                  return (
                    <div
                      key={`label-${item.key}`}
                      className="w-full flex justify-center items-center"
                    >
                      <div className="z-20 w-fit rounded-lg border border-[rgb(var(--border-primary)/var(--border-primary-opacity))] bg-[rgb(var(--bg-card))] px-2.5 py-1 shadow-sm">
                        <p className="text-xs font-medium text-[rgb(var(--text-secondary))]">
                          {formatDayLabel(item.day)}
                        </p>
                      </div>
                    </div>
                  );
                }

                const { message, index } = item;
                const translation = message.id
                  ? translations.get(message.id)
                  : undefined;
                return (
                  <MessageRow
                    key={message.id ?? `message-${index}`}
                    message={message}
                    spacingClass={getMessageSpacing(
                      index,
                      message.reactions?.length
                    )}
                    customerName={customerName}
                    group={group}
                    translatedText={translation?.translated}
                    isTranslated={!!translation}
                    isTranslating={translatingMessageId === message.id}
                    onReply={startReply}
                    onReaction={sendReaction}
                    onTranslate={handleTranslateMessage}
                  />
                );
              })}
            </div>
          </div>

          <section className="w-full shrink-0 border-t border-[rgb(var(--border-primary)/var(--border-primary-opacity))] bg-[rgb(var(--bg-card))] p-3 md:p-4">
            {isServiceWindowExpired && (
              <div
                className="mb-3 flex flex-col gap-3 rounded-xl border border-[rgb(var(--status-warning)/0.35)] bg-[rgb(var(--status-warning)/0.1)] p-3 sm:flex-row sm:items-center sm:justify-between"
                role="alert"
              >
                <p className="max-w-xl text-xs leading-5 text-[rgb(var(--text-primary))]">
                  {t("chatInput.serviceWindowExpired")}
                </p>
                {chatId && phoneNumber && (
                  <TemplatePicker
                    threadId={Number(chatId)}
                    phoneNumber={phoneNumber}
                    backendId={backendId}
                    disabled={isSending}
                    triggerVariant="cta"
                  />
                )}
              </div>
            )}
            <SuggestionChips
              suggestions={suggestions}
              isLoading={isSuggestionsLoading}
              onSelect={handleSuggestionSelect}
              onRefresh={handleRefreshSuggestions}
              disabled={
                isSending || isTypingAnimation || isServiceWindowExpired
              }
            />
            {replyTo && (
              <div className="mb-3 flex items-start justify-between gap-3 rounded-xl border-l-[3px] border-[rgb(var(--accent-primary))] bg-[rgb(var(--bg-secondary))] px-3 py-2.5">
                <div className="flex flex-col">
                  <p className="text-xs text-[rgb(var(--accent-primary))] font-semibold">
                    {t("chatInput.replyingTo", {
                      name: replyTo.isSentFromUser
                        ? t("common.you")
                        : (partnerName ??
                          threadName ??
                          phoneNumber ??
                          t("context.unknownContact")),
                    })}
                  </p>
                  <p className="max-w-xs truncate text-xs text-[rgb(var(--text-secondary))]">
                    {replyTo.message}
                  </p>
                </div>
                <button
                  type="button"
                  className="icon-action size-8 shrink-0"
                  onClick={cancelReply}
                >
                  <XCircleIcon className="size-5 md:size-4" weight="bold" />
                </button>
              </div>
            )}
            <form onSubmit={handleSubmit}>
              <div className="control-field flex items-end gap-1.5 px-1.5 py-1.5 shadow-sm">
                <AttachmentPicker
                  onAttachmentSelect={handleAttachmentSelect}
                  disabled={isSending || isServiceWindowExpired}
                  externalFile={droppedFile}
                  onExternalFileProcessed={handleDroppedFileProcessed}
                />
                <button
                  type="button"
                  onClick={handleTranslate}
                  disabled={
                    isTranslating ||
                    isAiImproving ||
                    isSending ||
                    isServiceWindowExpired ||
                    messageText.trim().length === 0
                  }
                  className={`icon-action mb-0.5 size-9 shrink-0 disabled:cursor-not-allowed disabled:opacity-40 ${
                    isTranslating
                      ? "animate-pulse text-[rgb(var(--accent-primary))]"
                      : ""
                  }`}
                  title={t("chatInput.translate")}
                  aria-label={t("chatInput.translate")}
                >
                  <TranslateIcon
                    className={`size-5 md:size-5 transition-transform ${
                      isTranslating ? "animate-spin" : ""
                    }`}
                    weight={isTranslating ? "fill" : "bold"}
                    style={
                      isTranslating ? { animationDuration: "2s" } : undefined
                    }
                  />
                </button>
                <button
                  type="button"
                  onClick={handleAiImprove}
                  disabled={
                    isAiImproving ||
                    isTranslating ||
                    isSending ||
                    isServiceWindowExpired ||
                    messages.length === 0
                  }
                  className={`icon-action mb-0.5 size-9 shrink-0 disabled:cursor-not-allowed disabled:opacity-40 ${
                    isAiImproving
                      ? "animate-pulse text-[rgb(var(--accent-primary))]"
                      : ""
                  }`}
                  title={t("chatInput.aiImprove")}
                  aria-label={t("chatInput.aiImprove")}
                >
                  <Sparkle
                    className={`size-5 md:size-5 transition-transform ${
                      isAiImproving ? "animate-spin" : ""
                    }`}
                    weight={isAiImproving ? "fill" : "regular"}
                    style={
                      isAiImproving ? { animationDuration: "2s" } : undefined
                    }
                  />
                </button>
                <textarea
                  ref={textareaRef}
                  className={`custom-scrollbar min-h-[44px] max-h-[120px] flex-1 resize-none overflow-y-auto bg-transparent px-2.5 py-2.5 text-sm text-[rgb(var(--text-primary))] caret-[rgb(var(--accent-primary))] outline-none placeholder-[rgb(var(--text-secondary)/var(--text-quaternary-opacity))] transition-[height] duration-150 ease-out ${
                    isTypingAnimation ? "animate-pulse" : ""
                  }`}
                  placeholder={
                    isTypingAnimation
                      ? t("chatInput.aiImproving")
                      : t("chatInput.placeholder")
                  }
                  value={messageText}
                  onChange={(event) => {
                    if (sendError) {
                      setSendError(null);
                    }
                    setMessageText(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      const form = event.currentTarget.form;
                      if (form && !isSending && messageText.trim().length > 0) {
                        form.requestSubmit();
                      }
                    }
                  }}
                  maxLength={4000}
                  disabled={
                    isSending || isTypingAnimation || isServiceWindowExpired
                  }
                  readOnly={isTypingAnimation}
                  rows={1}
                />
                <button
                  type="submit"
                  disabled={
                    isSending ||
                    isServiceWindowExpired ||
                    messageText.trim().length === 0
                  }
                  className="primary-action mb-0.5 mr-0.5 shrink-0 px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSending ? t("chatInput.sending") : t("chatInput.send")}
                </button>
              </div>
            </form>
            {sendError && (
              <p
                className="mt-2 px-1 text-xs text-[rgb(var(--status-error))]"
                role="alert"
              >
                {sendError}
              </p>
            )}
          </section>
        </div>
      </DragDropZone>
    </section>
  );
}
