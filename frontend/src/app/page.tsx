"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  PropsWithChildren,
} from "react";
import TabActivePanel from "./components/tab-active-panel";
import ConversationContext from "./components/conversation-context";
import TabIcons from "./components/tab-icons";
import TabPanel from "./components/tab-panel";
import ChatsProvider from "./context/chats-provider";
import ContactsProvider from "./context/contacts-provider";
import CurrentChatProvider from "./context/current-chat-provider";
import ProfileProvider from "./context/profile-provider";
import TabProvider from "./context/tab-provider";
import AuthProvider from "./context/auth-provider";
import { useAuth } from "./hooks/use-auth";
import LoginScreen from "./components/auth/login-screen";
import {
  TranslationProvider,
  useTranslations,
} from "./context/translation-provider";
import { ThemeProvider } from "./context/theme-provider";
import ConnectionProvider from "./context/connection-provider";
import ConnectionOverlay from "./components/connection-overlay";
import {
  MobileNavigationProvider,
  useMobileNavigation,
} from "./context/mobile-navigation-provider";
import { useResponsive } from "./hooks/use-responsive";
import { useChats } from "./hooks/use-chats";
import { useCurrentChat } from "./hooks/use-current-chat";
import TabSyncProvider from "./context/tab-sync-provider";
import { useTabSync } from "./hooks/use-tab-sync";
import SessionBlockedOverlay from "./components/session-blocked-overlay";

// Context to pass initial thread_id to child components
const InitialThreadContext = createContext<string | null>(null);

function useInitialThread() {
  return useContext(InitialThreadContext);
}

function InitialThreadProvider({
  children,
  threadId,
}: PropsWithChildren<{ threadId: string | null }>) {
  return (
    <InitialThreadContext.Provider value={threadId}>
      {children}
    </InitialThreadContext.Provider>
  );
}

/**
 * Auto-selects a chat based on the initial thread_id from URL.
 * This component runs after authentication and waits for chats to load.
 */
function AutoSelectChat() {
  const initialThreadId = useInitialThread();
  const { chats } = useChats();
  const { loadCurrentChat, chatId } = useCurrentChat();
  const { setCurrentView } = useMobileNavigation();
  const hasAutoSelected = useRef(false);

  useEffect(() => {
    // Only auto-select once, when we have a thread_id and chats are loaded
    if (
      !initialThreadId ||
      hasAutoSelected.current ||
      chats.isLoading ||
      chats.complete.length === 0
    ) {
      return;
    }

    // Find the chat with the matching thread_id
    const targetChat = chats.complete.find(
      (chat) => chat.id === initialThreadId
    );

    if (targetChat && chatId !== initialThreadId) {
      hasAutoSelected.current = true;

      // Load the chat
      loadCurrentChat({
        chatId: targetChat.id,
        contact: null,
        messages: [],
        group: null,
        page: 0,
        isLoading: true,
        isPaginationLoading: false,
        hasMoreMessages: true,
        threadName: targetChat.threadName || null,
        phoneNumber: targetChat.phoneNumber || null,
        backendId: targetChat.backendId || null,
        partnerId: targetChat.partnerId || null,
        partnerName: targetChat.partnerName || null,
        partnerAvatar: targetChat.partnerAvatar || null,
        hasAvatar: targetChat.hasAvatar || false,
        isSending: false,
        replyTo: null,
      });

      // On mobile, switch to chat view
      setCurrentView("activeChat");
    }
  }, [
    initialThreadId,
    chats.isLoading,
    chats.complete,
    chatId,
    loadCurrentChat,
    setCurrentView,
  ]);

  return null;
}

function ResponsiveLayout() {
  const { isMobile, isInitialized } = useResponsive();
  const { currentView } = useMobileNavigation();
  const { t } = useTranslations();

  // Use a shaped loading state instead of a blank page while responsive
  // layout information becomes available after hydration.
  if (!isInitialized) {
    return (
      <section className="app-shell flex h-[100dvh] items-center justify-center p-6">
        <div className="surface-card flex w-full max-w-sm flex-col gap-5 rounded-2xl p-6">
          <div className="h-3 w-24 animate-pulse rounded-full bg-[rgb(var(--bg-tertiary))]" />
          <div className="h-9 w-3/4 animate-pulse rounded-xl bg-[rgb(var(--bg-secondary))]" />
          <p className="text-sm text-[rgb(var(--text-secondary))]">
            {t("app.loadingWorkspace")}
          </p>
        </div>
      </section>
    );
  }

  // Mobile layout: single panel view
  if (isMobile) {
    return (
      <section className="app-shell flex h-[100dvh] min-h-0 w-full flex-col">
        {currentView === "chatList" ? (
          <>
            <div className="min-h-0 flex-1">
              <TabPanel />
            </div>
            <TabIcons />
          </>
        ) : (
          <div className="min-h-0 flex-1">
            <TabActivePanel />
          </div>
        )}
        <ConnectionOverlay />
      </section>
    );
  }

  // Tablet/Desktop layout: multi-panel grid
  return (
    <section className="app-shell grid h-[100dvh] min-h-0 w-full grid-cols-[64px_minmax(280px,360px)_minmax(0,1fr)] xl:grid-cols-[72px_minmax(320px,380px)_minmax(0,1fr)_minmax(264px,312px)]">
      <TabIcons />
      <TabPanel />
      <TabActivePanel />
      <ConversationContext />
      <ConnectionOverlay />
    </section>
  );
}

