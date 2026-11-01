/** <Fence>: pick a template, set caps, see every rule that would loosen it. */
import { FENCE_TEMPLATES, fenceHash, type FenceTemplateKey } from "@lykia/core";
import { Field } from "./components/action.js";
import { useFence } from "./hooks.js";
import { LykiaRoot, ModuleOff, useLykia } from "./provider.js";

export interface FenceProps {
  readonly className?: string;
  readonly template?: FenceTemplateKey;
  readonly onChange?: (fence: import("@lykia/core").Fence) => void;
}

const CAPS = [
  ["perStepUsd", "Per step (USD)"],
  ["perIntentUsd", "Per plan (USD)"],
  ["dailyUsd", "Per day (USD)"],
] as const;

export function Fence(props: FenceProps) {
  const ctx = useLykia();
  const fence = useFence(props.template ? { template: props.template } : {});
  if (!ctx.modules.has("fence")) return <ModuleOff module="fence" />;
  return (
    <LykiaRoot name="fence" {...(props.className ? { className: props.className } : {})}>
      <section className="lk-card" aria-label="Fence">
        <h3 className="lk-title">{ctx.t("fence.title", "Fence")}</h3>
        <div className="lk-row">
          <Field label="Template">
            <select value={fence.template} onChange={(e) => fence.pickTemplate(e.target.value as FenceTemplateKey)}>
              {(Object.keys(FENCE_TEMPLATES) as FenceTemplateKey[]).map((k) => <option key={k} value={k}>{FENCE_TEMPLATES[k].label ?? k}</option>)}
            </select>
          </Field>
          {CAPS.map(([key, label]) => (
            <Field key={key} label={label}>
              <input inputMode="decimal" value={fence.fence.caps?.[key] ?? ""} onChange={(e) => fence.setCap(key, e.target.value.trim() || undefined)} placeholder="No cap" />
            </Field>
          ))}
        </div>
        <div className="lk-row">
          <button className="lk-btn" type="button" disabled={fence.checking} onClick={() => void fence.validate().then((ok) => ok && props.onChange?.(fence.fence))}>Check</button>
          <span className="lk-mono">{fenceHash(fence.fence).slice(0, 23)}…</span>
        </div>
        {fence.loosened.length > 0 ? (
          <div>
            <p className="lk-confirm">These edits loosen the Fence and need the owner's wallet:</p>
            <ul className="lk-list">{fence.loosened.map((l) => <li key={l}>{l}</li>)}</ul>
          </div>
        ) : null}
        {fence.issues.length > 0 ? <p className="lk-error" role="alert">{fence.issues.length} issue(s) in this Fence.</p> : null}
        {fence.error ? <p className="lk-error" role="alert">{fence.error}</p> : null}
      </section>
    </LykiaRoot>
  );
}
