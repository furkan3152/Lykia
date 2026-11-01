import { LykiaProvider } from "@lykia/widget";
import { PayrollButton, TokenBadge } from "./PayrollButton";

export function App({ project, apiKey }: { readonly project: string; readonly apiKey: string }) {
  return (
    <LykiaProvider project={project} apiKey={apiKey}>
      <PayrollButton payees={[{ name: "Ada", address: "0x1111111111111111111111111111111111111111", usdc: "1200" }, { name: "Linus", address: "0x2222222222222222222222222222222222222222", usdc: "950" }]} />
      <TokenBadge token="0x3600000000000000000000000000000000000000" />
    </LykiaProvider>
  );
}
