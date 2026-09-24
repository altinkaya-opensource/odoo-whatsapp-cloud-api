"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  PropsWithChildren,
} from "react";

type ConnectionStatus = "connected" | "disconnected" | "session-expired";

type ConnectionContextType = {
  connectionStatus: ConnectionStatus;
  setConnectionStatus: (status: ConnectionStatus) => void;
  reportApiError: (error: unknown) => void;
  reportSessionExpiry: () => void;
  reportConnectionRestored: () => void;
};

const ConnectionContext = createContext<ConnectionContextType | undefined>(
  undefined
);

export const useConnection = () => {
  const context = useContext(ConnectionContext);
  if (!context) {
    throw new Error("useConnection must be used within a ConnectionProvider");
  }
  return context;
};

export default function ConnectionProvider({ children }: PropsWithChildren) {
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connected");

  const reportApiError = useCallback((error: unknown) => {
    // Check if it's a network error or connection refused
    if (error instanceof TypeError && error.message.includes("fetch")) {
      setConnectionStatus("disconnected");
      return;
    }

    // Type narrowing for error objects
    const err = error as {
      status?: number;
      cause?: { code?: string };
      message?: string;
    };

    // Check for ECONNREFUSED specifically
    if (err?.cause?.code === "ECONNREFUSED") {
      setConnectionStatus("disconnected");
      return;
    }

    // Only 401 means the session is gone; 403 is a refusal of one request
    if (err?.status === 401) {
      setConnectionStatus("session-expired");
      return;
    }

    // Check if it's a server error that indicates connection issues
    if (err?.status && err.status >= 500) {
      setConnectionStatus("disconnected");
      return;
    }
  }, []);

  const reportSessionExpiry = useCallback(() => {
    setConnectionStatus("session-expired");
  }, []);

  const reportConnectionRestored = useCallback(() => {
    setConnectionStatus("connected");
  }, []);

  return (
    <ConnectionContext.Provider
      value={{
        connectionStatus,
        setConnectionStatus,
        reportApiError,
        reportSessionExpiry,
        reportConnectionRestored,
      }}
    >
      {children}
    </ConnectionContext.Provider>
  );
}