function PageTitleUpdater() {
  const { totalUnreadCount } = useChats();

  useEffect(() => {
    const baseTitle = "Odoo WhatsApp Web";
    if (totalUnreadCount > 0) {
      document.title = `(${totalUnreadCount}) ${baseTitle}`;
    } else {
      document.title = baseTitle;
    }
  }, [totalUnreadCount]);

  return null;
}

function AppShell() {
  const initialThreadId = useInitialThread();

  return (
    <ProfileProvider>
      <TabProvider>
        <ContactsProvider>
          <ChatsProvider includeThreadId={initialThreadId}>
            <PageTitleUpdater />
            <CurrentChatProvider>
              <MobileNavigationProvider>
                <AutoSelectChat />
                <ResponsiveLayout />
              </MobileNavigationProvider>
            </CurrentChatProvider>
          </ChatsProvider>
        </ContactsProvider>
      </TabProvider>
    </ProfileProvider>
  );
}

function TabSyncGuard() {
  const { isBlocked } = useTabSync();

  if (isBlocked) {
    return <SessionBlockedOverlay />;
  }

  return null;
}

function AuthenticatedApp() {
  const { isAuthenticated, isCheckingAuth, loginWithSessionId } = useAuth();
  const { t } = useTranslations();
  const [isSsoLoading, setIsSsoLoading] = useState(false);
  const [ssoError, setSsoError] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false);
  const [initialThreadId, setInitialThreadId] = useState<string | null>(null);
  const ssoAttemptedRef = useRef(false);

  // Mark as client-side after hydration to prevent hydration mismatch
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Auto-login from SSO parameter
  useEffect(() => {
    if (!isClient || ssoAttemptedRef.current) return;

    const params = new URLSearchParams(window.location.search);
    const ssoSession = params.get("sso_session");
    const threadId = params.get("thread_id");
    const error = params.get("error");

    // Store thread_id for later use (before cleaning URL)
    if (threadId) {
      setInitialThreadId(threadId);
    }

    // Handle error from SSO endpoint
    if (error) {
      setSsoError(error);
      ssoAttemptedRef.current = true;
      // Clean URL
      window.history.replaceState({}, "", "/");
      return;
    }

    // Perform SSO login if parameter exists and not already authenticated
    if (ssoSession && !isAuthenticated && !isCheckingAuth) {
      ssoAttemptedRef.current = true;
      setIsSsoLoading(true);
      // Clean URL immediately (before async operation to prevent bookmark with session)
      window.history.replaceState({}, "", "/");

      // Perform login using existing auth flow
      loginWithSessionId(ssoSession)
        .then(() => {
          // Success - auth state will update and component will re-render
          setIsSsoLoading(false);
        })
        .catch((err) => {
          console.error("[SSO] Auto-login failed:", err);
          setSsoError(
            err.message || "SSO login failed. Please try logging in manually."
          );
          setIsSsoLoading(false);
        });
    }
  }, [isClient, isAuthenticated, isCheckingAuth, loginWithSessionId]);

  // Show SSO loading state (only check after client hydration)
  if (isSsoLoading) {
    return (
      <section className="app-shell flex min-h-[100dvh] w-full items-center justify-center p-6 text-[rgb(var(--text-primary))]">
        <div className="surface-card w-full max-w-sm rounded-2xl p-8 text-center">
          <div className="mx-auto mb-4 inline-block size-10 animate-spin rounded-full border-[3px] border-[rgb(var(--accent-primary)/0.24)] border-t-[rgb(var(--accent-primary))]" />
          <p className="text-lg text-[rgb(var(--text-secondary)/var(--text-tertiary-opacity))]">
            {t("auth.ssoLoggingIn") || "Logging in from Odoo..."}
          </p>
        </div>
      </section>
    );
  }

  if (isCheckingAuth) {
    return (
      <section className="app-shell flex min-h-[100dvh] w-full items-center justify-center p-6 text-[rgb(var(--text-primary))]">
        <div className="surface-card w-full max-w-sm rounded-2xl p-8 text-center">
          <div className="mx-auto mb-4 h-2 w-20 animate-pulse rounded-full bg-[rgb(var(--accent-primary))]" />
          <p className="text-lg text-[rgb(var(--text-secondary)/var(--text-tertiary-opacity))]">
            {t("app.loadingWorkspace")}
          </p>
        </div>
      </section>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen ssoError={ssoError} />;
  }

  return (
    <InitialThreadProvider threadId={initialThreadId}>
      <TabSyncGuard />
      <AppShell />
    </InitialThreadProvider>
  );
}

export default function Home() {
  return (
    <TranslationProvider>
      <ThemeProvider>
        <TabSyncProvider>
          <AuthProvider>
            <ConnectionProvider>
              <AuthenticatedApp />
            </ConnectionProvider>
          </AuthProvider>
        </TabSyncProvider>
      </ThemeProvider>
    </TranslationProvider>
  );
}
