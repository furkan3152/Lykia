/** <Scent>: what can be proven about a token before anyone touches it. */
import { useState, type FormEvent } from "react";
import type { Address } from "@lykia/core";
import { Field } from "./components/action.js";
import { useScent } from "./hooks.js";
import { LykiaRoot, ModuleOff, useLykia } from "./provider.js";

export function Scent(props: { readonly className?: string; readonly token?: Address }) {
  const ctx = useLykia();
  const scent = useScent();
  const [token, setToken] = useState<string>(props.token ?? "");
  if (!ctx.modules.has("scent")) return <ModuleOff module="scent" />;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (/^0x[0-9a-fA-F]{40}$/u.test(token)) void scent.check(token as Address);
  };
  const report = scent.data;
  const tone = report ? (report.level === "verified" || report.level === "no-red-flags" ? "lk-allow" : report.level === "caution" || report.level === "unknown" ? "lk-confirm" : "lk-deny") : "";
  return (
    <LykiaRoot name="scent" {...(props.className ? { className: props.className } : {})}>
      <section className="lk-card" aria-label="Scent">
        <h3 className="lk-title">{ctx.t("scent.title", "Scent")}</h3>
        <form className="lk-row" onSubmit={submit}>
          <Field label="Token address"><input value={token} onChange={(e) => setToken(e.target.value.trim())} placeholder="0x…" spellCheck={false} /></Field>
          <button className="lk-btn" type="submit" disabled={scent.loading}>{scent.loading ? "Checking…" : "Check"}</button>
        </form>
        {report ? (
          <div aria-live="polite">
            <p><strong>{report.symbol ?? "Unknown token"}</strong> <span className={`lk-pill ${tone}`}>{report.level}</span></p>
            <ul className="lk-list">
              {report.checks.map((c) => (
                <li key={c.id}><span>{c.id}</span><span className={c.ok === true ? "lk-allow" : c.ok === false ? "lk-deny" : "lk-muted"}>{c.detail}</span></li>
              ))}
            </ul>
          </div>
        ) : null}
        {scent.error ? <p className="lk-error" role="alert">{scent.error}</p> : null}
      </section>
    </LykiaRoot>
  );
}
