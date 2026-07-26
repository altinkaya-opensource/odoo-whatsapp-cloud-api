import {
  ArrowBendUpLeftIcon,
  SmileyIcon,
  TranslateIcon,
  SpinnerGapIcon,
} from "@phosphor-icons/react";
import { MouseEvent, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "@/app/context/translation-provider";

const item = {
  hidden: { opacity: 0, scale: 0.9 },
  show: { opacity: 1, scale: 1 },
};

const reactions = ["👍🏼", "❤️", "😂", "😮", "🥲", "🙏🏻"];

type ReactionProps = {
  isSentFromUser: boolean;
  onReply?: () => void;
  onReaction?: (emoji: string) => void;
  onTranslate?: () => void;
  isTranslating?: boolean;
  isTranslated?: boolean;
};

export default function Reaction({
  isSentFromUser,
  onReply,
  onReaction,
  onTranslate,
  isTranslating = false,
  isTranslated = false,
}: ReactionProps) {
  const { t } = useTranslations();
  const [reactionMenuOpen, setReactionMenuOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!reactionMenuOpen) {
      return;
    }

    const handleClickOutside = (event: globalThis.MouseEvent) => {
      if (
        popupRef.current &&
        !popupRef.current.contains(event.target as Node)
      ) {
        setReactionMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setReactionMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [reactionMenuOpen]);

  const handleReplyClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onReply?.();
  };

  const handleTranslateClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onTranslate?.();
  };

  const handleReactionClick = (
    event: MouseEvent<HTMLButtonElement>,
    emoji: string
  ) => {
    event.stopPropagation();
    onReaction?.(emoji);
    setReactionMenuOpen(false);
  };

  return (
    <div
      ref={popupRef}
      className={`relative flex flex-col items-center justify-center gap-1 transition-opacity ${
        reactionMenuOpen
          ? "opacity-100"
          : "opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-within:opacity-100"
      }`}
    >
      {onReply && (
        <button
          type="button"
          className="icon-action size-8"
          onClick={handleReplyClick}
          title={t("chat.reply")}
          aria-label={t("chat.reply")}
        >
          <ArrowBendUpLeftIcon className="size-4" weight="bold" />
        </button>
      )}
      {onTranslate && (
        <button
          type="button"
          className={`icon-action size-8 ${
            isTranslated ? "text-[rgb(var(--accent-primary))]" : ""
          }`}
          onClick={handleTranslateClick}
          disabled={isTranslating}
          title={t("chatInput.translate")}
          aria-label={t("chatInput.translate")}
        >
          {isTranslating ? (
            <SpinnerGapIcon className="size-4 animate-spin" weight="bold" />
          ) : (
            <TranslateIcon
              className="size-4"
              weight={isTranslated ? "fill" : "bold"}
            />
          )}
        </button>
      )}
      <button
        type="button"
        className="icon-action size-8"
        onClick={() => setReactionMenuOpen((previous) => !previous)}
        title={t("chat.addReaction")}
        aria-label={t("chat.addReaction")}
        aria-expanded={reactionMenuOpen}
      >
        <SmileyIcon className="size-4" weight="regular" />
      </button>

      <AnimatePresence>
        {reactionMenuOpen && (
          <motion.div
            initial="hidden"
            animate="show"
            exit="hidden"
            variants={{
              hidden: { opacity: 0, scale: 0.94 },
              show: {
                opacity: 1,
                scale: 1,
                transition: { type: "spring", bounce: 0.2, duration: 0.2 },
              },
            }}
            className={`absolute z-50 -top-14 ${
              isSentFromUser ? "right-0" : "left-0"
            }`}
            role="menu"
            aria-label={t("chat.addReaction")}
          >
            <motion.div
              variants={{
                hidden: { opacity: 0 },
                show: {
                  opacity: 1,
                  transition: {
                    staggerChildren: 0.02,
                    staggerDirection: isSentFromUser ? -1 : 1,
                  },
                },
              }}
              initial="hidden"
              animate="show"
              className="surface-card flex max-w-[90vw] items-center gap-1 overflow-x-auto rounded-2xl p-1.5"
            >
              {reactions.map((reaction) => (
                <motion.button
                  variants={item}
                  className="flex size-9 shrink-0 items-center justify-center rounded-xl text-xl transition-transform hover:scale-110 focus-visible:outline-offset-0"
                  key={reaction}
                  onClick={(event) => handleReactionClick(event, reaction)}
                  type="button"
                  role="menuitem"
                  aria-label={reaction}
                >
                  {reaction}
                </motion.button>
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
