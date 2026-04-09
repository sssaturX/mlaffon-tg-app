import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      retry: 1,
      /** Пер-запрос задаётся в хуках (static / semi-static / realtime). */
      staleTime: 60_000,
      gcTime: 1000 * 60 * 30,
    },
    mutations: {
      retry: 0,
    },
  },
});
