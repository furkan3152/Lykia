/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the Lykia API (no path). Defaults to http://localhost:3001. */
  readonly VITE_API_URL?: string;
  /** Reown (WalletConnect) project id: 32 hex characters. WalletConnect is hidden without it. */
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
