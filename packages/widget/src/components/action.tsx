/** Shared shell for the action components (Send, Swap, Earn, Bridge): a form, then the plan card. */
import type { ReactNode, FormEvent } from "react";
import type { PlanAction, ProjectModule } from "@lykia/core";
import { useLykiaPlan } from "../hooks.js";
import { LykiaRoot, ModuleOff, useLykia } from "../provider.js";
import { PlanCard } from "./plan.js";

export function ActionShell(props: { readonly module: ProjectModule; readonly title: string; readonly className?: string | undefined; readonly build: () => PlanAction | null; readonly children: ReactNode; readonly cta: string }) {
  const ctx = useLykia();
  const plan = useLykiaPlan();
  if (!ctx.modules.has(props.module)) return <ModuleOff module={props.module} />;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const action = props.build();
    if (action) void plan.plan({ actions: [action], ...(ctx.owner ? { owner: ctx.owner } : {}) });
  };
  return (
    <LykiaRoot name={props.module} {...(props.className ? { className: props.className } : {})}>
      <section className="lk-card" aria-label={props.title}>
        <h3 className="lk-title">{ctx.t(`${props.module}.title`, props.title)}</h3>
        <form className="lk-row" onSubmit={submit}>
          {props.children}
          <button className="lk-btn" type="submit" disabled={plan.status === "planning"}>{plan.status === "planning" ? "Planning…" : ctx.t(`${props.module}.cta`, props.cta)}</button>
        </form>
        <PlanCard state={plan} onRun={() => void plan.run()} onReset={plan.reset} />
      </section>
    </LykiaRoot>
  );
}

export function Field(props: { readonly label: string; readonly children: ReactNode }) {
  return (
    <label className="lk-field">
      <span>{props.label}</span>
      {props.children}
    </label>
  );
}

export const AMOUNT_PATTERN = /^\d{1,12}(?:\.\d{1,18})?$/u;
