"use client";

import {
  createContext,
  PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { OdooLoginResult } from "@/app/lib/odoo/jsonrpc";

type BackendUser = {
  id: number;
  name: string;
  imageUrl?: string | null;
};

type BackendMeta = {
  backend_id?: number;
  backend_ids?: number[];
  user_id?: number;
  users?: { id: number; name: string; image_url?: string | null }[];
  backend_names?: Record<number, string>;
};

type AuthenticatedResponse = {
  sessionId?: string;
  user?: OdooLoginResult | null;
  backend?: BackendMeta;
};

type AuthContextValue = {
  sessionId: string | null;
  user: OdooLoginResult | null;
  backendId: number | null;
  backendIds: number[];
  backendUserId: number | null;
  backendUsers: BackendUser[];
  backendUsersById: Record<number, BackendUser>;
  backendNames: Record<number, string>;
  isAuthenticated: boolean;
  isCheckingAuth: boolean;
  isAuthenticating: boolean;
  login: (
    username: string,
    password: string
  ) => Promise<{ totpRequired: boolean }>;
  verifyTotp: (code: string) => Promise<void>;
  loginWithSessionId: (sessionId: string) => Promise<void>;
  logout: () => void;
};

const SESSION_STORAGE_KEY = "odooSessionId";
const SESSION_USER_KEY = "odooSessionUser";
const SESSION_BACKEND_KEY = "odooBackendMeta";

export const AuthContext = createContext<AuthContextValue | undefined>(
  undefined
);

type AuthStatus = "checking" | "authenticated" | "unauthenticated";

export default function AuthProvider({ children }: PropsWithChildren) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [user, setUser] = useState<OdooLoginResult | null>(null);
  const [backendId, setBackendId] = useState<number | null>(null);
  const [backendIds, setBackendIds] = useState<number[]>([]);
  const [backendUserId, setBackendUserId] = useState<number | null>(null);
  const [backendUsers, setBackendUsers] = useState<BackendUser[]>([]);
  const [backendNames, setBackendNames] = useState<Record<number, string>>({});
  const [status, setStatus] = useState<AuthStatus>("checking");
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedSession = window.localStorage.getItem(SESSION_STORAGE_KEY);
    const storedUser = window.localStorage.getItem(SESSION_USER_KEY);
    const storedBackend = window.localStorage.getItem(SESSION_BACKEND_KEY);

    if (storedSession) {
      // Load cached data immediately for faster UI
      setSessionId(storedSession);
      if (storedUser) {
        try {
          setUser(JSON.parse(storedUser));
        } catch {
          window.localStorage.removeItem(SESSION_USER_KEY);
        }
      }
      if (storedBackend) {
        try {
          const parsed = JSON.parse(storedBackend) as {
            backendId?: number | null;
            backendIds?: number[];
            backendUserId?: number | null;
            backendUsers?: BackendUser[];
            backendNames?: Record<number, string>;
          };
          setBackendId(
            typeof parsed.backendId === "number" ? parsed.backendId : null
          );
          setBackendIds(
            Array.isArray(parsed.backendIds) ? parsed.backendIds : []
          );
          setBackendUserId(
            typeof parsed.backendUserId === "number"
              ? parsed.backendUserId
              : null
          );
          setBackendUsers(
            Array.isArray(parsed.backendUsers) ? parsed.backendUsers : []
          );
          setBackendNames(
            parsed.backendNames && typeof parsed.backendNames === "object"
              ? parsed.backendNames
              : {}
          );
        } catch {
          window.localStorage.removeItem(SESSION_BACKEND_KEY);
        }
      }
      setStatus("authenticated");

      // Revalidate session in background to refresh server-side cache
      // Repopulates the server-side session cache after a restart or deploy
      loginWithSessionId(storedSession).catch(() => {
        // Session validation failed - user will be logged out
        console.log("[Auth] Session revalidation failed on mount");
      });
    } else {
      setStatus("unauthenticated");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps - only run on mount

  const persistSession = useCallback(
    (
      newSessionId: string,
      sessionUser: OdooLoginResult | null,
      backendMeta?: {
        backendId?: number | null;
        backendIds?: number[];
        backendUserId?: number | null;
        backendUsers?: BackendUser[];
        backendNames?: Record<number, string>;
      }
    ) => {
      if (typeof window === "undefined") {
        return;
      }
      window.localStorage.setItem(SESSION_STORAGE_KEY, newSessionId);
      if (sessionUser) {
        window.localStorage.setItem(
          SESSION_USER_KEY,
          JSON.stringify(sessionUser)
        );
      } else {
        window.localStorage.removeItem(SESSION_USER_KEY);
      }
      if (backendMeta) {
        window.localStorage.setItem(
          SESSION_BACKEND_KEY,
          JSON.stringify({
            backendId: backendMeta.backendId ?? null,
            backendIds: backendMeta.backendIds ?? [],
            backendUserId: backendMeta.backendUserId ?? null,
            backendUsers: backendMeta.backendUsers ?? [],
            backendNames: backendMeta.backendNames ?? {},
          })
        );
      } else {
        window.localStorage.removeItem(SESSION_BACKEND_KEY);
      }
    },
    []
  );

  const clearPersistedSession = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    window.localStorage.removeItem(SESSION_USER_KEY);
    window.localStorage.removeItem(SESSION_BACKEND_KEY);
  }, []);

  const applyAuthenticatedResponse = useCallback(
    ({
      sessionId: newSessionId,
      user: sessionUser,
      backend,
    }: AuthenticatedResponse) => {
      if (!newSessionId) {
        throw new Error("Missing session id in server response");
      }

      const backendUsersList: BackendUser[] = Array.isArray(backend?.users)
        ? backend.users.map((backendUser) => ({
            id: backendUser.id,
            name: backendUser.name,
            imageUrl: backendUser.image_url,
          }))
        : [];
      const resolvedBackendId =
        typeof backend?.backend_id === "number" ? backend.backend_id : null;
      const resolvedBackendIds = Array.isArray(backend?.backend_ids)
        ? backend.backend_ids
        : [];
      const resolvedBackendUserId =
        typeof backend?.user_id === "number" ? backend.user_id : null;
      const resolvedBackendNames =
        backend?.backend_names && typeof backend.backend_names === "object"
          ? backend.backend_names
          : {};

      setSessionId(newSessionId);
      setUser(sessionUser ?? null);
      setBackendId(resolvedBackendId);
      setBackendIds(resolvedBackendIds);
      setBackendUserId(resolvedBackendUserId);
      setBackendUsers(backendUsersList);
      setBackendNames(resolvedBackendNames);
      persistSession(newSessionId, sessionUser ?? null, {
        backendId: resolvedBackendId,
        backendIds: resolvedBackendIds,
        backendUserId: resolvedBackendUserId,
        backendUsers: backendUsersList,
        backendNames: resolvedBackendNames,
      });
      setStatus("authenticated");
    },
    [persistSession]
  );

  const clearAuthentication = useCallback(() => {
    setSessionId(null);
    setUser(null);
    setBackendId(null);
    setBackendIds([]);
    setBackendUserId(null);
    setBackendUsers([]);
    setBackendNames({});
    clearPersistedSession();
    setStatus("unauthenticated");
  }, [clearPersistedSession]);

  const login = useCallback(
    async (username: string, password: string) => {
      setIsAuthenticating(true);
      try {
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ username, password }),
        });

        const data = (await response.json()) as AuthenticatedResponse & {
          totpRequired?: boolean;
          error?: unknown;
        };

        if (!response.ok) {
          const message =
            typeof data?.error === "string"
              ? data.error
              : "Unable to sign in with the provided credentials";
          throw new Error(message);
        }

        if (data.totpRequired) {
          clearAuthentication();
          return { totpRequired: true };
        }

        applyAuthenticatedResponse(data);
        return { totpRequired: false };
      } catch (error) {
        clearAuthentication();
        throw error;
      } finally {
        setIsAuthenticating(false);
      }
    },
    [applyAuthenticatedResponse, clearAuthentication]
  );

  const verifyTotp = useCallback(
    async (code: string) => {
      setIsAuthenticating(true);
      try {
        const response = await fetch("/api/auth/verify-totp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ code }),
        });
        const data = (await response.json()) as AuthenticatedResponse & {
          error?: unknown;
        };

        if (!response.ok) {
          const message =
            typeof data?.error === "string"
              ? data.error
              : "Unable to verify the authentication code";
          throw new Error(message);
        }

        applyAuthenticatedResponse(data);
      } catch (error) {
        clearAuthentication();
        throw error;
      } finally {
        setIsAuthenticating(false);
      }
    },
    [applyAuthenticatedResponse, clearAuthentication]
  );

  const loginWithSessionId = useCallback(
    async (providedSessionId: string) => {
      setIsAuthenticating(true);
      try {
        const response = await fetch("/api/auth/validate-session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ sessionId: providedSessionId }),
        });

        const data = (await response.json()) as Omit<
          AuthenticatedResponse,
          "sessionId"
        > & { error?: unknown };

        if (!response.ok) {
          const message =
            typeof data?.error === "string"
              ? data.error
              : "Invalid or expired session ID";
          throw new Error(message);
        }

        applyAuthenticatedResponse({
          ...data,
          sessionId: providedSessionId,
        });
      } catch (error) {
        clearAuthentication();
        throw error;
      } finally {
        setIsAuthenticating(false);
      }
    },
    [applyAuthenticatedResponse, clearAuthentication]
  );

  const logout = useCallback(() => {
    clearAuthentication();
  }, [clearAuthentication]);

  const value = useMemo<AuthContextValue>(
    () => ({
      sessionId,
      user,
      backendId,
      backendIds,
      backendUserId,
      backendUsers,
      backendUsersById: backendUsers.reduce<Record<number, BackendUser>>(
        (acc, backendUser) => {
          acc[backendUser.id] = backendUser;
          return acc;
        },
        {}
      ),
      backendNames,
      isAuthenticated: status === "authenticated",
      isCheckingAuth: status === "checking",
      isAuthenticating,
      login,
      verifyTotp,
      loginWithSessionId,
      logout,
    }),
    [
      sessionId,
      user,
      backendId,
      backendIds,
      backendUserId,
      backendUsers,
      backendNames,
      status,
      isAuthenticating,
      login,
      verifyTotp,
      loginWithSessionId,
      logout,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
