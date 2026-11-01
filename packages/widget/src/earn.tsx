/** <Earn>: put stablecoins to work in a vetted vault, within the Fence's risk tier. */
import { useState } from "react";
import { ActionShell, AMOUNT_PATTERN, Field } from "./components/action.js";

export interface EarnProps {
  readonly className?: string;
  readonly tokens?: readonly string[];
  readonly maxRisk?: "low" | "medium" | "high";
}

export function Earn(props: EarnProps) {
  const tokens = props.tokens ?? ["USDC", "EURC"];
  const [token, setToken] = useState(tokens[0] ?? "USDC");
  const [amount, setAmount] = useState("");
  return (
    <ActionShell module="earn" title="Earn" cta="Plan deposit" className={props.className} build={() => (AMOUNT_PATTERN.test(amount) ? { verb: "earn", token, amount: { exact: amount }, ...(props.maxRisk ? { maxRisk: props.maxRisk } : {}) } : null)}>
      <Field label="Token"><select value={token} onChange={(e) => setToken(e.target.value)}>{tokens.map((t) => <option key={t}>{t}</option>)}</select></Field>
      <Field label="Amount"><input value={amount} onChange={(e) => setAmount(e.target.value.trim())} inputMode="decimal" placeholder="500" /></Field>
    </ActionShell>
  );
}
