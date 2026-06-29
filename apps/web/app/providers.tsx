"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useWebSocket } from "@/hooks/useWebSocket";
import { Toaster } from "@/components/Toaster";

function WsBridge() {
  useWebSocket();
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
            staleTime: 2000,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <WsBridge />
      {children}
      <Toaster />
    </QueryClientProvider>
  );
}
