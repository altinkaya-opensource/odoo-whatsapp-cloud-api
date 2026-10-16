import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/api-client";
import { useAuth } from "./use-auth";
import { useRealtime } from "./use-realtime";

// While the user types, tell the others at most this often
const TYPING_REFRESH_MS = 5_000;
// This long without a keystroke and the user has stopped typing
const TYPING_IDLE_MS = 5_000;
// A notice that is not refreshed expires: a closed tab never says it stopped
const TYPING_EXPIRY_MS = 12_000;

type Typist = { threadId: string; name: string; expiresAt: number };

// One post at a time, so a late "typing" never lands after "stopped"
let lastPost: Promise<void> = Promise.resolve();

const postTyping = (threadId: string, isTyping: boolean) => {
  lastPost = lastPost.then(() =>
    apiFetch("/api/threads/typing", {
      method: "POST",
      body: { threadId, isTyping },
    }).then(
      () => undefined,
      () => {
        // Only a hint for the others: the composer keeps working without it
      }
    )
  );
};

/**
 * Who else is typing in this chat, and the calls that tell them the user is.
 *
 * Call notifyTyping with the composer text on every change and stopTyping
 * when the message is sent.
 */
export const useTyping = (chatId: string | null) => {
  const { user } = useAuth();
  const userId = user?.uid ?? null;
  // Keyed by thread and user, so opening a chat shows who already types there
  const [typists, setTypists] = useState<Map<string, Typist>>(new Map());
  const typingThreadRef = useRef<string | null>(null);
  const lastSentAtRef = useRef(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

  const stopTyping = useCallback(() => {
    clearTimeout(idleTimerRef.current);
    const threadId = typingThreadRef.current;
    if (!threadId) {
      return;
    }
    typingThreadRef.current = null;
    lastSentAtRef.current = 0;
    postTyping(threadId, false);
  }, []);

  const notifyTyping = useCallback(
    (text: string) => {
      if (!chatId || !text.trim()) {
        stopTyping();
        return;
      }
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(stopTyping, TYPING_IDLE_MS);
      const now = Date.now();
      if (now - lastSentAtRef.current < TYPING_REFRESH_MS) {
        return;
      }
      typingThreadRef.current = chatId;
      lastSentAtRef.current = now;
      postTyping(chatId, true);
    },
    [chatId, stopTyping]
  );

  // Leaving the chat stops typing in it
  useEffect(() => stopTyping, [chatId, stopTyping]);

  useRealtime({
    onTyping: ({ thread_id, user_id, user_name, is_typing }) => {
      if (user_id === userId) {
        return;
      }
      const threadId = String(thread_id);
      setTypists((current) => {
        const next = new Map(current);
        const key = `${threadId}:${user_id}`;
        if (is_typing) {
          const expiresAt = Date.now() + TYPING_EXPIRY_MS;
          next.set(key, { threadId, name: user_name, expiresAt });
        } else {
          next.delete(key);
        }
        return next;
      });
    },
  });

  // Drop each notice when it expires
  useEffect(() => {
    if (typists.size === 0) {
      return;
    }
    const nextExpiry = Math.min(
      ...[...typists.values()].map((typist) => typist.expiresAt)
    );
    const timer = setTimeout(
      () => {
        const now = Date.now();
        setTypists(
          (current) =>
            new Map([...current].filter(([, typist]) => typist.expiresAt > now))
        );
      },
      Math.max(nextExpiry - Date.now(), 0)
    );
    return () => clearTimeout(timer);
  }, [typists]);

  const typistNames = [...typists.values()]
    .filter((typist) => typist.threadId === chatId)
    .map((typist) => typist.name);
  return { typistNames, notifyTyping, stopTyping };
};
