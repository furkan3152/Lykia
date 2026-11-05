/**
 * What a clarify choice does (pure). The API offers "Preview on mainnet: <sentence>"
 * when a testnet plan cannot route, and "Deploy the practice venues from the
 * owner console"; everything else is simply asked as the next message.
 */
const PREVIEW_ON_MAINNET = "Preview on mainnet: ";

export type ClarifyAction = { readonly kind: "mainnet"; readonly sentence: string } | { readonly kind: "owner" } | { readonly kind: "ask"; readonly text: string };

export function clarifyAction(option: string): ClarifyAction {
  if (option.startsWith(PREVIEW_ON_MAINNET)) return { kind: "mainnet", sentence: option.slice(PREVIEW_ON_MAINNET.length).trim() };
  if (/practice venues/i.test(option) && /owner console/i.test(option)) return { kind: "owner" };
  return { kind: "ask", text: option };
}

/** The chip label: short for the mainnet preview, since the sentence is already above. */
export function clarifyLabel(option: string): string {
  const a = clarifyAction(option);
  if (a.kind === "mainnet") return "Preview on mainnet";
  if (a.kind === "owner") return "Deploy practice venues →";
  return option;
}
