import React from "react";

import { WalletProviders } from "../providers";
import { AppShell } from "./AppShell";

/**
 * The /app layout chunk: wallet providers + deck shell. The router loads it
 * lazily and keeps it mounted across deck routes (the rail never remounts).
 */
export default function AppLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <WalletProviders>
      <AppShell>{children}</AppShell>
    </WalletProviders>
  );
}
