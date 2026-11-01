/**
 * The WalletConnect (Reown) project id the build was given, or null when it
 * cannot be a real one. A Reown project id is 32 hexadecimal characters;
 * anything else (empty, a template placeholder, a URL, a quoted value) would
 * show a WalletConnect button whose connection never opens, so the option is
 * hidden instead. Pure: vite.config.ts and node tests import it.
 */
const PROJECT_ID = /^[0-9a-f]{32}$/iu;

export function walletConnectProjectId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return PROJECT_ID.test(value) ? value.toLowerCase() : null;
}

/** Build warning for a set-but-invalid id (printed by vite.config.ts); null when valid or unset. */
export function walletConnectBuildWarning(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim() === "" || walletConnectProjectId(raw)) return null;
  return "VITE_WALLETCONNECT_PROJECT_ID is set but is not a 32-character hexadecimal Reown project id, so WalletConnect is hidden in this build. Set the id from the Reown dashboard, or leave the variable empty.";
}
