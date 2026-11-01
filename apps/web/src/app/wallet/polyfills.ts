import { Buffer } from "buffer";

/*
 * Some wallet SDKs (WalletConnect, Coinbase) still reach for Node's global
 * Buffer. Installed only with the wallet chunk, never on marketing routes.
 */
const scope = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
scope.Buffer ??= Buffer;
