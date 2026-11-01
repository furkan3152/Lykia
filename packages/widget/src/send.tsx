/** <Send>: pay an address in USDC or EURC; Lykia's fee and the app's fee are shown before signing. */
import { useState } from "react";
import type { Address } from "@lykia/core";
import { ActionShell, AMOUNT_PATTERN, Field } from "./components/action.js";

export interface SendProps {
  readonly className?: string;
  readonly defaultTo?: Address;
  readonly defaultAmount?: string;
  readonly tokens?: readonly string[];
}

export function Send(props: SendProps) {
  const tokens = props.tokens ?? ["USDC", "EURC"];
  const [to, setTo] = useState<string>(props.defaultTo ?? "");
  const [amount, setAmount] = useState(props.defaultAmount ?? "");
  const [token, setToken] = useState(tokens[0] ?? "USDC");
  return (
    <ActionShell module="send" title="Send" cta="Plan send" className={props.className} build={() => (/^0x[0-9a-fA-F]{40}$/u.test(to) && AMOUNT_PATTERN.test(amount) ? { verb: "send", token, amount: { exact: amount }, to: to as Address } : null)}>
      <Field label="To"><input value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder="0x…" spellCheck={false} /></Field>
      <Field label="Amount"><input value={amount} onChange={(e) => setAmount(e.target.value.trim())} inputMode="decimal" placeholder="25" /></Field>
      <Field label="Token"><select value={token} onChange={(e) => setToken(e.target.value)}>{tokens.map((t) => <option key={t}>{t}</option>)}</select></Field>
    </ActionShell>
  );
}
