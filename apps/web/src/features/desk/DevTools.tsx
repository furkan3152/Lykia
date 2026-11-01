/** Circle and Arc developer tools, from core's registry, for the Build page. */
import { DEV_TOOLS } from "@lykia/core";

import { Card, Tag } from "../../mosaic";

const KIND_TONE = { sdk: "sea", skill: "ochre", mcp: "ok", docs: "ghost", tooling: "ghost" } as const;

export function DevToolsCard() {
  return (
    <Card title={"Circle & Arc tools"} kicker={"BUILD NEXT TO LYKIA"} tone="sea">
      <div className="m-grid-2" style={{ gap: 12 }}>
        {DEV_TOOLS.map((t) => (
          <div key={t.id} className="m-row">
            <Tag tone={KIND_TONE[t.kind]}>{t.kind}</Tag>
            <div style={{ minWidth: 0 }}>
              <a href={t.url} target="_blank" rel="noreferrer"><b>{t.name} ↗</b></a>
              <p className="m-small">{t.summary}</p>
              <p className="m-small m-muted">{t.inLykia}</p>
              {t.install ? <pre className="m-code" style={{ marginTop: 4, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{t.install}</pre> : null}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
