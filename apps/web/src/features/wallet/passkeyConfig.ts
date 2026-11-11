/**
 * Circle Modular Wallet configuration (build-time, public values). The client
 * key is a publishable key Circle issues for browser use; the client URL is
 * Circle's modular endpoint. Without both, the passkey option is hidden.
 */
import type { ArcEnvironment } from "@lykia/core";
import { t as msg } from "../../i18n";

export interface PasskeyConfig {
  readonly clientKey: string;
  readonly clientUrl: string;
}

export function passkeyConfig(env: { readonly VITE_CIRCLE_CLIENT_KEY?: string; readonly VITE_CIRCLE_CLIENT_URL?: string } = import.meta.env): PasskeyConfig | null {
  const clientKey = env.VITE_CIRCLE_CLIENT_KEY?.trim();
  const clientUrl = env.VITE_CIRCLE_CLIENT_URL?.trim().replace(/\/+$/u, "");
  if (!clientKey || !clientUrl) return null;
  try {
    const url = new URL(clientUrl);
    if (url.protocol !== "https:") return null;
  } catch {
    return null;
  }
  return { clientKey, clientUrl };
}

/** Circle's modular transport path per Arc environment. */
export function modularPath(environment: ArcEnvironment): "arc" | "arcTestnet" {
  return environment === "mainnet" ? "arc" : "arcTestnet";
}

/** A passkey username: what the device shows in its passkey list. */
export function usernameProblem(name: string): string | null {
  const t = name.trim();
  if (t.length < 3) return msg("wallet.passkeyConfig.atLeast3Characters");
  if (t.length > 40) return msg("wallet.passkeyConfig.atMost40Characters");
  if (!/^[\p{L}\p{N} ._@-]+$/u.test(t)) return msg("wallet.passkeyConfig.lettersDigitsSpacesAndOnly");
  return null;
}
