import { useQuery } from "@tanstack/react-query";

export type AppConfig = {
  odooBaseUrl: string | null;
  suggestionsEnabled: boolean;
};

/** Deployment settings the browser needs, fetched once per page load. */
export const useAppConfig = (): AppConfig => {
  const { data } = useQuery({
    queryKey: ["config"],
    staleTime: Infinity,
    meta: { quiet: true },
    queryFn: async ({ signal }): Promise<AppConfig> => {
      const response = await fetch("/api/config", { signal });
      const body = await response.json();
      return {
        odooBaseUrl: body.odooBaseUrl ?? null,
        suggestionsEnabled: body.suggestionsEnabled === true,
      };
    },
  });
  return data ?? { odooBaseUrl: null, suggestionsEnabled: false };
};
