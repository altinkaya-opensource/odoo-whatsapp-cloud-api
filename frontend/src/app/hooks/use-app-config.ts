import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api-client";
import { useAuth } from "./use-auth";

export type AppConfig = {
  odooBaseUrl: string | null;
  suggestionsEnabled: boolean;
};

/** Deployment settings the browser needs, fetched once per page load. */
export const useAppConfig = (): AppConfig => {
  const { sessionId } = useAuth();
  const { data } = useQuery({
    queryKey: ["config"],
    enabled: !!sessionId,
    staleTime: Infinity,
    meta: { quiet: true },
    queryFn: async ({ signal }): Promise<AppConfig> => {
      const body = await apiFetch<Partial<AppConfig>>("/api/config", {
        sessionId,
        signal,
      });
      return {
        odooBaseUrl: body.odooBaseUrl ?? null,
        suggestionsEnabled: body.suggestionsEnabled === true,
      };
    },
  });
  return data ?? { odooBaseUrl: null, suggestionsEnabled: false };
};
