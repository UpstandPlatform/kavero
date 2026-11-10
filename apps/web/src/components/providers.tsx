"use client";

import { Toaster } from "@Kavero/ui/components/sonner";
import { TooltipProvider } from "@Kavero/ui/components/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState } from "react";

import { getQueryClient, makeTRPCClient, TRPCProvider } from "@/utils/trpc";

import { DesktopUpdateNotice } from "./desktop-update";
import { ConfirmDialogHost } from "./confirm-dialog";
import { ThemeProvider } from "./theme-provider";

export default function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();
  const [trpcClient] = useState(makeTRPCClient);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider delay={350}>
        <QueryClientProvider client={queryClient}>
          <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
            {children}
          </TRPCProvider>
          <ReactQueryDevtools />
        </QueryClientProvider>
      </TooltipProvider>
      <Toaster richColors />
      <ConfirmDialogHost />
      <DesktopUpdateNotice />
    </ThemeProvider>
  );
}
