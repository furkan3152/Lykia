/** "What you will sign": the security report next to a step in the route panel. */
import type { SecurityReport } from "@lykia/core/security/index";

import { Tag } from "../../mosaic";
import { balanceLines, decisionLabel, decisionTone, severityTone, visibleFindings } from "./model";

export function SecurityBlock({ report }: { report: SecurityReport | undefined }) {
  if (!report) return null;
  const findings = visibleFindings(report.findings);
  return (
    <details className="m-note" style={{ marginTop: 8 }} open={report.decision !== "pass"}>
      <summary className="m-small" style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
        <Tag tone={decisionTone(report.decision)}>{decisionLabel(report.decision)}</Tag>
        <b>What you will sign</b>
        <span className="m-muted">{report.simulation === "unavailable" ? "decoded, not simulated" : `simulated (${report.simulation})`}</span>
      </summary>
      <ul className="m-small" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
        {report.summary.lines.map((line, i) => (
          <li key={`${i}-${line}`}>{line}</li>
        ))}
      </ul>
      {balanceLines(report).length > 0 ? <p className="m-small" style={{ marginTop: 6 }}><b>Leaves your wallet:</b> {balanceLines(report).join(" · ")}</p> : null}
      {findings.map((f) => (
        <p key={`${f.rule}-${f.message}`} className="m-small" style={{ marginTop: 6, display: "flex", gap: 6 }}>
          <Tag tone={severityTone(f.severity)}>{f.severity}</Tag>
          <span>{f.message}</span>
        </p>
      ))}
      {report.cleanup.length > 0 ? <p className="m-small m-muted" style={{ marginTop: 6 }}>{report.cleanup.length} allowance reset(s) ready in the Security center once this step settles.</p> : null}
      <p className="m-small m-muted" style={{ marginTop: 6 }}>Report {report.digest.slice(7, 19)} · recorded in your audit log</p>
    </details>
  );
}
