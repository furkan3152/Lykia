/** <Bridge>: USDC from Arc to another chain with Circle CCTP (burn on Arc, native mint there). */
import { useState } from "react";
import { ActionShell, AMOUNT_PATTERN, Field } from "./components/action.js";

export interface BridgeProps {
  readonly className?: string;
  readonly destinations?: readonly string[];
}

export function Bridge(props: BridgeProps) {
  const destinations = props.destinations ?? ["base", "ethereum", "arbitrum", "optimism", "avalanche", "polygon", "solana"];
  const [destination, setDestination] = useState(destinations[0] ?? "base");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  return (
    <ActionShell module="bridge" title="Bridge" cta="Plan bridge" className={props.className} build={() => (AMOUNT_PATTERN.test(amount) ? { verb: "bridge", token: "USDC", amount: { exact: amount }, destination, ...(recipient ? { recipient } : {}) } : null)}>
      <Field label="Destination"><select value={destination} onChange={(e) => setDestination(e.target.value)}>{destinations.map((d) => <option key={d}>{d}</option>)}</select></Field>
      <Field label="Amount (USDC)"><input value={amount} onChange={(e) => setAmount(e.target.value.trim())} inputMode="decimal" placeholder="100" /></Field>
      <Field label="Recipient (optional)"><input value={recipient} onChange={(e) => setRecipient(e.target.value.trim())} placeholder="Your address there" spellCheck={false} /></Field>
    </ActionShell>
  );
}
