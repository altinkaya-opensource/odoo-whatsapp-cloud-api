import { memo } from "react";
import type { Message } from "@/app/context/chats-provider";
import Reaction from "../message/reaction";
import ChatMessage from "./chat-message";

type MessageRowProps = {
  message: Message;
  spacingClass: string;
  customerName: string;
  translatedText?: string;
  isTranslated: boolean;
  isTranslating: boolean;
  onReply: (message: Message) => void;
  onReaction: (message: Message, emoji: string) => void;
  onTranslate: (message: Message) => void;
};

/**
 * One message with its actions and reaction badge.
 *
 * Memoized: typing in the composer or a message arriving re-renders only the
 * rows whose props changed, not the whole conversation.
 */
function MessageRow({
  message,
  spacingClass,
  customerName,
  translatedText,
  isTranslated,
  isTranslating,
  onReply,
  onReaction,
  onTranslate,
}: MessageRowProps) {
  const actions = (
    <Reaction
      isSentFromUser={message.isSentFromUser}
      onReply={message.whatsappId ? () => onReply(message) : undefined}
      onReaction={
        message.whatsappId ? (emoji) => onReaction(message, emoji) : undefined
      }
      onTranslate={message.message ? () => onTranslate(message) : undefined}
      isTranslating={isTranslating}
      isTranslated={isTranslated}
    />
  );

  return (
    <div
      id={message.id ? `msg-${message.id}` : undefined}
      className={`w-full flex items-center ${
        message.isSentFromUser ? "justify-end" : "justify-start"
      }`}
    >
      <div
        className={`group relative flex items-center justify-between gap-2 ${spacingClass}`}
      >
        {message.isSentFromUser && actions}
        <ChatMessage
          message={message}
          customerName={customerName}
          translatedText={translatedText}
          isTranslated={isTranslated}
        />
        {!message.isSentFromUser && actions}
        {message.reactionEmoji && (
          <div
            className={`absolute z-20 -bottom-4 ${
              message.isSentFromUser ? "right-3" : "left-3"
            }`}
          >
            <div className="flex items-center justify-center overflow-hidden rounded-xl border border-[rgb(var(--border-primary)/var(--border-primary-opacity))] bg-[rgb(var(--bg-card))] shadow-sm">
              <p className="px-1.5 py-0.5 text-xs">{message.reactionEmoji}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(MessageRow);
