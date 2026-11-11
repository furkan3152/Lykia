/** A newcomer's tab: one friendly state and one action, instead of panels of zeros (see newcomer.ts). */
import { Button, EmptyState } from "../../mosaic";
import { NEWCOMER, type NewcomerTab } from "./newcomer";

export function NewcomerCard({ tab, onAsk }: { readonly tab: NewcomerTab; readonly onAsk: (text: string) => void }) {
  const n = NEWCOMER[tab];
  return (
    <section className="fd-card m-frame m-frame--thin fd-newcomer" aria-label={n.title}>
      <EmptyState mood={tab === "fence" ? "watching" : "happy"} title={n.title}>
        {n.line}
      </EmptyState>
      <div className="fd-newcomer__act">
        <Button tone="terra" onClick={() => onAsk(n.ask)}>
          {n.action}
        </Button>
      </div>
    </section>
  );
}
