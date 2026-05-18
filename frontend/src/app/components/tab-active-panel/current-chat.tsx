import dayjs from "dayjs";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Message } from "@/app/context/chats-provider";
import { useCurrentChat } from "@/app/hooks/use-current-chat";
import Reaction from "../message/reaction";
import ContactHeader from "./contact-header";
import ChatMessage from "./chat-message";
import AttachmentPicker from "../message/attachment-picker";
import TemplatePicker from "../message/template-picker";
import DragDropZone from "../message/drag-drop-zone";
import SuggestionChips from "../message/suggestion-chips";
import { useTranslations } from "@/app/context/translation-provider";
import { useContacts } from "@/app/hooks/use-contacts";
import { XCircleIcon, Sparkle, TranslateIcon } from "@phosphor-icons/react";

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
  const [translatingMessageId, setTranslatingMessageId] = useState<
    string | null
  >(null);
  const { t, locale } = useTranslations();
  const { contacts } = useContacts();

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
  const isLoadingPaginationRef = useRef(false);
  const lastScrollHeightRef = useRef(0);
  const hasScrolledRef = useRef(false);

  // Auto-scroll to bottom on initial load and new messages
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container && !isLoadingPaginationRef.current && !targetMessageId) {
      container.scrollTop = container.scrollHeight;
      hasScrolledRef.current = true;
    }
  }, [messages.length, isLoading, targetMessageId]);

  // Handle scroll event for pagination
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    let isThrottled = false;

    const handleScroll = () => {
      if (isThrottled || !hasScrolledRef.current) return;

      const scrollTop = container.scrollTop;
      const scrollThreshold = 100; // Trigger when within 100px of top

      if (
        scrollTop <= scrollThreshold &&
        hasMoreMessages &&
        !isPaginationLoading &&
        !isLoading
      ) {
        isThrottled = true;

        // Save current scroll height before loading
        lastScrollHeightRef.current = container.scrollHeight;
        isLoadingPaginationRef.current = true;

        loadPreviousMessages().finally(() => {
          // Reset throttle after a short delay
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
      hasScrolledRef.current = true;

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

  // Preserve scroll position after pagination loads
  useEffect(() => {
    if (!isPaginationLoading && isLoadingPaginationRef.current) {
      const container = scrollContainerRef.current;
      if (container && lastScrollHeightRef.current > 0) {
        const newScrollHeight = container.scrollHeight;
        const scrollDiff = newScrollHeight - lastScrollHeightRef.current;
        container.scrollTop = scrollDiff;

        isLoadingPaginationRef.current = false;
        lastScrollHeightRef.current = 0;
      }
    }
  }, [isPaginationLoading, messages.length]);

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
      await sendMessage(trimmed);
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
      setSendError(err.message || "Failed to send attachment");
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
      if (translations.has(message.id)) {
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
          headers: { "Content-Type": "application/json" },
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
    [locale, translations]
  );

  // Generate suggestions with server-side caching
  const generateSuggestions = useCallback(
    async (forceRefresh = false) => {
      if (messages.length === 0 || !chatId) {
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
            { signal: abortController.signal }
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
          headers: { "Content-Type": "application/json" },
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
    [messages, contacts, chatId]
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
      <section className="w-full h-full text-[rgb(var(--text-primary))] flex justify-center items-center">
        {t("app.selectChatPrompt")}
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
    <section className="w-full h-full flex flex-col">
      <ContactHeader />
      <DragDropZone
        onFilesDrop={handleFilesDrop}
        disabled={isSending || !chatId}
      >
        <div className="relative flex-1 min-h-0 w-full flex flex-col">
          <div className="absolute inset-0 background-custom pointer-events-none"></div>

          <div
            ref={scrollContainerRef}
            className="relative flex-1 min-h-0 w-full overflow-y-auto custom-scrollbar"
          >
            <div className="min-h-full flex flex-col justify-end">
              <div className="p-4 md:p-4 px-3 md:px-4 flex flex-col gap-2">
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
                  <div className="text-[rgb(var(--text-primary))]">
                    {t("chat.loading")}
                  </div>
                )}
                {annotatedMessages.map((item) => {
                  if (item.type === "label") {
                    return (
                      <div
                        key={`label-${item.key}`}
                        className="w-full flex justify-center items-center"
                      >
                        <div className="rounded-full overflow-hidden bg-[rgb(var(--bg-primary))] z-20 w-fit">
                          <p className="bg-[rgb(var(--bg-secondary)/var(--bg-secondary-opacity))] text-[rgb(var(--text-secondary)/var(--text-secondary-opacity))] h-full w-full text-xs p-1 px-2">
                            {formatDayLabel(item.day)}
                          </p>
                        </div>
                      </div>
                    );
                  }

                  const { message, index } = item;

                  return (
                    <div
                      id={message.id ? `msg-${message.id}` : undefined}
                      className={`w-full flex items-center ${
                        message.isSentFromUser ? "justify-end" : "justify-start"
                      }`}
                      key={message.id ?? `message-${index}`}
                    >
                      <div
                        className={`flex justify-between gap-2 items-center ${getMessageSpacing(
                          index,
                          message.reactions?.length
                        )} relative`}
                      >
                        {message.isSentFromUser && (
                          <Reaction
                            isSentFromUser={true}
                            onReply={
                              message.whatsappId
                                ? () => startReply(message)
                                : undefined
                            }
                            onReaction={
                              message.whatsappId
                                ? (emoji) => sendReaction(message, emoji)
                                : undefined
                            }
                            onTranslate={
                              message.message
                                ? () => handleTranslateMessage(message)
                                : undefined
                            }
                            isTranslating={translatingMessageId === message.id}
                            isTranslated={
                              message.id ? translations.has(message.id) : false
                            }
                          />
                        )}
                        <ChatMessage
                          message={message}
                          translatedText={
                            message.id
                              ? translations.get(message.id)?.translated
                              : undefined
                          }
                          isTranslated={
                            message.id ? translations.has(message.id) : false
                          }
                        />
                        {!message.isSentFromUser && (
                          <Reaction
                            isSentFromUser={false}
                            onReply={
                              message.whatsappId
                                ? () => startReply(message)
                                : undefined
                            }
                            onReaction={
                              message.whatsappId
                                ? (emoji) => sendReaction(message, emoji)
                                : undefined
                            }
                            onTranslate={
                              message.message
                                ? () => handleTranslateMessage(message)
                                : undefined
                            }
                            isTranslating={translatingMessageId === message.id}
                            isTranslated={
                              message.id ? translations.has(message.id) : false
                            }
                          />
                        )}
                        {message.reactionEmoji && (
                          <div
                            className={`absolute z-20 -bottom-4 ${
                              message.isSentFromUser ? "right-3" : "left-3"
                            }`}
                          >
                            <div className="flex justify-center items-center rounded-xl overflow-hidden bg-black">
                              <p className="text-xs rounded-xl border-[1px] border-white/25 bg-white/20 px-1.5 py-0.5">
                                {message.reactionEmoji}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <section className="w-full z-50 p-4">
            {isServiceWindowExpired && (
              <div className="bg-[rgb(var(--status-info)/0.15)] border border-[rgb(var(--status-info)/0.3)] rounded-lg px-4 py-3 mb-2">
                <p className="text-xs text-[rgb(var(--text-secondary))]">
                  {t("chatInput.serviceWindowExpired")}
                </p>
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
              <div className="bg-[rgb(var(--bg-input)/var(--bg-input-opacity))] border-l-2 border-[rgb(var(--accent-primary))] px-3 py-2 rounded-lg mb-2 flex justify-between items-start gap-3">
                <div className="flex flex-col">
                  <p className="text-xs text-[rgb(var(--accent-primary))] font-semibold">
                    {t("chatInput.replyingTo", {
                      name: replyTo.isSentFromUser
                        ? t("common.you")
                        : (contacts.find((c) => c.id === replyTo.contactId)
                            ?.displayName ?? ""),
                    })}
                  </p>
                  <p className="text-xs text-[rgb(var(--text-secondary)/var(--text-tertiary-opacity))] max-w-xs truncate">
                    {replyTo.message}
                  </p>
                </div>
                <button
                  type="button"
                  className="text-[rgb(var(--text-secondary))] hover:text-[rgb(var(--text-primary))] p-2 active:bg-[rgb(var(--bg-secondary)/var(--bg-secondary-opacity))] rounded-lg transition-colors"
                  onClick={cancelReply}
                >
                  <XCircleIcon className="size-5 md:size-4" weight="bold" />
                </button>
              </div>
            )}
            <form onSubmit={handleSubmit}>
              <div className="bg-[rgb(var(--bg-input)/var(--bg-input-opacity))] rounded-3xl flex items-end gap-2 py-2">
                <AttachmentPicker
                  onAttachmentSelect={handleAttachmentSelect}
                  disabled={isSending || isServiceWindowExpired}
                  externalFile={droppedFile}
                  onExternalFileProcessed={handleDroppedFileProcessed}
                />
                {isServiceWindowExpired && chatId && phoneNumber && (
                  <TemplatePicker
                    threadId={Number(chatId)}
                    phoneNumber={phoneNumber}
                    backendId={backendId}
                    disabled={isSending}
                  />
                )}
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
                  className={`text-[rgb(var(--text-secondary))] hover:text-[rgb(var(--accent-primary))] disabled:opacity-40 disabled:cursor-not-allowed transition-all p-2 mb-1 active:scale-95 ${
                    isTranslating
                      ? "animate-pulse text-[rgb(var(--accent-primary))]"
                      : ""
                  }`}
                  title={t("chatInput.translate")}
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
                  className={`text-[rgb(var(--text-secondary))] hover:text-[rgb(var(--accent-primary))] disabled:opacity-40 disabled:cursor-not-allowed transition-all p-2 mb-1 active:scale-95 ${
                    isAiImproving
                      ? "animate-pulse text-[rgb(var(--accent-primary))]"
                      : ""
                  }`}
                  title={t("chatInput.aiImprove")}
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
                  className={`flex-1 outline-none p-3 px-4 md:p-3 text-[rgb(var(--text-primary))] placeholder-[rgb(var(--text-secondary))] caret-[rgb(var(--accent-primary))] text-sm md:text-sm bg-transparent resize-none overflow-y-auto custom-scrollbar min-h-[44px] max-h-[120px] transition-[height] duration-150 ease-out ${
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
                  className="text-sm font-semibold text-white bg-[rgb(var(--accent-primary))] hover:bg-[rgb(var(--status-success))] active:bg-[rgb(var(--accent-primary)/0.8)] disabled:opacity-60 disabled:cursor-not-allowed transition rounded-full px-5 py-2.5 md:px-4 mr-2 mb-1"
                >
                  {isSending ? t("chatInput.sending") : t("chatInput.send")}
                </button>
              </div>
            </form>
            {sendError && (
              <p className="text-xs text-[rgb(var(--status-error))] mt-2 px-2">
                {sendError}
              </p>
            )}
          </section>
        </div>
      </DragDropZone>
    </section>
  );
}
