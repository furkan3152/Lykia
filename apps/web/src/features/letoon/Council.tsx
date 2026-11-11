/** The League council: listing requests, the official cities, the seed, and every decision the team can take. */
import type { LeagueAction, ProjectLeague, ProjectModule } from "@lykia/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Link } from "../../app/routes/Link";
import { apiPost, apiPut, describeError } from "../../lib/api";
import { Button, Card, EmptyState, Input, Tag, toast } from "../../mosaic";
import { Coin } from "../league/Coin";
import { STATE_LABEL, STATE_TONE } from "../league/model";
import { actionsFor } from "./model";
import { t } from "../../i18n";

export interface CouncilCity {
  readonly id: string;
  readonly owner: string;
  readonly name: string;
  readonly league: ProjectLeague;
  readonly modules: readonly ProjectModule[];
  readonly network: string;
  readonly usage: { readonly last7Days: { readonly requests: number; readonly plans: number } };
}

export interface SeedReport {
  readonly owner: string | null;
  readonly cities: readonly { readonly key: string; readonly projectId: string; readonly name: string; readonly outcome: "created" | "present" | "missing" }[];
}

export interface CouncilData {
  readonly cities: readonly CouncilCity[];
  readonly seed: SeedReport;
}

const ACTION_LABEL: Readonly<Record<LeagueAction, string>> = { approve: "APPROVE", reject: "REJECT", feature: "FEATURE", unfeature: "UNFEATURE", delist: "DELIST", relist: "RELIST", pause: "PAUSE", resume: "RESUME", launch: "LAUNCH" };
const DANGER: ReadonlySet<LeagueAction> = new Set(["reject", "delist", "pause"]);

export function Council({ data, compact = false }: { readonly data: CouncilData | undefined; readonly compact?: boolean }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: LeagueAction }) => apiPut(`/v1/league/${id}`, { action, ...(note.trim() ? { note: note.trim() } : {}) }),
    onSuccess: (_d, v) => {
      toast.success(`${ACTION_LABEL[v.action]} recorded`, { description: t("letoon.council.writtenToThePlatformAuditChain"), from: "LYKO" });
      setNote("");
      void qc.invalidateQueries({ queryKey: ["council"] });
      void qc.invalidateQueries({ queryKey: ["league"] });
    },
    onError: (e) => toast.error(describeError(e), { from: "LYKO" }),
  });
  const seed = useMutation({
    mutationFn: () => apiPost<SeedReport>("/v1/admin/league/seed", {}),
    onSuccess: (r) => {
      const made = r.cities.filter((c) => c.outcome === "created").length;
      toast.success(made ? t("letoon.council.officialCitiesStruck", { made }) : t("letoon.council.everyOfficialCityAlreadyStands"), { from: "LYKO" });
      void qc.invalidateQueries({ queryKey: ["council"] });
      void qc.invalidateQueries({ queryKey: ["league"] });
    },
    onError: (e) => toast.error(describeError(e), { from: "LYKO" }),
  });
  if (!data) return <Card title={t("letoon.council.leagueCouncil")}><p className="m-small m-muted m-center">…</p></Card>;
  const requests = data.cities.filter((c) => c.league.review === "requested").length;
  const missing = data.seed.cities.filter((c) => c.outcome === "missing").length;
  return (
    <div style={{ display: "grid", gap: 20, gridTemplateColumns: "minmax(0, 1fr)" }}>
      {compact ? null : (
        <div className="m-grid-2">
          <Card title={t("letoon.council.officialCities")} kicker={missing ? t("letoon.council.notStruckYet", { missing }) : t("letoon.council.allStanding")} footer={<Button disabled={seed.isPending || missing === 0} onClick={() => seed.mutate()}>{seed.isPending ? "STRIKING…" : missing ? t("letoon.council.seedOfficialCities") : t("letoon.council.nothingToSeed")}</Button>}>
            <ul className="lt-seed">
              {data.seed.cities.map((c) => (
                <li key={c.key}><b>{c.name}</b><span className="num m-small">{c.projectId}</span><Tag tone={c.outcome === "missing" ? "ochre" : "ok"}>{c.outcome === "missing" ? "MISSING" : "PRESENT"}</Tag></li>
              ))}
            </ul>
            <p className="m-small m-muted" style={{ marginTop: 8 }}>{t("letoon.council.idempotent", { owner: data.seed.owner ? `${data.seed.owner.slice(0, 8)}…` : t("letoon.council.theFirstAdminAddress") })}</p>
          </Card>
          <Card title={t("letoon.council.noteForTheRecord")} kicker={t("letoon.council.optionalSavedWithTheNextDecision")}>
            <Input value={note} maxLength={200} placeholder={t("letoon.council.whyInALine")} onChange={(e) => setNote(e.target.value)} />
            <p className="m-small m-muted" style={{ marginTop: 8 }}>{t("letoon.council.listingRequestsWaiting", { n: requests })}</p>
          </Card>
        </div>
      )}
      {data.cities.length === 0 ? (
        <EmptyState mood="watching" title={t("letoon.council.noCityYet")}>{t("letoon.council.seedTheOfficialCitiesOrWait")}</EmptyState>
      ) : (
        <ul className="lt-cities">
          {data.cities.map((c) => (
            <li key={c.id} className={`m-frame m-frame--thin lt-city${c.league.review === "requested" ? " lt-city--ask" : ""}`}>
              <Coin state={c.league.state} emblem={c.league.emblem} codename={c.league.codename ?? null} name={c.name} size={72} interactive={false} />
              <div className="lt-city__text">
                <b>{c.name}</b>
                <p className="m-small m-muted">{c.league.tagline}</p>
                <div className="lt-city__tags">
                  <Tag tone={STATE_TONE[c.league.state]}>{STATE_LABEL[c.league.state]}</Tag>
                  <Tag tone="ghost">{c.league.status.toUpperCase()}</Tag>
                  <Tag tone={c.league.review === "requested" ? "ochre" : c.league.listed ? "sea" : "ghost"}>{c.league.review === "requested" ? "REQUESTED" : c.league.listed ? "LISTED" : c.league.review.toUpperCase()}</Tag>
                  {c.league.featured ? <Tag tone="ok">{t("letoon.council.featured")}</Tag> : null}
                </div>
                <p className="m-small num" style={{ overflowWrap: "anywhere" }}>{t("letoon.council.req7d", { id: c.id, value: c.owner.slice(0, 8), requests: c.usage.last7Days.requests })}</p>
              </div>
              <div className="lt-city__acts">
                {actionsFor(c.league).filter((a) => !compact || a === "pause" || a === "resume").map((a) => (
                  <Button key={a} size="sm" tone={DANGER.has(a) ? "ghost" : a === "approve" || a === "launch" || a === "resume" ? "sea" : "navy"} disabled={act.isPending} onClick={() => act.mutate({ id: c.id, action: a })}>{ACTION_LABEL[a]}</Button>
                ))}
                {c.league.listed ? <Link to={`/league/${c.league.slug}`} className="m-btn m-btn--sm m-btn--ghost">{t("letoon.council.view")}</Link> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
