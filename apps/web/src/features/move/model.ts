/** Pure helpers for the Move page: input checks, the EIP-681 payment link, friendly errors. */

export const MOVE_TABS = ["send", "receive", "swap", "earn", "borrow", "bridge"] as const;
export type MoveTab = (typeof MOVE_TABS)[number];
/** Below this much native USDC the wallet cannot pay Arc gas for a multi-call step. */
export const MIN_GAS_USDC = 0.02;

export interface TokenRow {
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
  readonly address: string | null;
  readonly tags?: readonly string[];
}

export const isAddress = (v: string) => /^0x[0-9a-fA-F]{40}$/u.test(v.trim());
export const isAmount = (v: string) => /^\d{1,18}(?:\.\d{1,18})?$/u.test(v.trim()) && Number(v) > 0;

/** The EIP-681 link a wallet opens to pay `amount` of `token` to `to` on Arc. */
export function paymentUri(input: { readonly to: string; readonly token: TokenRow | undefined; readonly amount: string; readonly chainId: number }): string {
  const { to, token, amount, chainId } = input;
  if (!token?.address || !isAmount(amount)) return `ethereum:${to}@${chainId}`;
  const [whole = "0", frac = ""] = amount.trim().split(".");
  const units = (BigInt(whole) * 10n ** BigInt(token.decimals) + BigInt(frac.padEnd(token.decimals, "0").slice(0, token.decimals) || "0")).toString();
  return `ethereum:${token.address}@${chainId}/transfer?address=${to}&uint256=${units}`;
}

/** A clear sentence for the money problems people hit first. */
export function friendlyError(message: string): string {
  if (/beta/iu.test(message) && /cap/iu.test(message)) return `${message} Lykia is in beta on mainnet: amounts are capped per step and per day.`;
  if (/insufficient|needs .* spendable|balance is 0/iu.test(message)) return message;
  if (/below (?:the )?min|minimum/iu.test(message)) return `${message} Try a larger amount.`;
  if (/no USD price/iu.test(message)) return `${message} Lykia has no on-chain price for this token yet, so the Fence cannot check its caps and refuses the move.`;
  return message;
}


/** The address book is per signed-in owner: query it only with a live session for the connected wallet. */
export function canReadContacts(owner: string | null | undefined, session: { readonly address: string; readonly expiresAt: string } | null, now = Date.now()): boolean {
  return Boolean(owner && session && session.address.toLowerCase() === owner.toLowerCase() && Date.parse(session.expiresAt) > now);
}
