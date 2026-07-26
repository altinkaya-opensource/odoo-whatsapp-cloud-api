/**
 * Desktop notifications, notification sound and the app unread badge.
 *
 * Everything that can interrupt the user lives here so a single incoming
 * message produces exactly one sound and one desktop notification, no matter
 * how many providers observed it.
 */

const SEEN_MESSAGES_KEY = "whatsapp.notificationState.messages";
const SEEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const OPEN_THREAD_EVENT = "whatsapp:open-thread";

export type IncomingNotification = {
  threadId: string;
  messageId: string | number;
  title: string;
  body: string;
};

// ponytail: module-level state, fine for a single-page app; move into a
// provider if a second app shell ever mounts this module.
let seenMessages: Map<string, number> | null = null;
let activeThreadId: string | null = null;
let audio: HTMLAudioElement | null = null;
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

const isBrowser = () => typeof window !== "undefined";

/** Messages already announced, pruned to the TTL. */
const getSeenMessages = (): Map<string, number> => {
  if (seenMessages) {
    return seenMessages;
  }

  seenMessages = new Map();
  if (!isBrowser()) {
    return seenMessages;
  }

  try {
    const stored = localStorage.getItem(SEEN_MESSAGES_KEY);
    const parsed: Record<string, number> = stored ? JSON.parse(stored) : {};
    const now = Date.now();
    Object.entries(parsed).forEach(([key, firstSeenAt]) => {
      // Keep the original timestamp: rewriting it on every save would mean
      // entries never expire and localStorage grows forever.
      if (typeof firstSeenAt === "number" && now - firstSeenAt < SEEN_TTL_MS) {
        seenMessages!.set(key, firstSeenAt);
      }
    });
  } catch (error) {
    console.error("[Notifications] Failed to restore seen messages:", error);
  }

  return seenMessages;
};

const persistSeenMessages = () => {
  if (!isBrowser()) {
    return;
  }

  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }

  saveTimeout = setTimeout(() => {
    try {
      localStorage.setItem(
        SEEN_MESSAGES_KEY,
        JSON.stringify(Object.fromEntries(getSeenMessages()))
      );
    } catch (error) {
      console.error("[Notifications] Failed to save seen messages:", error);
    }
  }, 1000);
};

/**
 * Mark a message as announced.
 * @returns true the first time this message is seen, false afterwards.
 */
const claimMessage = (threadId: string, messageId: string | number) => {
  const key = `${threadId}:${messageId}`;
  const seen = getSeenMessages();
  if (seen.has(key)) {
    return false;
  }

  seen.set(key, Date.now());
  persistSeenMessages();
  return true;
};

/** Record messages as announced without notifying (initial thread load). */
export const markMessagesAsSeen = (
  threadId: string,
  messageIds: Array<string | number>
) => {
  messageIds.forEach((messageId) => claimMessage(threadId, messageId));
};

/** The thread the user is currently looking at, or null. */
export const setActiveThread = (threadId: string | null) => {
  activeThreadId = threadId;
};

export const getNotificationPermission = (): NotificationPermission | null => {
  if (!isBrowser() || !("Notification" in window)) {
    return null;
  }
  return Notification.permission;
};

/**
 * Ask for notification permission. Must be called from a user gesture:
 * Safari and Firefox reject requests made on page load, and Chrome
 * suppresses the prompt for sites that ask without context.
 */
export const requestNotificationPermission = async () => {
  if (!isBrowser() || !("Notification" in window)) {
    return null;
  }

  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
};

const playSound = () => {
  if (!isBrowser()) {
    return;
  }

  if (!audio) {
    audio = new Audio("/notification.mp3");
  }

  audio.currentTime = 0;
  audio.play().catch(() => {
    // Autoplay blocked until the user interacts with the page.
  });
};

/**
 * A message the user is already reading does not need to interrupt them:
 * stay silent only when its thread is open in a visible tab.
 */
const shouldInterrupt = (threadId: string) => {
  const isVisible =
    typeof document !== "undefined" && document.visibilityState === "visible";
  return !(isVisible && activeThreadId === threadId);
};

const showDesktopNotification = ({
  threadId,
  title,
  body,
}: Omit<IncomingNotification, "messageId">) => {
  if (getNotificationPermission() !== "granted") {
    return;
  }

  try {
    const notification = new Notification(title, {
      body,
      // Collapse a burst from the same conversation into one alert.
      tag: `thread-${threadId}`,
      data: { threadId },
    });

    notification.onclick = () => {
      window.focus();
      window.dispatchEvent(
        new CustomEvent(OPEN_THREAD_EVENT, { detail: threadId })
      );
      notification.close();
    };
  } catch (error) {
    console.error("[Notifications] Failed to show notification:", error);
  }
};

/**
 * Announce an incoming message once: at most one sound and one desktop
 * notification per message, and neither while its thread is open in front
 * of the user.
 *
 * @returns `isNew` - false when this message was already handled, so callers
 *   can avoid counting it twice; `interrupted` - whether the user was
 *   actually alerted (false while they are reading that thread).
 */
export const notifyIncomingMessage = ({
  threadId,
  messageId,
  title,
  body,
}: IncomingNotification): { isNew: boolean; interrupted: boolean } => {
  if (!claimMessage(threadId, messageId)) {
    return { isNew: false, interrupted: false };
  }

  if (!shouldInterrupt(threadId)) {
    return { isNew: true, interrupted: false };
  }

  playSound();
  showDesktopNotification({ threadId, title, body });
  return { isNew: true, interrupted: true };
};

/** Subscribe to clicks on a desktop notification. Returns an unsubscribe fn. */
export const onOpenThreadRequest = (handler: (threadId: string) => void) => {
  if (!isBrowser()) {
    return () => undefined;
  }

  const listener = (event: Event) => {
    const threadId = (event as CustomEvent<string>).detail;
    if (threadId) {
      handler(threadId);
    }
  };

  window.addEventListener(OPEN_THREAD_EVENT, listener);
  return () => window.removeEventListener(OPEN_THREAD_EVENT, listener);
};

/** Show the unread count on the app icon (installed PWA / dock / taskbar). */
export const setUnreadBadge = (count: number) => {
  if (!isBrowser() || !("setAppBadge" in navigator)) {
    return;
  }

  const badge = navigator as Navigator & {
    setAppBadge: (count?: number) => Promise<void>;
    clearAppBadge: () => Promise<void>;
  };

  const update = count > 0 ? badge.setAppBadge(count) : badge.clearAppBadge();
  update.catch(() => {
    // Badging is unavailable outside an installed app; the title still shows
    // the count.
  });
};
