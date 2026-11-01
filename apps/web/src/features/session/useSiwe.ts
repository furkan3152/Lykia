/** Sign in with Ethereum on Arc: nonce → wallet signs the EIP-4361 message → Lykia-Session. */
import type { SessionView, SiweNonceResponse } from "@lykia/core/api/platform";
import { useState } from "react";

import { apiPost, describeError } from "../../lib/api";
import { useSession } from "../../lib/session";
import { toast } from "../../mosaic";
import { useLykiaWallet } from "../wallet/useLykiaWallet";

export function useSiwe() {
  const wallet = useLykiaWallet();
  const { address, chainId } = wallet;
  const session = useSession((s) => s.session);
  const setSession = useSession((s) => s.set);
  const [busy, setBusy] = useState(false);
  const signedIn = Boolean(session && address && session.address.toLowerCase() === address.toLowerCase());
  const signIn = async () => {
    if (!address) {
      toast.warning("Connect a wallet first", { from: "LYKO" });
      return;
    }
    setBusy(true);
    try {
      const nonce = await apiPost<SiweNonceResponse>("/v1/auth/nonce", { address, ...(chainId ? { chainId } : {}) });
      if (!nonce.message) throw new Error("The API did not prepare a sign-in message.");
      const signature = await wallet.signMessage(nonce.message);
      const view = await apiPost<SessionView>("/v1/auth/verify", { message: nonce.message, signature });
      setSession({ token: view.token, address: view.address, roles: view.roles, expiresAt: view.expiresAt });
      toast.success("Signed in", { description: `${view.address.slice(0, 6)}… · ${view.roles.join(", ")}`, from: "LYKO" });
    } catch (e) {
      toast.error("Sign-in failed", { description: describeError(e), from: "LYKO" });
    } finally {
      setBusy(false);
    }
  };
  return { address, signedIn, session, signIn, signOut: () => setSession(null), busy };
}
