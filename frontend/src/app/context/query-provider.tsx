"use client";

import { PropsWithChildren, useEffect, useState } from "react";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { ApiError } from "../lib/api-client";
import { useAuth } from "../hooks/use-auth";
import { useConnection } from "./connection-provider";

// Errors a retry cannot fix
const FINAL_STATUSES = new Set([400, 401, 403, 404]);

/**
 * Server state (threads, messages, counts) lives in one query cache.
 *
 * Every request reports to the connection banner, and a new session starts
 * from an empty cache so one agent never sees another's data.
 */
export default function QueryProvider({ children }: PropsWithChildren) {
  const { reportApiError, reportConnectionRestored } = useConnection();
  const { sessionId } = useAuth();
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: reportApiError,
          onSuccess: reportConnectionRestored,
        }),
        mutationCache: new MutationCache({ onError: reportApiError }),
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) =>
              !(
                error instanceof ApiError && FINAL_STATUSES.has(error.status)
              ) && failureCount < 2,
          },
        },
      })
  );

  useEffect(() => {
    return () => queryClient.clear();
  }, [queryClient, sessionId]);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
