"use client";
// A client component: the widget talks to the user's wallet in the browser.
// It still renders on the server (no window access during render).
import { LykiaChat, LykiaProvider, Send, Swap, type WagmiConfigLike } from "@lykia/widget";

export interface LykiaWalletProps {
  readonly project: string;
  readonly apiKey: string;
  /** Your app's wagmi config, if it has one: the widget signs through the connected wallet. */
  readonly wagmiConfig?: WagmiConfigLike;
}

export function LykiaWallet({ project, apiKey, wagmiConfig }: LykiaWalletProps) {
  return (
    <LykiaProvider
      project={project}
      apiKey={apiKey}
      {...(wagmiConfig ? { wagmiConfig } : {})}
      onEvent={(name, event) => {
        if (name === "settled") console.log("settled", event);
      }}
    >
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        <LykiaChat />
        <Send />
        <Swap />
      </div>
    </LykiaProvider>
  );
}
