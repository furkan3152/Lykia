/** <Swap>: USDC, EURC and cirBTC; StableFX for USDC/EURC, the best AMM route otherwise. */
import { useState } from "react";
import { ActionShell, AMOUNT_PATTERN, Field } from "./components/action.js";

export interface SwapProps {
  readonly className?: string;
  readonly tokens?: readonly string[];
  readonly defaultFrom?: string;
  readonly defaultTo?: string;
}

export function Swap(props: SwapProps) {
  const tokens = props.tokens ?? ["USDC", "EURC", "cirBTC"];
  const [from, setFrom] = useState(props.defaultFrom ?? tokens[0] ?? "USDC");
  const [to, setTo] = useState(props.defaultTo ?? tokens[1] ?? "EURC");
  const [amount, setAmount] = useState("");
  const fx = (from === "USDC" && to === "EURC") || (from === "EURC" && to === "USDC");
  return (
    <ActionShell module="swap" title="Swap" cta="Plan swap" className={props.className} build={() => (from !== to && AMOUNT_PATTERN.test(amount) ? (fx ? { verb: "fx", from, to, amount: { exact: amount } } : { verb: "swap", from, to, amount: { exact: amount } }) : null)}>
      <Field label="From"><select value={from} onChange={(e) => setFrom(e.target.value)}>{tokens.map((t) => <option key={t}>{t}</option>)}</select></Field>
      <Field label="To"><select value={to} onChange={(e) => setTo(e.target.value)}>{tokens.map((t) => <option key={t}>{t}</option>)}</select></Field>
      <Field label="Amount"><input value={amount} onChange={(e) => setAmount(e.target.value.trim())} inputMode="decimal" placeholder="100" /></Field>
    </ActionShell>
  );
}
