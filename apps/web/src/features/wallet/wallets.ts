/** Which browser wallets the connect modal lists (pure). */
import type { Connector } from "wagmi";

/** EIP-6963 wallets first (they carry a name and an icon); the generic injected connector only as a fallback. */
export function browserWallets(connectors: readonly Pick<Connector, "id" | "name" | "type" | "icon">[], hasInjectedProvider: boolean): Pick<Connector, "id" | "name" | "type" | "icon">[] {
  const announced = connectors.filter((c) => c.type === "injected" && c.id !== "injected");
  const seen = new Set<string>();
  const unique = announced.filter((c) => (seen.has(c.name.toLowerCase()) ? false : (seen.add(c.name.toLowerCase()), true)));
  if (unique.length > 0) return unique;
  const generic = connectors.find((c) => c.id === "injected");
  return generic && hasInjectedProvider ? [generic] : [];
}

